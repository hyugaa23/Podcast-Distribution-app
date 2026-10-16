package api

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"podcast/api/internal/app"
	"podcast/api/internal/authn"
	"podcast/api/internal/queue"
	"podcast/api/internal/util"
)

// ---------------------------------------------------------------------------
// RSS import (PRD §18, §19)

func (s *Server) previewRSSImport(w http.ResponseWriter, r *http.Request) {
	var in struct {
		FeedURL string `json:"feed_url"`
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	pf, err := s.App.PreviewFeed(ctx, in.FeedURL)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_feed", err.Error())
		return
	}
	eps := pf.Episodes
	total := len(eps)
	if len(eps) > 10 {
		eps = eps[:10]
	}
	pf.Episodes = eps
	writeData(w, map[string]any{"feed": pf, "episode_count": total})
}

func (s *Server) importRSS(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	var in app.ImportFeedInput
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if !p.IsSuper() {
		t := p.Tenant()
		in.TenantID = &t
	} else if in.TenantID != nil && *in.TenantID == 0 {
		in.TenantID = nil // central library
	}
	in.UserID = p.userIDPtr()
	id, err := s.App.CreateRSSSource(r.Context(), in)
	if err != nil {
		badRequest(w, err.Error())
		return
	}
	s.audit(r, "IMPORTED_RSS", "rss_source", id, in.TenantID, in)
	writeJSON(w, http.StatusAccepted, map[string]any{"data": map[string]any{"rss_source_id": id, "status": "PENDING"}})
}

func (s *Server) listRSSSources(w http.ResponseWriter, r *http.Request) {
	q := app.RSSSourceSelect
	var args []any
	if tid := scopeTenant(r); tid != 0 {
		q += ` WHERE s.tenant_id=$1`
		args = append(args, tid)
	}
	rows, err := s.App.DB.Query(r.Context(), q+` ORDER BY s.created_at DESC`, args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[app.RSSSource])
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if list == nil {
		list = []app.RSSSource{}
	}
	writeData(w, map[string]any{"sources": list, "intervals": app.SyncIntervals})
}

func (s *Server) rssSourceTenant(r *http.Request, id int64) (*int64, bool) {
	var tid *int64
	if err := s.App.DB.QueryRow(r.Context(), `SELECT tenant_id FROM rss_sources WHERE id=$1`, id).Scan(&tid); err != nil {
		return nil, false
	}
	p := principal(r)
	return tid, p.IsSuper() || (tid != nil && *tid == p.Tenant())
}

func (s *Server) updateRSSSource(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	tid, ok := s.rssSourceTenant(r, id)
	if !ok {
		forbidden(w)
		return
	}
	var in struct {
		SyncEnabled  *bool   `json:"sync_enabled"`
		SyncInterval *int    `json:"sync_interval_minutes"`
		ImportMode   *string `json:"import_mode"`
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if in.SyncInterval != nil && !slices.Contains(app.SyncIntervals, *in.SyncInterval) {
		badRequest(w, "sync_interval_minutes must be one of 15, 30, 60, 360, 1440")
		return
	}
	if in.ImportMode != nil && *in.ImportMode != "METADATA_ONLY" && *in.ImportMode != "MIRROR_AUDIO" {
		badRequest(w, "import_mode must be METADATA_ONLY or MIRROR_AUDIO")
		return
	}
	_, err := s.App.DB.Exec(r.Context(), `UPDATE rss_sources SET sync_enabled=COALESCE($2,sync_enabled),
		sync_interval_minutes=COALESCE($3,sync_interval_minutes), import_mode=COALESCE($4,import_mode),
		next_sync_at=CASE WHEN $3 IS NOT NULL THEN now() + make_interval(mins => $3) ELSE next_sync_at END, updated_at=now() WHERE id=$1`,
		id, in.SyncEnabled, in.SyncInterval, in.ImportMode)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	s.audit(r, "UPDATED_RSS_SOURCE", "rss_source", id, tid, in)
	writeData(w, map[string]bool{"ok": true})
}

func (s *Server) syncRSSSource(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	tid, ok := s.rssSourceTenant(r, id)
	if !ok {
		forbidden(w)
		return
	}
	jobID, err := s.App.Enqueue(r.Context(), queue.SyncRSS, map[string]any{"rss_source_id": id},
		queue.Options{TenantID: derefInt(tid), UniqueKey: fmt.Sprintf("sync:%d", id), UniqueTTL: 15 * time.Minute, MaxAttempts: 1})
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"data": map[string]any{"job_id": jobID, "queued": jobID != ""}})
}

func (s *Server) deleteRSSSource(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	tid, ok := s.rssSourceTenant(r, id)
	if !ok {
		forbidden(w)
		return
	}
	s.App.DB.Exec(r.Context(), `DELETE FROM rss_sources WHERE id=$1`, id)
	s.audit(r, "DELETED_RSS_SOURCE", "rss_source", id, tid, nil)
	writeData(w, map[string]bool{"ok": true})
}

func (s *Server) rssSourceLogs(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	if _, ok := s.rssSourceTenant(r, id); !ok {
		forbidden(w)
		return
	}
	rows, err := s.App.DB.Query(r.Context(), `SELECT id, started_at, finished_at, status, new_episodes, updated_episodes, message
		FROM rss_sync_logs WHERE rss_source_id=$1 ORDER BY started_at DESC LIMIT 50`, id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer rows.Close()
	type logRow struct {
		ID         int64      `json:"id"`
		StartedAt  time.Time  `json:"started_at"`
		FinishedAt *time.Time `json:"finished_at"`
		Status     string     `json:"status"`
		New        int        `json:"new_episodes"`
		Updated    int        `json:"updated_episodes"`
		Message    string     `json:"message"`
	}
	out := []logRow{}
	for rows.Next() {
		var l logRow
		rows.Scan(&l.ID, &l.StartedAt, &l.FinishedAt, &l.Status, &l.New, &l.Updated, &l.Message)
		out = append(out, l)
	}
	writeData(w, out)
}

// ---------------------------------------------------------------------------
// CSV import (PRD §88)

func readCSVBody(r *http.Request) ([]map[string]string, error) {
	var rd io.Reader
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			return nil, err
		}
		f, _, err := r.FormFile("file")
		if err != nil {
			return nil, fmt.Errorf("file field is required")
		}
		defer f.Close()
		b, _ := io.ReadAll(io.LimitReader(f, 10<<20))
		rd = strings.NewReader(string(b))
	} else {
		var in struct {
			CSV string `json:"csv"`
		}
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		rd = strings.NewReader(in.CSV)
	}
	cr := csv.NewReader(rd)
	cr.FieldsPerRecord = -1
	cr.TrimLeadingSpace = true
	records, err := cr.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("invalid CSV: %v", err)
	}
	if len(records) < 2 {
		return nil, fmt.Errorf("CSV must have a header row and at least one data row")
	}
	header := records[0]
	for i := range header {
		header[i] = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(header[i], "FEFF")))
	}
	var out []map[string]string
	for _, rec := range records[1:] {
		m := map[string]string{}
		for i, v := range rec {
			if i < len(header) {
				m[header[i]] = strings.TrimSpace(v)
			}
		}
		out = append(out, m)
	}
	if len(out) > 5000 {
		return nil, fmt.Errorf("CSV import is limited to 5000 rows")
	}
	return out, nil
}

func splitTags(s string) []string {
	var out []string
	for _, t := range strings.FieldsFunc(s, func(r rune) bool { return r == ';' || r == '|' }) {
		if t = strings.TrimSpace(t); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func (s *Server) importCSV(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	kind := r.URL.Query().Get("type")
	rows, err := readCSVBody(r)
	if err != nil {
		badRequest(w, err.Error())
		return
	}
	var owner *int64
	if p.IsSuper() {
		if t := queryInt64(r, "tenant_id"); t != 0 {
			owner = &t
		}
	} else {
		owner = p.TenantID
	}
	created, errs := 0, []string{}
	ctx := r.Context()
	catID := func(name string) *int64 {
		if name == "" {
			return nil
		}
		var id int64
		if s.App.DB.QueryRow(ctx, `SELECT id FROM categories WHERE lower(name)=lower($1) OR slug=$2 OR lower(itunes_name)=lower($1) LIMIT 1`,
			name, util.Slugify(name)).Scan(&id) != nil {
			return nil
		}
		return &id
	}
	switch kind {
	case "podcasts":
		for i, row := range rows {
			title := util.PlainText(row["title"])
			if title == "" {
				errs = append(errs, fmt.Sprintf("row %d: title is required", i+2))
				continue
			}
			email := strings.ToLower(row["owner_email"])
			if email != "" && !util.ValidEmail(email) {
				errs = append(errs, fmt.Sprintf("row %d: invalid owner_email", i+2))
				continue
			}
			slug := s.App.UniquePodcastSlug(ctx, firstNonEmpty(row["slug"], title), 0)
			status := strings.ToUpper(firstNonEmpty(row["status"], "DRAFT"))
			if status != "DRAFT" && status != "PUBLISHED" {
				status = "DRAFT"
			}
			tx, err := s.App.DB.Begin(ctx)
			if err != nil {
				s.serverError(w, r, err)
				return
			}
			var id int64
			err = tx.QueryRow(ctx, `INSERT INTO podcasts(owner_tenant_id, title, slug, description, short_description, author, owner_name,
				owner_email, language, explicit, category_id, subcategory_id, artwork_url, website_url, copyright, status, published_at, created_by)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, CASE WHEN $16='PUBLISHED' THEN now() END, $17) RETURNING id`,
				owner, title, slug, util.SanitizeHTML(row["description"]), util.PlainText(row["short_description"]), util.PlainText(row["author"]),
				util.PlainText(row["owner_name"]), email, firstNonEmpty(row["language"], "en"), parseBoolish(row["explicit"]),
				catID(row["category"]), catID(row["subcategory"]), urlOrEmpty(row["artwork_url"]), urlOrEmpty(row["website_url"]),
				util.PlainText(row["copyright"]), status, p.userIDPtr()).Scan(&id)
			if err != nil {
				tx.Rollback(ctx)
				errs = append(errs, fmt.Sprintf("row %d: %v", i+2, err))
				continue
			}
			if owner != nil {
				tx.Exec(ctx, `INSERT INTO tenant_podcasts(tenant_id, podcast_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, *owner, id)
			}
			s.App.SetPodcastTags(ctx, tx, id, splitTags(row["tags"]))
			tx.Commit(ctx)
			s.App.InvalidatePodcast(ctx, id)
			created++
		}
	case "episodes":
		for i, row := range rows {
			var podcastID int64
			if err := s.App.DB.QueryRow(ctx, `SELECT id FROM podcasts WHERE slug=$1`, row["podcast_slug"]).Scan(&podcastID); err != nil {
				errs = append(errs, fmt.Sprintf("row %d: unknown podcast_slug %q", i+2, row["podcast_slug"]))
				continue
			}
			if acc, err := s.podcastAccessFor(ctx, p, podcastID); err != nil || !acc.Edit {
				errs = append(errs, fmt.Sprintf("row %d: no permission for podcast %q", i+2, row["podcast_slug"]))
				continue
			}
			title := util.PlainText(row["title"])
			if title == "" {
				errs = append(errs, fmt.Sprintf("row %d: title is required", i+2))
				continue
			}
			audioURL := urlOrEmpty(row["audio_url"])
			var pubAt *time.Time
			if v := row["publish_date"]; v != "" {
				t, err := parseTime(v, time.UTC)
				if err != nil {
					errs = append(errs, fmt.Sprintf("row %d: invalid publish_date", i+2))
					continue
				}
				pubAt = &t
			}
			status := strings.ToUpper(firstNonEmpty(row["status"], "DRAFT"))
			if status != "PUBLISHED" || audioURL == "" {
				status = "DRAFT"
			}
			if status == "PUBLISHED" && pubAt == nil {
				now := time.Now()
				pubAt = &now
			}
			etype := strings.ToLower(firstNonEmpty(row["episode_type"], "full"))
			if etype != "full" && etype != "trailer" && etype != "bonus" {
				etype = "full"
			}
			slug := s.App.UniqueEpisodeSlug(ctx, podcastID, firstNonEmpty(row["slug"], title), 0)
			tx, err := s.App.DB.Begin(ctx)
			if err != nil {
				s.serverError(w, r, err)
				return
			}
			var id int64
			err = tx.QueryRow(ctx, `INSERT INTO episodes(podcast_id, title, slug, description, short_description, episode_number, season_number,
				episode_type, audio_url, audio_size, audio_mime, duration, explicit, published_at, status, guid, transcript, transcript_format, created_by)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $9<>'' THEN 'audio/mpeg' ELSE '' END,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
				podcastID, title, slug, util.SanitizeHTML(row["description"]), util.PlainText(row["short_description"]),
				atoiPtr(row["episode_number"]), atoiPtr(row["season_number"]), etype, audioURL, atoi64(row["audio_size"]),
				atoi(row["duration"]), parseBoolish(row["explicit"]), pubAt, status, firstNonEmpty(row["guid"], uuid.NewString()),
				util.StripTags(row["transcript"]), map[bool]string{true: "txt", false: ""}[row["transcript"] != ""], p.userIDPtr()).Scan(&id)
			if err != nil {
				tx.Rollback(ctx)
				errs = append(errs, fmt.Sprintf("row %d: %v", i+2, err))
				continue
			}
			s.App.SetEpisodeTags(ctx, tx, id, splitTags(row["tags"]))
			tx.Commit(ctx)
			s.App.InvalidatePodcast(ctx, podcastID)
			created++
		}
	default:
		badRequest(w, "type must be podcasts or episodes")
		return
	}
	s.audit(r, "IMPORTED_CSV_"+strings.ToUpper(kind), kind, created, owner, map[string]any{"rows": len(rows), "errors": len(errs)})
	writeData(w, map[string]any{"created": created, "errors": errs})
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func parseBoolish(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes", "y", "explicit":
		return true
	}
	return false
}

func urlOrEmpty(s string) string {
	if _, err := util.ValidateFetchURL(s); err != nil {
		return ""
	}
	return strings.TrimSpace(s)
}

func atoi(s string) int     { n, _ := strconv.Atoi(strings.TrimSpace(s)); return n }
func atoi64(s string) int64 { n, _ := strconv.ParseInt(strings.TrimSpace(s), 10, 64); return n }
func atoiPtr(s string) *int {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return nil
	}
	return &n
}

// ---------------------------------------------------------------------------
// Exports (PRD §88): podcast metadata, episode metadata, distribution status, analytics.

func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	kind := strings.TrimSuffix(strings.TrimSuffix(chi.URLParam(r, "kind"), ".csv"), ".json")
	format := r.URL.Query().Get("format")
	if strings.HasSuffix(r.URL.Path, ".json") {
		format = "json"
	}
	p := principal(r)
	tid := scopeTenant(r)
	scope := "TRUE"
	var args []any
	if tid != 0 {
		args = append(args, tid)
		scope = "(p.owner_tenant_id=$1 OR p.id IN (SELECT podcast_id FROM tenant_podcast_ids($1)))"
	}
	if p.Role == roleCreator {
		args = append(args, p.UserID)
		scope += " AND p.id IN (SELECT podcast_id FROM user_podcasts WHERE user_id=$" + itoa(len(args)) + ")"
	}
	var header []string
	var query string
	switch kind {
	case "podcasts":
		header = []string{"id", "title", "slug", "status", "author", "owner_name", "owner_email", "language", "explicit", "category",
			"subcategory", "artwork_url", "website_url", "copyright", "source_type", "rss_url", "episodes", "created_at", "updated_at"}
		query = `SELECT p.id::text, p.title, p.slug, p.status, p.author, p.owner_name, p.owner_email, p.language, p.explicit::text,
			COALESCE(c.name,''), COALESCE(sc.name,''), p.artwork_url, p.website_url, p.copyright, p.source_type, p.rss_url,
			(SELECT count(*) FROM episodes WHERE podcast_id=p.id)::text, p.created_at::text, p.updated_at::text
			FROM podcasts p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN categories sc ON sc.id=p.subcategory_id
			WHERE ` + scope + ` ORDER BY p.id`
	case "episodes":
		header = []string{"id", "podcast_slug", "title", "slug", "status", "episode_number", "season_number", "episode_type", "guid",
			"audio_url", "audio_size", "duration", "explicit", "published_at", "seo_title", "meta_description"}
		query = `SELECT e.id::text, p.slug, e.title, e.slug, e.status, COALESCE(e.episode_number::text,''), COALESCE(e.season_number::text,''),
			e.episode_type, e.guid, e.audio_url, e.audio_size::text, e.duration::text, e.explicit::text, COALESCE(e.published_at::text,''),
			e.seo_title, e.meta_description FROM episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE ` + scope + ` ORDER BY e.id`
	case "distribution":
		header = []string{"podcast_id", "podcast", "platform", "status", "external_id", "external_url", "submitted_at", "approved_at",
			"last_checked_at", "notes", "issue_reason"}
		query = `SELECT p.id::text, p.title, pl.name, d.status, d.external_id, d.external_url, COALESCE(d.submitted_at::text,''),
			COALESCE(d.approved_at::text,''), COALESCE(d.last_checked_at::text,''), d.notes, d.issue_reason
			FROM podcast_distributions d JOIN podcasts p ON p.id=d.podcast_id JOIN platforms pl ON pl.id=d.platform_id
			WHERE ` + scope + ` ORDER BY p.title, pl.sort_order`
	case "analytics":
		if p.Role == roleCreator {
			forbidden(w)
			return
		}
		header = []string{"day", "tenant", "podcast", "episode", "event_type", "events", "unique_visitors"}
		tscope := "TRUE"
		if tid != 0 {
			tscope = "ad.tenant_id=$1"
		}
		args = args[:min(len(args), 1)]
		if tid == 0 {
			args = nil
		}
		query = `SELECT ad.day::text, t.name, COALESCE(p.title,''), COALESCE(e.title,''), ad.event_type, ad.events::text, ad.visitors::text
			FROM analytics_daily ad JOIN tenants t ON t.id=ad.tenant_id LEFT JOIN podcasts p ON p.id=ad.podcast_id
			LEFT JOIN episodes e ON e.id=ad.episode_id WHERE ` + tscope + ` AND ad.day >= current_date - 365 ORDER BY ad.day DESC, t.name`
	default:
		notFound(w)
		return
	}
	rows, err := s.App.DB.Query(r.Context(), query, args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer rows.Close()
	var data [][]string
	for rows.Next() {
		vals := make([]string, len(header))
		ptrs := make([]any, len(header))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			s.serverError(w, r, err)
			return
		}
		data = append(data, vals)
	}
	s.audit(r, "EXPORTED_"+strings.ToUpper(kind), kind, len(data), p.TenantID, nil)
	stamp := time.Now().Format("20060102")
	if format == "json" {
		out := make([]map[string]string, 0, len(data))
		for _, row := range data {
			m := map[string]string{}
			for i, h := range header {
				m[h] = row[i]
			}
			out = append(out, m)
		}
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s-%s.json"`, kind, stamp))
		writeJSON(w, 200, out)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s-%s.csv"`, kind, stamp))
	cw := csv.NewWriter(w)
	cw.Write(header)
	for _, row := range data {
		for i, v := range row { // neutralize spreadsheet formula injection
			if len(v) > 0 && strings.ContainsRune("=+-@", rune(v[0])) {
				row[i] = "'" + v
			}
		}
		cw.Write(row)
	}
	cw.Flush()
}

// ---------------------------------------------------------------------------
// Analytics (PRD §57, §59)

func analyticsRange(r *http.Request) (time.Time, time.Time) {
	to := time.Now().UTC().Truncate(24 * time.Hour).Add(24 * time.Hour)
	days := queryInt(r, "days", 30)
	if days < 1 || days > 730 {
		days = 30
	}
	from := to.AddDate(0, 0, -days)
	if f, err := time.Parse("2006-01-02", r.URL.Query().Get("from")); err == nil {
		from = f
	}
	if t, err := time.Parse("2006-01-02", r.URL.Query().Get("to")); err == nil {
		to = t.Add(24 * time.Hour)
	}
	return from, to
}

func (s *Server) analyticsSummary(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	from, to := analyticsRange(r)
	f := app.AnalyticsFilter{From: from, To: to, PodcastID: queryInt64(r, "podcast_id")}
	if tid := scopeTenant(r); tid != 0 {
		f.TenantIDs = []int64{tid}
	}
	if f.PodcastID != 0 {
		acc, err := s.podcastAccessFor(r.Context(), p, f.PodcastID)
		if err != nil || !acc.Read {
			forbidden(w)
			return
		}
	} else if p.Role == roleCreator {
		forbidden(w) // creators only see analytics of their assigned podcasts
		return
	}
	sum, err := s.App.Summary(r.Context(), f)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeData(w, sum)
}

func (s *Server) analyticsEpisodes(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	from, to := analyticsRange(r)
	podcastID := queryInt64(r, "podcast_id")
	if podcastID == 0 {
		badRequest(w, "podcast_id is required")
		return
	}
	acc, err := s.podcastAccessFor(r.Context(), p, podcastID)
	if err != nil || !acc.Read {
		forbidden(w)
		return
	}
	f := app.AnalyticsFilter{From: from, To: to, PodcastID: podcastID}
	if tid := scopeTenant(r); tid != 0 {
		f.TenantIDs = []int64{tid}
	}
	eps, err := s.App.EpisodeAnalytics(r.Context(), f)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeData(w, eps)
}

func (s *Server) analyticsGeo(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	from, to := analyticsRange(r)
	f := app.AnalyticsFilter{From: from, To: to, PodcastID: queryInt64(r, "podcast_id")}
	if tid := scopeTenant(r); tid != 0 {
		f.TenantIDs = []int64{tid}
	}
	if f.PodcastID != 0 {
		acc, err := s.podcastAccessFor(r.Context(), p, f.PodcastID)
		if err != nil || !acc.Read {
			forbidden(w)
			return
		}
	} else if p.Role == roleCreator {
		forbidden(w)
		return
	}
	writeData(w, s.App.GeoBreakdown(r.Context(), f))
}

func (s *Server) analyticsDevices(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	from, to := analyticsRange(r)
	f := app.AnalyticsFilter{From: from, To: to, PodcastID: queryInt64(r, "podcast_id")}
	if tid := scopeTenant(r); tid != 0 {
		f.TenantIDs = []int64{tid}
	}
	if f.PodcastID != 0 {
		acc, err := s.podcastAccessFor(r.Context(), p, f.PodcastID)
		if err != nil || !acc.Read {
			forbidden(w)
			return
		}
	} else if p.Role == roleCreator {
		forbidden(w)
		return
	}
	writeData(w, s.App.DeviceStats(r.Context(), f))
}

func (s *Server) analyticsNetwork(w http.ResponseWriter, r *http.Request) {
	from, to := analyticsRange(r)
	list, err := s.App.NetworkComparison(r.Context(), from, to)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	sum, err := s.App.Summary(r.Context(), app.AnalyticsFilter{From: from, To: to})
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeData(w, map[string]any{"tenants": list, "network": sum})
}

// ---------------------------------------------------------------------------
// Notifications (PRD §98)

func notificationScope(p *Principal) (string, []any) {
	if p.IsSuper() {
		return "TRUE", nil
	}
	return "n.tenant_id=$2", []any{p.Tenant()}
}

func (s *Server) listNotifications(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	scope, extra := notificationScope(p)
	args := append([]any{p.UserID}, extra...)
	rows, err := s.App.DB.Query(r.Context(), `SELECT n.id, n.tenant_id, n.type, n.severity, n.title, n.message, n.link, n.created_at,
		EXISTS(SELECT 1 FROM notification_reads nr WHERE nr.notification_id=n.id AND nr.user_id=$1) AS read
		FROM notifications n WHERE `+scope+` ORDER BY n.created_at DESC LIMIT 100`, args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[app.Notification])
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	unread := 0
	for _, n := range list {
		if !n.Read {
			unread++
		}
	}
	if list == nil {
		list = []app.Notification{}
	}
	writeData(w, map[string]any{"items": list, "unread": unread})
}

func (s *Server) readNotification(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	s.App.DB.Exec(r.Context(), `INSERT INTO notification_reads(notification_id, user_id) SELECT id, $2 FROM notifications
		WHERE id=$1 AND ($3 OR tenant_id=$4) ON CONFLICT DO NOTHING`, idParam(r, "id"), p.UserID, p.IsSuper(), p.Tenant())
	writeData(w, map[string]bool{"ok": true})
}

func (s *Server) readAllNotifications(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	s.App.DB.Exec(r.Context(), `INSERT INTO notification_reads(notification_id, user_id) SELECT id, $1 FROM notifications
		WHERE ($2 OR tenant_id=$3) ON CONFLICT DO NOTHING`, p.UserID, p.IsSuper(), p.Tenant())
	writeData(w, map[string]bool{"ok": true})
}

// ---------------------------------------------------------------------------
// Audit log (PRD §78)

func (s *Server) listAuditLogs(w http.ResponseWriter, r *http.Request) {
	page, per, offset := pagination(r, 50, 500)
	where := "TRUE"
	var args []any
	if tid := scopeTenant(r); tid != 0 {
		args = append(args, tid)
		where = "a.tenant_id=$1"
	}
	if v := r.URL.Query().Get("action"); v != "" {
		args = append(args, v)
		where += " AND a.action=$" + itoa(len(args))
	}
	if v := r.URL.Query().Get("resource_type"); v != "" {
		args = append(args, v)
		where += " AND a.resource_type=$" + itoa(len(args))
	}
	var total int
	s.App.DB.QueryRow(r.Context(), `SELECT count(*) FROM audit_logs a WHERE `+where, args...).Scan(&total)
	rows, err := s.App.DB.Query(r.Context(), `SELECT a.id, a.user_email, a.action, a.resource_type, a.resource_id, a.tenant_id,
		COALESCE(t.name,''), a.ip, a.changes, a.created_at FROM audit_logs a LEFT JOIN tenants t ON t.id=a.tenant_id
		WHERE `+where+fmt.Sprintf(` ORDER BY a.created_at DESC LIMIT %d OFFSET %d`, per, offset), args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer rows.Close()
	type entry struct {
		ID           int64           `json:"id"`
		User         string          `json:"user"`
		Action       string          `json:"action"`
		ResourceType string          `json:"resource_type"`
		ResourceID   string          `json:"resource_id"`
		TenantID     *int64          `json:"tenant_id"`
		Tenant       string          `json:"tenant"`
		IP           string          `json:"ip"`
		Changes      json.RawMessage `json:"changes"`
		CreatedAt    time.Time       `json:"created_at"`
	}
	out := []entry{}
	for rows.Next() {
		var e entry
		rows.Scan(&e.ID, &e.User, &e.Action, &e.ResourceType, &e.ResourceID, &e.TenantID, &e.Tenant, &e.IP, &e.Changes, &e.CreatedAt)
		out = append(out, e)
	}
	writeList(w, out, total, page, per)
}

// ---------------------------------------------------------------------------
// Redirect manager (PRD §89)

func (s *Server) listRedirects(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	where, args := "TRUE", []any{}
	if !p.IsSuper() {
		where, args = "(r.tenant_id=$1 OR r.tenant_id IS NULL)", []any{p.Tenant()}
	} else if t := queryInt64(r, "tenant_id"); t != 0 {
		where, args = "(r.tenant_id=$1 OR r.tenant_id IS NULL)", []any{t}
	}
	rows, err := s.App.DB.Query(r.Context(), `SELECT r.id, r.tenant_id, COALESCE(t.name,'All sites'), r.from_path, r.to_path, r.status_code,
		r.is_auto, r.hits, r.created_at FROM redirects r LEFT JOIN tenants t ON t.id=r.tenant_id WHERE `+where+` ORDER BY r.created_at DESC LIMIT 1000`, args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer rows.Close()
	type red struct {
		ID         int64     `json:"id"`
		TenantID   *int64    `json:"tenant_id"`
		TenantName string    `json:"tenant_name"`
		From       string    `json:"from_path"`
		To         string    `json:"to_path"`
		StatusCode int       `json:"status_code"`
		IsAuto     bool      `json:"is_auto"`
		Hits       int64     `json:"hits"`
		CreatedAt  time.Time `json:"created_at"`
	}
	out := []red{}
	for rows.Next() {
		var x red
		rows.Scan(&x.ID, &x.TenantID, &x.TenantName, &x.From, &x.To, &x.StatusCode, &x.IsAuto, &x.Hits, &x.CreatedAt)
		out = append(out, x)
	}
	writeData(w, out)
}

func (s *Server) createRedirect(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	var in struct {
		TenantID   *int64 `json:"tenant_id"`
		From       string `json:"from_path"`
		To         string `json:"to_path"`
		StatusCode int    `json:"status_code"`
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if !p.IsSuper() {
		in.TenantID = p.TenantID
	}
	in.From = "/" + strings.Trim(strings.TrimSpace(in.From), "/")
	in.To = strings.TrimSpace(in.To)
	if in.From == "/" || in.To == "" || in.From == in.To {
		badRequest(w, "from_path and to_path are required and must differ")
		return
	}
	if !strings.HasPrefix(in.To, "/") {
		if _, err := util.ValidateFetchURL(in.To); err != nil {
			badRequest(w, "to_path must be a path or absolute URL")
			return
		}
	}
	if in.StatusCode == 0 {
		in.StatusCode = 301
	}
	var id int64
	err := s.App.DB.QueryRow(r.Context(), `INSERT INTO redirects(tenant_id, from_path, to_path, status_code) VALUES ($1,$2,$3,$4)
		ON CONFLICT (COALESCE(tenant_id,0), from_path) DO UPDATE SET to_path=EXCLUDED.to_path, status_code=EXCLUDED.status_code RETURNING id`,
		nilIfZeroPtr(in.TenantID), in.From, in.To, in.StatusCode).Scan(&id)
	if err != nil {
		badRequest(w, "Invalid redirect: "+err.Error())
		return
	}
	s.audit(r, "CREATED_REDIRECT", "redirect", id, in.TenantID, in)
	writeJSON(w, http.StatusCreated, map[string]any{"data": map[string]int64{"id": id}})
}

func (s *Server) deleteRedirect(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	id := idParam(r, "id")
	var tid *int64
	if err := s.App.DB.QueryRow(r.Context(), `SELECT tenant_id FROM redirects WHERE id=$1`, id).Scan(&tid); err != nil {
		notFound(w)
		return
	}
	if !p.IsSuper() && (tid == nil || *tid != p.Tenant()) {
		forbidden(w)
		return
	}
	s.App.DB.Exec(r.Context(), `DELETE FROM redirects WHERE id=$1`, id)
	s.audit(r, "DELETED_REDIRECT", "redirect", id, tid, nil)
	writeData(w, map[string]bool{"ok": true})
}

// ---------------------------------------------------------------------------
// API keys (PRD §104)

func (s *Server) listAPIKeys(w http.ResponseWriter, r *http.Request) {
	where, args := "TRUE", []any{}
	if tid := scopeTenant(r); tid != 0 {
		where, args = "k.tenant_id=$1", []any{tid}
	}
	rows, err := s.App.DB.Query(r.Context(), `SELECT k.id, k.tenant_id, t.name, k.name, k.prefix, k.permissions, k.last_used_at, k.revoked_at, k.created_at
		FROM api_keys k JOIN tenants t ON t.id=k.tenant_id WHERE `+where+` ORDER BY k.created_at DESC`, args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer rows.Close()
	type key struct {
		ID          int64      `json:"id"`
		TenantID    int64      `json:"tenant_id"`
		TenantName  string     `json:"tenant_name"`
		Name        string     `json:"name"`
		Prefix      string     `json:"prefix"`
		Permissions []string   `json:"permissions"`
		LastUsedAt  *time.Time `json:"last_used_at"`
		RevokedAt   *time.Time `json:"revoked_at"`
		CreatedAt   time.Time  `json:"created_at"`
	}
	out := []key{}
	for rows.Next() {
		var k key
		rows.Scan(&k.ID, &k.TenantID, &k.TenantName, &k.Name, &k.Prefix, &k.Permissions, &k.LastUsedAt, &k.RevokedAt, &k.CreatedAt)
		out = append(out, k)
	}
	writeData(w, map[string]any{"keys": out, "available_permissions": authn.APIKeyPermissions})
}

func (s *Server) createAPIKey(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	var in struct {
		TenantID    int64    `json:"tenant_id"`
		Name        string   `json:"name"`
		Permissions []string `json:"permissions"`
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if !p.IsSuper() {
		in.TenantID = p.Tenant()
	}
	in.Name = util.PlainText(in.Name)
	if in.Name == "" || in.TenantID == 0 || len(in.Permissions) == 0 {
		badRequest(w, "name, tenant_id and permissions are required")
		return
	}
	for _, perm := range in.Permissions {
		if !slices.Contains(authn.APIKeyPermissions, perm) {
			badRequest(w, "Unknown permission "+perm)
			return
		}
	}
	key := "pk_" + util.RandomHex(24)
	var id int64
	err := s.App.DB.QueryRow(r.Context(), `INSERT INTO api_keys(tenant_id, name, prefix, key_hash, permissions, created_by)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, in.TenantID, in.Name, key[:10], authn.HashToken(key), in.Permissions, p.userIDPtr()).Scan(&id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	s.audit(r, "CREATED_API_KEY", "api_key", id, &in.TenantID, map[string]any{"name": in.Name, "permissions": in.Permissions})
	// The plaintext key is only returned once.
	writeJSON(w, http.StatusCreated, map[string]any{"data": map[string]any{"id": id, "key": key, "prefix": key[:10]}})
}

func (s *Server) revokeAPIKey(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	var tid int64
	if err := s.App.DB.QueryRow(r.Context(), `SELECT tenant_id FROM api_keys WHERE id=$1`, id).Scan(&tid); err != nil {
		notFound(w)
		return
	}
	if !canManageTenant(principal(r), tid) {
		forbidden(w)
		return
	}
	s.App.DB.Exec(r.Context(), `UPDATE api_keys SET revoked_at=now() WHERE id=$1`, id)
	s.audit(r, "REVOKED_API_KEY", "api_key", id, &tid, nil)
	writeData(w, map[string]bool{"ok": true})
}

// ---------------------------------------------------------------------------
// Webhooks (PRD §105)

var webhookEvents = []string{"episode.published", "podcast.created", "distribution.live", "distribution.failed", "rss.synced"}

func (s *Server) listWebhooks(w http.ResponseWriter, r *http.Request) {
	where, args := "TRUE", []any{}
	if tid := scopeTenant(r); tid != 0 {
		where, args = "tenant_id=$1", []any{tid}
	}
	rows, err := s.App.DB.Query(r.Context(), `SELECT id, tenant_id, url, events, is_active, created_at,
		(SELECT max(created_at) FROM webhook_deliveries WHERE webhook_id=webhooks.id),
		(SELECT success FROM webhook_deliveries WHERE webhook_id=webhooks.id ORDER BY id DESC LIMIT 1)
		FROM webhooks WHERE `+where+` ORDER BY id DESC`, args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer rows.Close()
	type hook struct {
		ID            int64      `json:"id"`
		TenantID      *int64     `json:"tenant_id"`
		URL           string     `json:"url"`
		Events        []string   `json:"events"`
		IsActive      bool       `json:"is_active"`
		CreatedAt     time.Time  `json:"created_at"`
		LastDelivery  *time.Time `json:"last_delivery_at"`
		LastSucceeded *bool      `json:"last_succeeded"`
	}
	out := []hook{}
	for rows.Next() {
		var h hook
		rows.Scan(&h.ID, &h.TenantID, &h.URL, &h.Events, &h.IsActive, &h.CreatedAt, &h.LastDelivery, &h.LastSucceeded)
		out = append(out, h)
	}
	writeData(w, map[string]any{"webhooks": out, "events": webhookEvents})
}

func (s *Server) createWebhook(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	var in struct {
		TenantID *int64   `json:"tenant_id"`
		URL      string   `json:"url"`
		Events   []string `json:"events"`
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if !p.IsSuper() {
		in.TenantID = p.TenantID
	}
	u, err := util.ValidateFetchURL(in.URL)
	if err != nil || (u.Scheme != "https" && !s.App.Cfg.AllowPrivateFetch) {
		badRequest(w, "Webhook URL must be an https URL")
		return
	}
	if len(in.Events) == 0 {
		badRequest(w, "Select at least one event")
		return
	}
	for _, e := range in.Events {
		if !slices.Contains(webhookEvents, e) {
			badRequest(w, "Unknown event "+e)
			return
		}
	}
	secret := "whsec_" + util.RandomHex(20)
	var id int64
	if err := s.App.DB.QueryRow(r.Context(), `INSERT INTO webhooks(tenant_id, url, events, secret) VALUES ($1,$2,$3,$4) RETURNING id`,
		nilIfZeroPtr(in.TenantID), in.URL, in.Events, secret).Scan(&id); err != nil {
		s.serverError(w, r, err)
		return
	}
	s.audit(r, "CREATED_WEBHOOK", "webhook", id, in.TenantID, map[string]any{"url": in.URL, "events": in.Events})
	writeJSON(w, http.StatusCreated, map[string]any{"data": map[string]any{"id": id, "secret": secret}})
}

func (s *Server) webhookTenant(r *http.Request, id int64) (*int64, bool) {
	var tid *int64
	if err := s.App.DB.QueryRow(r.Context(), `SELECT tenant_id FROM webhooks WHERE id=$1`, id).Scan(&tid); err != nil {
		return nil, false
	}
	p := principal(r)
	return tid, p.IsSuper() || (tid != nil && *tid == p.Tenant())
}

func (s *Server) deleteWebhook(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	tid, ok := s.webhookTenant(r, id)
	if !ok {
		forbidden(w)
		return
	}
	s.App.DB.Exec(r.Context(), `DELETE FROM webhooks WHERE id=$1`, id)
	s.audit(r, "DELETED_WEBHOOK", "webhook", id, tid, nil)
	writeData(w, map[string]bool{"ok": true})
}

func (s *Server) webhookDeliveries(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	if _, ok := s.webhookTenant(r, id); !ok {
		forbidden(w)
		return
	}
	rows, err := s.App.DB.Query(r.Context(), `SELECT id, event, status_code, success, error, created_at FROM webhook_deliveries
		WHERE webhook_id=$1 ORDER BY id DESC LIMIT 50`, id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer rows.Close()
	type d struct {
		ID         int64     `json:"id"`
		Event      string    `json:"event"`
		StatusCode int       `json:"status_code"`
		Success    bool      `json:"success"`
		Error      string    `json:"error"`
		CreatedAt  time.Time `json:"created_at"`
	}
	out := []d{}
	for rows.Next() {
		var x d
		rows.Scan(&x.ID, &x.Event, &x.StatusCode, &x.Success, &x.Error, &x.CreatedAt)
		out = append(out, x)
	}
	writeData(w, out)
}

// ---------------------------------------------------------------------------
// System (PRD §79, §99, §103)

var settingKeys = []string{"storage", "cdn", "email", "queue", "analytics", "audio_processing", "themes", "domains", "security", "api", "cron"}

func (s *Server) getSystemSettings(w http.ResponseWriter, r *http.Request) {
	rows, err := s.App.DB.Query(r.Context(), `SELECT key, value FROM system_settings`)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer rows.Close()
	out := map[string]json.RawMessage{}
	for rows.Next() {
		var k string
		var v json.RawMessage
		rows.Scan(&k, &v)
		out[k] = v
	}
	cfg := s.App.Cfg
	env := map[string]any{
		"storage_driver": s.App.Storage.Driver(), "cdn_url": cfg.CDNURL, "s3_endpoint": cfg.S3Endpoint, "s3_bucket": cfg.S3Bucket,
		"redis_url_set": cfg.RedisURL != "", "ffmpeg": cfg.FFmpegPath, "podcastindex_configured": cfg.PodcastIndexKey != "",
		"transcription_configured": s.App.TranscriptionConfigured(), "app_env": cfg.Env, "max_audio_upload_mb": cfg.MaxAudioUploadMB,
		"platform_cname_target": cfg.PlatformCNAMETarget, "platform_ips": cfg.PlatformIPs,
	}
	writeData(w, map[string]any{"settings": out, "keys": settingKeys, "environment": env})
}

func (s *Server) updateSystemSetting(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	if !slices.Contains(settingKeys, key) {
		badRequest(w, "Unknown setting group")
		return
	}
	var v map[string]any
	if err := decode(r, &v); err != nil {
		badRequest(w, err.Error())
		return
	}
	b, _ := json.Marshal(v)
	if _, err := s.App.DB.Exec(r.Context(), `INSERT INTO system_settings(key, value) VALUES ($1,$2)
		ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()`, key, b); err != nil {
		s.serverError(w, r, err)
		return
	}
	s.audit(r, "UPDATED_SYSTEM_SETTINGS", "system_settings", key, nil, v)
	writeData(w, map[string]bool{"ok": true})
}

func (s *Server) systemMetrics(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	qs, _ := s.App.Queue.Stats(ctx)
	jobs := map[string]int{}
	rows, _ := s.App.DB.Query(ctx, `SELECT status, count(*) FROM job_runs WHERE created_at > now() - interval '24 hours' GROUP BY 1`)
	for rows.Next() {
		var st string
		var n int
		rows.Scan(&st, &n)
		jobs[st] = n
	}
	rows.Close()
	var audioBytes, imageBytes, audioFiles, images int64
	s.App.DB.QueryRow(ctx, `SELECT COALESCE(sum(original_size + processed_size),0), count(*) FROM audio_files`).Scan(&audioBytes, &audioFiles)
	s.App.DB.QueryRow(ctx, `SELECT COALESCE(sum(size),0), count(*) FROM images`).Scan(&imageBytes, &images)
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	routes := s.metrics.snapshot()
	type rs struct {
		Route string `json:"route"`
		routeStat
		AvgMS float64 `json:"avg_ms"`
	}
	var list []rs
	for k, v := range routes {
		avg := 0.0
		if v.Count > 0 {
			avg = v.TotalMS / float64(v.Count)
		}
		list = append(list, rs{Route: k, routeStat: v, AvgMS: avg})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Count > list[j].Count })
	writeData(w, map[string]any{
		"uptime_seconds": int(time.Since(s.metrics.started).Seconds()),
		"api":            list,
		"queue":          qs,
		"jobs_24h":       jobs,
		"storage":        map[string]int64{"audio_bytes": audioBytes, "image_bytes": imageBytes, "audio_files": audioFiles, "images": images},
		"runtime":        map[string]any{"goroutines": runtime.NumGoroutine(), "heap_mb": m.HeapAlloc >> 20},
		"db_pool":        map[string]any{"total": s.App.DB.Stat().TotalConns(), "idle": s.App.DB.Stat().IdleConns()},
	})
}

// prometheus exposes API, queue and storage metrics in Prometheus text format (internal network only).
func (s *Server) prometheus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	var b strings.Builder
	b.WriteString("# TYPE pe_http_requests_total counter\n# TYPE pe_http_request_duration_ms_sum counter\n")
	for route, st := range s.metrics.snapshot() {
		lbl := strings.ReplaceAll(route, `"`, "")
		fmt.Fprintf(&b, "pe_http_requests_total{route=%q} %d\n", lbl, st.Count)
		fmt.Fprintf(&b, "pe_http_errors_total{route=%q} %d\n", lbl, st.Errors)
		fmt.Fprintf(&b, "pe_http_request_duration_ms_sum{route=%q} %.2f\n", lbl, st.TotalMS)
	}
	if qs, err := s.App.Queue.Stats(r.Context()); err == nil {
		fmt.Fprintf(&b, "pe_queue_ready %d\npe_queue_delayed %d\npe_queue_processing %d\n", qs.Ready, qs.Delayed, qs.Processing)
	}
	var bytes int64
	s.App.DB.QueryRow(r.Context(), `SELECT COALESCE(sum(original_size+processed_size),0) FROM audio_files`).Scan(&bytes)
	fmt.Fprintf(&b, "pe_storage_audio_bytes %d\n", bytes)
	w.Write([]byte(b.String()))
}

func (s *Server) listJobs(w http.ResponseWriter, r *http.Request) {
	where, args := "TRUE", []any{}
	if st := r.URL.Query().Get("status"); st != "" {
		where, args = "status=$1", []any{st}
	}
	rows, err := s.App.DB.Query(r.Context(), `SELECT id, type, payload, status, attempts, error, tenant_id, created_at, started_at, finished_at
		FROM job_runs WHERE `+where+` ORDER BY created_at DESC LIMIT 200`, args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer rows.Close()
	type job struct {
		ID         string          `json:"id"`
		Type       string          `json:"type"`
		Payload    json.RawMessage `json:"payload"`
		Status     string          `json:"status"`
		Attempts   int             `json:"attempts"`
		Error      string          `json:"error"`
		TenantID   *int64          `json:"tenant_id"`
		CreatedAt  time.Time       `json:"created_at"`
		StartedAt  *time.Time      `json:"started_at"`
		FinishedAt *time.Time      `json:"finished_at"`
	}
	out := []job{}
	for rows.Next() {
		var j job
		rows.Scan(&j.ID, &j.Type, &j.Payload, &j.Status, &j.Attempts, &j.Error, &j.TenantID, &j.CreatedAt, &j.StartedAt, &j.FinishedAt)
		out = append(out, j)
	}
	qs, _ := s.App.Queue.Stats(r.Context())
	writeData(w, map[string]any{"jobs": out, "queue": qs})
}

func (s *Server) retryJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var typ string
	var payload json.RawMessage
	var tid *int64
	if err := s.App.DB.QueryRow(r.Context(), `SELECT type, payload, tenant_id FROM job_runs WHERE id=$1 AND status='FAILED'`, id).Scan(&typ, &payload, &tid); err != nil {
		badRequest(w, "Only failed jobs can be retried")
		return
	}
	var p map[string]any
	json.Unmarshal(payload, &p)
	newID, err := s.App.Enqueue(r.Context(), typ, p, queue.Options{TenantID: derefInt(tid)})
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	s.audit(r, "RETRIED_JOB", "job", id, tid, map[string]string{"new_job_id": newID})
	writeData(w, map[string]string{"job_id": newID})
}

func (s *Server) listSystemLogs(w http.ResponseWriter, r *http.Request) {
	where, args := "TRUE", []any{}
	if lv := r.URL.Query().Get("level"); lv != "" {
		where, args = "level=$1", []any{lv}
	}
	if r.URL.Query().Get("unresolved") == "1" {
		where += " AND NOT resolved"
	}
	rows, err := s.App.DB.Query(r.Context(), `SELECT id, level, source, message, detail, tenant_id, resolved, created_at FROM system_logs
		WHERE `+where+` ORDER BY created_at DESC LIMIT 300`, args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer rows.Close()
	type lg struct {
		ID        int64     `json:"id"`
		Level     string    `json:"level"`
		Source    string    `json:"source"`
		Message   string    `json:"message"`
		Detail    string    `json:"detail"`
		TenantID  *int64    `json:"tenant_id"`
		Resolved  bool      `json:"resolved"`
		CreatedAt time.Time `json:"created_at"`
	}
	out := []lg{}
	for rows.Next() {
		var l lg
		rows.Scan(&l.ID, &l.Level, &l.Source, &l.Message, &l.Detail, &l.TenantID, &l.Resolved, &l.CreatedAt)
		out = append(out, l)
	}
	writeData(w, out)
}

func (s *Server) resolveSystemLog(w http.ResponseWriter, r *http.Request) {
	s.App.DB.Exec(r.Context(), `UPDATE system_logs SET resolved=true WHERE id=$1`, idParam(r, "id"))
	writeData(w, map[string]bool{"ok": true})
}

// backupExport returns tenant configuration, podcast and distribution metadata as JSON (PRD §103).
// Full database backups use infrastructure/backup.sh (pg_dump).
func (s *Server) backupExport(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	dump := func(q string) []map[string]any {
		rows, err := s.App.DB.Query(ctx, q)
		if err != nil {
			return nil
		}
		out, _ := pgx.CollectRows(rows, pgx.RowToMap)
		return out
	}
	payload := map[string]any{
		"generated_at":          time.Now().UTC(),
		"tenants":               dump(`SELECT * FROM tenants`),
		"tenant_settings":       dump(`SELECT * FROM tenant_settings`),
		"seo_settings":          dump(`SELECT * FROM seo_settings`),
		"domains":               dump(`SELECT * FROM domains`),
		"themes":                dump(`SELECT * FROM themes`),
		"categories":            dump(`SELECT * FROM categories`),
		"hosts":                 dump(`SELECT * FROM hosts`),
		"podcasts":              dump(`SELECT id, owner_tenant_id, canonical_tenant_id, title, slug, description, short_description, artwork_url, banner_url, author, owner_name, owner_email, language, explicit, copyright, website_url, rss_url, source_type, podcast_type, category_id, subcategory_id, status, scheduled_at, published_at, feed_guid, created_at, updated_at FROM podcasts`),
		"episodes":              dump(`SELECT id, podcast_id, title, slug, description, short_description, show_notes, episode_number, season_number, episode_type, audio_url, audio_size, audio_mime, duration, artwork_url, transcript, transcript_format, explicit, status, published_at, guid, source_guid, seo_title, meta_description, canonical_url, created_at, updated_at FROM episodes`),
		"podcast_hosts":         dump(`SELECT * FROM podcast_hosts`),
		"tenant_podcasts":       dump(`SELECT * FROM tenant_podcasts`),
		"collections":           dump(`SELECT * FROM collections`),
		"collection_items":      dump(`SELECT * FROM collection_items`),
		"platforms":             dump(`SELECT * FROM platforms`),
		"podcast_distributions": dump(`SELECT * FROM podcast_distributions`),
		"distribution_events":   dump(`SELECT * FROM distribution_events`),
		"rss_sources":           dump(`SELECT id, podcast_id, tenant_id, feed_url, import_mode, sync_enabled, sync_interval_minutes FROM rss_sources`),
		"redirects":             dump(`SELECT * FROM redirects`),
		"system_settings":       dump(`SELECT * FROM system_settings`),
	}
	s.audit(r, "EXPORTED_BACKUP", "system", "backup", nil, nil)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="podcast-platform-backup-%s.json"`, time.Now().Format("20060102-1504")))
	writeJSON(w, 200, payload)
}

// ---------------------------------------------------------------------------
// Dashboards (PRD §55, §56)

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	ctx := r.Context()
	tid := scopeTenant(r)
	if tid == 0 && p.IsSuper() {
		s.masterDashboard(w, r)
		return
	}
	var tenantName string
	s.App.DB.QueryRow(ctx, `SELECT name FROM tenants WHERE id=$1`, tid).Scan(&tenantName)
	stats := map[string]int64{}
	var podcasts, episodes, plays, platforms int64
	s.App.DB.QueryRow(ctx, `SELECT count(*) FROM tenant_podcast_ids($1)`, tid).Scan(&podcasts)
	s.App.DB.QueryRow(ctx, `SELECT count(*) FROM episodes WHERE podcast_id IN (SELECT podcast_id FROM tenant_podcast_ids($1))`, tid).Scan(&episodes)
	s.App.DB.QueryRow(ctx, `SELECT COALESCE(sum(events),0) FROM analytics_daily WHERE tenant_id=$1 AND event_type='PLAY'`, tid).Scan(&plays)
	s.App.DB.QueryRow(ctx, `SELECT count(DISTINCT platform_id) FROM podcast_distributions WHERE status='LIVE'
		AND podcast_id IN (SELECT podcast_id FROM tenant_podcast_ids($1))`, tid).Scan(&platforms)
	stats["podcasts"], stats["episodes"], stats["plays"], stats["platforms"] = podcasts, episodes, plays, platforms

	type platformLive struct {
		Name  string `json:"name"`
		Key   string `json:"key"`
		Color string `json:"color"`
		Live  int    `json:"live"`
	}
	dist := []platformLive{}
	rows, err := s.App.DB.Query(ctx, `SELECT pl.name, pl.key, pl.color, count(d.id) FILTER (WHERE d.status='LIVE')
		FROM platforms pl LEFT JOIN podcast_distributions d ON d.platform_id=pl.id
		AND d.podcast_id IN (SELECT podcast_id FROM tenant_podcast_ids($1))
		WHERE pl.is_active GROUP BY pl.id ORDER BY 4 DESC, pl.sort_order`, tid)
	if err == nil {
		for rows.Next() {
			var x platformLive
			rows.Scan(&x.Name, &x.Key, &x.Color, &x.Live)
			dist = append(dist, x)
		}
		rows.Close()
	}
	recent, _ := s.App.QueryEpisodes(ctx, `SELECT `+app.EpisodeColsLight+` FROM episodes e JOIN podcasts p ON p.id=e.podcast_id
		WHERE p.id IN (SELECT podcast_id FROM tenant_podcast_ids($1)) ORDER BY e.updated_at DESC LIMIT 8`, tid)
	from, to := time.Now().AddDate(0, 0, -30), time.Now().Add(time.Hour)
	sum, _ := s.App.Summary(ctx, app.AnalyticsFilter{TenantIDs: []int64{tid}, From: from, To: to})
	writeData(w, map[string]any{"scope": "tenant", "tenant_id": tid, "tenant_name": tenantName, "stats": stats,
		"distribution": dist, "recent_episodes": recent, "analytics_30d": sum})
}

func (s *Server) masterDashboard(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	stats := map[string]int64{}
	queries := map[string]string{
		"tenants":              `SELECT count(*) FROM tenants`,
		"domains":              `SELECT count(*) FROM domains`,
		"podcasts":             `SELECT count(*) FROM podcasts`,
		"episodes":             `SELECT count(*) FROM episodes`,
		"plays":                `SELECT COALESCE(sum(events),0) FROM analytics_daily WHERE event_type='PLAY'`,
		"storage_bytes":        `SELECT COALESCE((SELECT sum(original_size+processed_size) FROM audio_files),0) + COALESCE((SELECT sum(size) FROM images),0)`,
		"distribution_live":    `SELECT count(*) FROM podcast_distributions WHERE status='LIVE'`,
		"distribution_pending": `SELECT count(*) FROM podcast_distributions WHERE status IN ('READY','SUBMITTED','PENDING')`,
		"distribution_issues":  `SELECT count(*) FROM podcast_distributions WHERE status IN ('ACTION_REQUIRED','FAILED','REJECTED')`,
	}
	for k, q := range queries {
		var n int64
		s.App.DB.QueryRow(ctx, q).Scan(&n)
		stats[k] = n
	}
	recent, _ := s.App.QueryEpisodes(ctx, `SELECT `+app.EpisodeColsLight+` FROM episodes e JOIN podcasts p ON p.id=e.podcast_id
		ORDER BY e.created_at DESC LIMIT 10`)

	type alert struct {
		Severity string    `json:"severity"`
		Source   string    `json:"source"`
		Message  string    `json:"message"`
		Link     string    `json:"link"`
		At       time.Time `json:"at"`
	}
	alerts := []alert{}
	rows, err := s.App.DB.Query(ctx, `SELECT level, source, message, created_at FROM system_logs
		WHERE NOT resolved AND level IN ('error','critical') AND created_at > now() - interval '7 days' ORDER BY created_at DESC LIMIT 10`)
	if err == nil {
		for rows.Next() {
			var a alert
			rows.Scan(&a.Severity, &a.Source, &a.Message, &a.At)
			a.Link = "/system/logs"
			alerts = append(alerts, a)
		}
		rows.Close()
	}
	var failedJobs int
	s.App.DB.QueryRow(ctx, `SELECT count(*) FROM job_runs WHERE status='FAILED' AND created_at > now() - interval '24 hours'`).Scan(&failedJobs)
	if failedJobs > 0 {
		alerts = append(alerts, alert{Severity: "error", Source: "queue", Message: fmt.Sprintf("%d background job(s) failed in the last 24h", failedJobs), Link: "/system/jobs", At: time.Now()})
	}
	var critical int
	s.App.DB.QueryRow(ctx, `SELECT count(*) FROM (SELECT DISTINCT ON (podcast_id) status FROM rss_health_checks ORDER BY podcast_id, checked_at DESC) x
		WHERE status='CRITICAL'`).Scan(&critical)
	if critical > 0 {
		alerts = append(alerts, alert{Severity: "warning", Source: "rss", Message: fmt.Sprintf("%d podcast feed(s) in CRITICAL health", critical), Link: "/rss-health", At: time.Now()})
	}
	var badDomains int
	s.App.DB.QueryRow(ctx, `SELECT count(*) FROM domains WHERE verification_status='FAILED' OR dns_status='MISCONFIGURED' OR ssl_status='FAILED'`).Scan(&badDomains)
	if badDomains > 0 {
		alerts = append(alerts, alert{Severity: "warning", Source: "domains", Message: fmt.Sprintf("%d domain(s) need attention", badDomains), Link: "/domains", At: time.Now()})
	}
	var warnGB float64
	var storageCfg struct {
		WarningGB float64 `json:"warning_threshold_gb"`
	}
	if s.App.SystemSetting(ctx, "storage", &storageCfg) {
		warnGB = storageCfg.WarningGB
	}
	if warnGB > 0 && float64(stats["storage_bytes"]) > warnGB*(1<<30) {
		alerts = append(alerts, alert{Severity: "warning", Source: "storage", Message: fmt.Sprintf("Storage above %.0f GB warning threshold", warnGB), Link: "/system", At: time.Now()})
	}
	qs, _ := s.App.Queue.Stats(ctx)
	from, to := time.Now().AddDate(0, 0, -30), time.Now().Add(time.Hour)
	network, _ := s.App.NetworkComparison(ctx, from, to)
	writeData(w, map[string]any{"scope": "network", "stats": stats, "recent_episodes": recent, "alerts": alerts, "queue": qs, "tenants": network})
}
