package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"podcast/api/internal/app"
	"podcast/api/internal/util"
)

type hostAssignment struct {
	HostID int64  `json:"host_id"`
	Role   string `json:"role"`
}

type podcastInput struct {
	Title             *string           `json:"title"`
	Slug              *string           `json:"slug"`
	Description       *string           `json:"description"`
	ShortDescription  *string           `json:"short_description"`
	ArtworkURL        *string           `json:"artwork_url"`
	BannerURL         *string           `json:"banner_url"`
	Author            *string           `json:"author"`
	OwnerName         *string           `json:"owner_name"`
	OwnerEmail        *string           `json:"owner_email"`
	Language          *string           `json:"language"`
	Explicit          *bool             `json:"explicit"`
	Copyright         *string           `json:"copyright"`
	WebsiteURL        *string           `json:"website_url"`
	PodcastType       *string           `json:"podcast_type"`
	CategoryID        *int64            `json:"category_id"`
	SubcategoryID     *int64            `json:"subcategory_id"`
	CategoryIDs       *[]int64          `json:"category_ids"`
	Tags              *[]string         `json:"tags"`
	Hosts             *[]hostAssignment `json:"hosts"`
	Status            *string           `json:"status"`
	ScheduledAt       *string           `json:"scheduled_at"`
	OwnerTenantID     *int64            `json:"owner_tenant_id"`
	CanonicalTenantID *int64            `json:"canonical_tenant_id"`
}

func cleanURL(p *string) (string, bool) {
	if p == nil {
		return "", true
	}
	v := strings.TrimSpace(*p)
	if v == "" {
		*p = ""
		return "", true
	}
	if _, err := util.ValidateFetchURL(v); err != nil && !strings.HasPrefix(v, "/") {
		return v, false
	}
	*p = v
	return v, true
}

// normalize sanitizes input (XSS protection) and validates field formats.
func (in *podcastInput) normalize() string {
	plain := func(p *string) {
		if p != nil {
			*p = util.PlainText(*p)
		}
	}
	plain(in.Title)
	plain(in.ShortDescription)
	plain(in.Author)
	plain(in.OwnerName)
	plain(in.Copyright)
	plain(in.Language)
	if in.Description != nil {
		*in.Description = util.SanitizeHTML(*in.Description)
	}
	if in.OwnerEmail != nil {
		*in.OwnerEmail = strings.ToLower(strings.TrimSpace(*in.OwnerEmail))
		if *in.OwnerEmail != "" && !util.ValidEmail(*in.OwnerEmail) {
			return "Invalid owner email"
		}
	}
	for name, u := range map[string]*string{"artwork_url": in.ArtworkURL, "banner_url": in.BannerURL, "website_url": in.WebsiteURL} {
		if _, ok := cleanURL(u); !ok {
			return name + " must be an absolute http(s) URL"
		}
	}
	if in.PodcastType != nil && *in.PodcastType != "episodic" && *in.PodcastType != "serial" {
		return "podcast_type must be episodic or serial"
	}
	if in.Status != nil {
		switch *in.Status {
		case app.PodcastDraft, app.PodcastPublished, app.PodcastScheduled, app.PodcastArchived:
		default:
			return "Invalid status"
		}
	}
	if in.Title != nil && *in.Title == "" {
		return "Title is required"
	}
	if in.Title != nil && len(*in.Title) > 500 { return "title must be under 500 characters" }
	if in.Description != nil && len(*in.Description) > 50000 { return "description must be under 50000 characters" }
	if in.ShortDescription != nil && len(*in.ShortDescription) > 300 { return "short_description must be under 300 characters" }
	if in.Author != nil && len(*in.Author) > 200 { return "author must be under 200 characters" }
	if in.Copyright != nil && len(*in.Copyright) > 200 { return "copyright must be under 200 characters" }
	if in.OwnerName != nil && len(*in.OwnerName) > 200 { return "owner_name must be under 200 characters" }
	if in.OwnerEmail != nil && len(*in.OwnerEmail) > 200 { return "owner_email must be under 200 characters" }
	return ""
}

func (s *Server) listPodcasts(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	page, per, offset := pagination(r, 25, 200)
	q := r.URL.Query()
	var where []string
	var args []any
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	if tid := scopeTenant(r); tid != 0 {
		ph := arg(tid)
		where = append(where, fmt.Sprintf("(p.owner_tenant_id=%s OR p.id IN (SELECT podcast_id FROM tenant_podcast_ids(%s)))", ph, ph))
	}
	if p.Role == roleCreator {
		where = append(where, "p.id IN (SELECT podcast_id FROM user_podcasts WHERE user_id="+arg(p.UserID)+")")
	}
	if v := q.Get("status"); v != "" {
		where = append(where, "p.status="+arg(v))
	}
	if v := q.Get("source_type"); v != "" {
		where = append(where, "p.source_type="+arg(v))
	}
	if q.Get("library") == "1" {
		where = append(where, "p.owner_tenant_id IS NULL")
	}
	if v := queryInt64(r, "category_id"); v != 0 {
		ph := arg(v)
		where = append(where, fmt.Sprintf("(p.category_id=%s OR p.subcategory_id=%s)", ph, ph))
	}
	if v := strings.TrimSpace(q.Get("q")); v != "" {
		ph := arg(v)
		where = append(where, fmt.Sprintf("(p.search_vector @@ websearch_to_tsquery('simple', %s) OR p.title ILIKE '%%' || %s || '%%')", ph, ph))
	}
	w2 := "TRUE"
	if len(where) > 0 {
		w2 = strings.Join(where, " AND ")
	}
	var total int
	if err := s.App.DB.QueryRow(r.Context(), `SELECT count(*) FROM podcasts p WHERE `+w2, args...).Scan(&total); err != nil {
		s.serverError(w, r, err)
		return
	}
	sort := map[string]string{"title": "p.title", "created": "p.created_at DESC", "updated": "p.updated_at DESC"}[q.Get("sort")]
	if sort == "" {
		sort = "p.updated_at DESC"
	}
	list, err := s.App.QueryPodcasts(r.Context(), `SELECT `+app.PodcastCols+` FROM podcasts p WHERE `+w2+
		` ORDER BY `+sort+fmt.Sprintf(" LIMIT %d OFFSET %d", per, offset), args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	for _, pc := range list {
		acc, _ := s.podcastAccessFor(r.Context(), p, pc.ID)
		pc.CanEdit = acc.Edit
	}
	writeList(w, list, total, page, per)
}

// createPodcast implements the admin workflow: details → artwork → category → owner → create (PRD §84).
func (s *Server) createPodcast(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	if p.Role != roleSuper && p.Role != roleTenantAdmin && p.Role != roleEditor {
		forbidden(w)
		return
	}
	var in podcastInput
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if in.Title == nil {
		badRequest(w, "Title is required")
		return
	}
	if msg := in.normalize(); msg != "" {
		badRequest(w, msg)
		return
	}
	// Ownership: tenant users always create in their own tenant; super admins choose (nil = central library).
	var owner *int64
	if p.IsSuper() {
		owner = in.OwnerTenantID
		if owner != nil && *owner == 0 {
			owner = nil
		}
	} else {
		t := p.Tenant()
		owner = &t
	}
	slugBase := *in.Title
	if in.Slug != nil && *in.Slug != "" {
		slugBase = *in.Slug
	}
	slug := s.App.UniquePodcastSlug(r.Context(), slugBase, 0)

	str := func(v *string) string {
		if v == nil {
			return ""
		}
		return *v
	}
	lang := str(in.Language)
	if lang == "" {
		lang = "en"
		if owner != nil {
			s.App.DB.QueryRow(r.Context(), `SELECT language FROM tenants WHERE id=$1`, *owner).Scan(&lang)
		}
	}
	ptype := str(in.PodcastType)
	if ptype == "" {
		ptype = "episodic"
	}
	explicit := in.Explicit != nil && *in.Explicit
	status := app.PodcastDraft
	if in.Status != nil {
		status = *in.Status
	}
	var scheduledAt *time.Time
	if status == app.PodcastScheduled {
		if in.ScheduledAt == nil {
			badRequest(w, "scheduled_at is required for scheduled podcasts")
			return
		}
		t, err := parseTime(*in.ScheduledAt, s.App.TenantLocation(r.Context(), owner))
		if err != nil {
			badRequest(w, "Invalid scheduled_at")
			return
		}
		scheduledAt = &t
	}

	tx, err := s.App.DB.Begin(r.Context())
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	var id int64
	err = tx.QueryRow(r.Context(), `INSERT INTO podcasts(owner_tenant_id, canonical_tenant_id, title, slug, description, short_description,
		artwork_url, banner_url, author, owner_name, owner_email, language, explicit, copyright, website_url, podcast_type,
		category_id, subcategory_id, status, scheduled_at, published_at, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
		CASE WHEN $19='PUBLISHED' THEN now() END, $21) RETURNING id`,
		owner, nilIfZeroPtr(in.CanonicalTenantID), *in.Title, slug, str(in.Description), str(in.ShortDescription), str(in.ArtworkURL),
		str(in.BannerURL), str(in.Author), str(in.OwnerName), str(in.OwnerEmail), lang, explicit, str(in.Copyright),
		str(in.WebsiteURL), ptype, nilIfZeroPtr(in.CategoryID), nilIfZeroPtr(in.SubcategoryID), status, scheduledAt, p.userIDPtr()).Scan(&id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if owner != nil {
		tx.Exec(r.Context(), `INSERT INTO tenant_podcasts(tenant_id, podcast_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, *owner, id)
	}
	if err := s.savePodcastRelations(r.Context(), tx, id, &in); err != nil {
		s.serverError(w, r, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.serverError(w, r, err)
		return
	}
	s.App.InvalidatePodcast(r.Context(), id)
	s.App.EmitWebhook(r.Context(), owner, "podcast.created", map[string]any{"podcast_id": id, "title": *in.Title})
	s.audit(r, "CREATED_PODCAST", "podcast", id, owner, in)
	s.writePodcast(w, r, id, http.StatusCreated)
}

func nilIfZeroPtr(p *int64) *int64 {
	if p == nil || *p == 0 {
		return nil
	}
	return p
}

func (s *Server) savePodcastRelations(ctx context.Context, tx pgx.Tx, id int64, in *podcastInput) error {
	if in.Tags != nil {
		if err := s.App.SetPodcastTags(ctx, tx, id, *in.Tags); err != nil {
			return err
		}
	}
	if in.CategoryIDs != nil {
		tx.Exec(ctx, `DELETE FROM podcast_categories WHERE podcast_id=$1`, id)
		for _, c := range *in.CategoryIDs {
			if _, err := tx.Exec(ctx, `INSERT INTO podcast_categories(podcast_id, category_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, c); err != nil {
				return err
			}
		}
	}
	if in.Hosts != nil {
		tx.Exec(ctx, `DELETE FROM podcast_hosts WHERE podcast_id=$1`, id)
		for i, h := range *in.Hosts {
			role := h.Role
			if role == "" {
				role = "host"
			}
			if _, err := tx.Exec(ctx, `INSERT INTO podcast_hosts(podcast_id, host_id, role, sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
				id, h.HostID, util.PlainText(role), i); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Server) writePodcast(w http.ResponseWriter, r *http.Request, id int64, status int) {
	pc, err := s.App.PodcastByID(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	acc, _ := s.podcastAccessFor(r.Context(), principal(r), id)
	pc.CanEdit = acc.Edit
	pc.FeedURL = s.App.FeedURL(r.Context(), pc)
	writeJSON(w, status, map[string]any{"data": pc})
}

func (s *Server) getPodcast(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	acc, err := s.podcastAccessFor(r.Context(), principal(r), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Read {
		forbidden(w)
		return
	}
	s.writePodcast(w, r, id, http.StatusOK)
}

func (s *Server) updatePodcast(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	p := principal(r)
	acc, err := s.podcastAccessFor(r.Context(), p, id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Edit {
		forbidden(w)
		return
	}
	var in podcastInput
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if msg := in.normalize(); msg != "" {
		badRequest(w, msg)
		return
	}
	cur, err := s.App.PodcastByID(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	newSlug := cur.Slug
	if in.Slug != nil && util.Slugify(*in.Slug) != cur.Slug && *in.Slug != "" {
		newSlug = s.App.UniquePodcastSlug(r.Context(), *in.Slug, id)
	}
	ownerSet := false
	var owner *int64
	if in.OwnerTenantID != nil {
		if !p.IsSuper() {
			forbidden(w)
			return
		}
		ownerSet = true
		owner = nilIfZeroPtr(in.OwnerTenantID)
	}
	var scheduledAt *time.Time
	if in.Status != nil && *in.Status == app.PodcastScheduled {
		if in.ScheduledAt == nil {
			badRequest(w, "scheduled_at is required for scheduled podcasts")
			return
		}
		t, err := parseTime(*in.ScheduledAt, s.App.TenantLocation(r.Context(), cur.OwnerTenantID))
		if err != nil {
			badRequest(w, "Invalid scheduled_at")
			return
		}
		scheduledAt = &t
	}
	clearCat := in.CategoryID != nil && *in.CategoryID == 0
	clearSub := in.SubcategoryID != nil && *in.SubcategoryID == 0
	clearCanon := in.CanonicalTenantID != nil && *in.CanonicalTenantID == 0

	tx, err := s.App.DB.Begin(r.Context())
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	_, err = tx.Exec(r.Context(), `UPDATE podcasts SET
		title=COALESCE($2,title), slug=$3, description=COALESCE($4,description), short_description=COALESCE($5,short_description),
		artwork_url=COALESCE($6,artwork_url), banner_url=COALESCE($7,banner_url), author=COALESCE($8,author),
		owner_name=COALESCE($9,owner_name), owner_email=COALESCE($10,owner_email), language=COALESCE($11,language),
		explicit=COALESCE($12,explicit), copyright=COALESCE($13,copyright), website_url=COALESCE($14,website_url),
		podcast_type=COALESCE($15,podcast_type),
		category_id=CASE WHEN $16 THEN NULL ELSE COALESCE($17,category_id) END,
		subcategory_id=CASE WHEN $18 THEN NULL ELSE COALESCE($19,subcategory_id) END,
		status=COALESCE($20,status),
		scheduled_at=CASE WHEN COALESCE($20,status)='SCHEDULED' THEN COALESCE($21,scheduled_at) ELSE NULL END,
		published_at=CASE WHEN COALESCE($20,status)='PUBLISHED' THEN COALESCE(published_at, now()) ELSE published_at END,
		owner_tenant_id=CASE WHEN $22 THEN $23 ELSE owner_tenant_id END,
		canonical_tenant_id=CASE WHEN $24 THEN NULL ELSE COALESCE($25,canonical_tenant_id) END,
		updated_at=now() WHERE id=$1`,
		id, in.Title, newSlug, in.Description, in.ShortDescription, in.ArtworkURL, in.BannerURL, in.Author, in.OwnerName,
		in.OwnerEmail, in.Language, in.Explicit, in.Copyright, in.WebsiteURL, in.PodcastType,
		clearCat, nilIfZeroPtr(in.CategoryID), clearSub, nilIfZeroPtr(in.SubcategoryID), in.Status, scheduledAt,
		ownerSet, owner, clearCanon, nilIfZeroPtr(in.CanonicalTenantID))
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if ownerSet && owner != nil {
		tx.Exec(r.Context(), `INSERT INTO tenant_podcasts(tenant_id, podcast_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, *owner, id)
	}
	if err := s.savePodcastRelations(r.Context(), tx, id, &in); err != nil {
		s.serverError(w, r, err)
		return
	}
	// Slug changed → automatic 301 redirects for the page, episodes and RSS feed (PRD §89, §116).
	if newSlug != cur.Slug {
		for from, to := range map[string]string{
			"/podcast/" + cur.Slug:            "/podcast/" + newSlug,
			"/feed/" + cur.Slug + ".xml":       "/feed/" + newSlug + ".xml",
			"/podcast/" + cur.Slug + "/feed.xml": "/podcast/" + newSlug + "/feed.xml",
		} {
			tx.Exec(r.Context(), `INSERT INTO redirects(tenant_id, from_path, to_path, status_code, is_auto) VALUES (NULL,$1,$2,301,true)
				ON CONFLICT (COALESCE(tenant_id,0), from_path) DO UPDATE SET to_path=EXCLUDED.to_path`, from, to)
		}
		// Chains: anything that pointed at the old URL now points at the new one.
		tx.Exec(r.Context(), `UPDATE redirects SET to_path=$2 WHERE to_path=$1`, "/podcast/"+cur.Slug, "/podcast/"+newSlug)
		tx.Exec(r.Context(), `DELETE FROM redirects WHERE from_path=$1 AND tenant_id IS NULL`, "/podcast/"+newSlug)
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.serverError(w, r, err)
		return
	}
	if in.Status != nil && *in.Status == app.PodcastPublished && cur.Status != app.PodcastPublished {
		s.App.PublishPodcast(r.Context(), id)
	}
	s.App.InvalidatePodcast(r.Context(), id)
	if cur.OwnerTenantID != nil && ownerSet {
		s.App.InvalidateTenant(r.Context(), *cur.OwnerTenantID)
	}
	s.audit(r, "UPDATED_PODCAST", "podcast", id, cur.OwnerTenantID, in)
	s.writePodcast(w, r, id, http.StatusOK)
}

func (s *Server) deletePodcast(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	acc, err := s.podcastAccessFor(r.Context(), principal(r), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Delete {
		forbidden(w)
		return
	}
	tenants := s.App.TenantsShowingPodcast(r.Context(), id)
	tag, err := s.App.DB.Exec(r.Context(), `DELETE FROM podcasts WHERE id=$1`, id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 { notFound(w); return }
	for _, t := range tenants {
		s.App.InvalidateTenant(r.Context(), t)
	}
	s.App.Cache.DelPrefix(r.Context(), fmt.Sprintf("feed:%d:", id))
	s.audit(r, "DELETED_PODCAST", "podcast", id, acc.Owner, nil)
	writeData(w, map[string]bool{"ok": true})
}

func (s *Server) publishPodcast(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	acc, err := s.podcastAccessFor(r.Context(), principal(r), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Edit {
		forbidden(w)
		return
	}
	if err := s.App.PublishPodcast(r.Context(), id); err != nil {
		s.serverError(w, r, err)
		return
	}
	s.audit(r, "PUBLISHED_PODCAST", "podcast", id, acc.Owner, nil)
	s.writePodcast(w, r, id, http.StatusOK)
}

func (s *Server) unpublishPodcast(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	acc, err := s.podcastAccessFor(r.Context(), principal(r), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Edit {
		forbidden(w)
		return
	}
	s.App.DB.Exec(r.Context(), `UPDATE podcasts SET status='DRAFT', updated_at=now() WHERE id=$1`, id)
	s.App.InvalidatePodcast(r.Context(), id)
	s.audit(r, "UNPUBLISHED_PODCAST", "podcast", id, acc.Owner, nil)
	s.writePodcast(w, r, id, http.StatusOK)
}

func (s *Server) podcastEpisodes(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	acc, err := s.podcastAccessFor(r.Context(), principal(r), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Read {
		forbidden(w)
		return
	}
	page, per, offset := pagination(r, 50, 500)
	var total int
	s.App.DB.QueryRow(r.Context(), `SELECT count(*) FROM episodes WHERE podcast_id=$1`, id).Scan(&total)
	list, err := s.App.QueryEpisodes(r.Context(), `SELECT `+app.EpisodeColsLight+` FROM episodes e JOIN podcasts p ON p.id=e.podcast_id
		WHERE e.podcast_id=$1 ORDER BY COALESCE(e.published_at, e.scheduled_at, e.created_at) DESC, e.id DESC LIMIT $2 OFFSET $3`, id, per, offset)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeList(w, list, total, page, per)
}

// podcastFeedInfo returns the permanent feed URL, the generated XML and its validation result.
func (s *Server) podcastFeedInfo(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	acc, err := s.podcastAccessFor(r.Context(), principal(r), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Read {
		forbidden(w)
		return
	}
	xml, pc, err := s.App.BuildFeed(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if r.URL.Query().Get("format") == "xml" {
		w.Header().Set("Content-Type", "application/rss+xml; charset=utf-8")
		w.Write(xml)
		return
	}
	writeData(w, map[string]any{"feed_url": s.App.FeedURL(r.Context(), pc), "validation": rssValidate(xml), "size": len(xml)})
}

func (s *Server) podcastRSSHealth(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	acc, err := s.podcastAccessFor(r.Context(), principal(r), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Read {
		forbidden(w)
		return
	}
	rows, err := s.App.DB.Query(r.Context(), `SELECT status, checks, checked_at FROM rss_health_checks WHERE podcast_id=$1 ORDER BY checked_at DESC LIMIT 10`, id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer rows.Close()
	type hc struct {
		Status    string            `json:"status"`
		Checks    []app.HealthCheck `json:"checks"`
		CheckedAt time.Time         `json:"checked_at"`
	}
	out := []hc{}
	for rows.Next() {
		var h hc
		rows.Scan(&h.Status, &h.Checks, &h.CheckedAt)
		out = append(out, h)
	}
	writeData(w, out)
}

func (s *Server) runPodcastRSSHealth(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	acc, err := s.podcastAccessFor(r.Context(), principal(r), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Read {
		forbidden(w)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	h, err := s.App.CheckRSSHealth(ctx, id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeData(w, h)
}

// ---------------------------------------------------------------------------
// Network syndication (PRD §10, §90, §91, §114)

func (s *Server) podcastTenants(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	p := principal(r)
	acc, err := s.podcastAccessFor(r.Context(), p, id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Read {
		forbidden(w)
		return
	}
	rows, err := s.App.DB.Query(r.Context(), `
		SELECT t.id, t.name, t.content_mode,
		  COALESCE((SELECT domain FROM domains WHERE tenant_id=t.id AND is_primary LIMIT 1),''),
		  EXISTS(SELECT 1 FROM tenant_podcast_ids(t.id) x WHERE x.podcast_id=$1) AS assigned,
		  tp.podcast_id IS NOT NULL AS linked,
		  COALESCE(tp.is_featured,false), COALESCE(tp.is_editors_pick,false), COALESCE(tp.hidden,false),
		  COALESCE(tp.seo_title,''), COALESCE(tp.meta_description,''), COALESCE(tp.featured_image_url,''), tp.category_id,
		  COALESCE(tp.canonical_mode,'SELF'),
		  COALESCE(p.owner_tenant_id = t.id, false) AS is_owner,
		  CASE WHEN p.owner_tenant_id = t.id THEN true
		       WHEN t.content_mode='INDEPENDENT' THEN false
		       WHEN p.owner_tenant_id IS NOT NULL AND (SELECT content_mode FROM tenants WHERE id=p.owner_tenant_id)='INDEPENDENT' THEN false
		       ELSE true END AS can_assign
		FROM tenants t JOIN podcasts p ON p.id=$1
		LEFT JOIN tenant_podcasts tp ON tp.tenant_id=t.id AND tp.podcast_id=$1
		WHERE ($2::bigint = 0 OR t.id=$2)
		ORDER BY t.name`, id, func() int64 {
		if p.IsSuper() {
			return 0
		}
		return p.Tenant()
	}())
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer rows.Close()
	type row struct {
		TenantID         int64  `json:"tenant_id"`
		TenantName       string `json:"tenant_name"`
		ContentMode      string `json:"content_mode"`
		Domain           string `json:"domain"`
		Assigned         bool   `json:"assigned"`
		Linked           bool   `json:"linked"`
		IsFeatured       bool   `json:"is_featured"`
		IsEditorsPick    bool   `json:"is_editors_pick"`
		Hidden           bool   `json:"hidden"`
		SEOTitle         string `json:"seo_title"`
		MetaDescription  string `json:"meta_description"`
		FeaturedImageURL string `json:"featured_image_url"`
		CategoryID       *int64 `json:"category_id"`
		CanonicalMode    string `json:"canonical_mode"`
		IsOwner          bool   `json:"is_owner"`
		CanAssign        bool   `json:"can_assign"`
	}
	out := []row{}
	for rows.Next() {
		var x row
		if err := rows.Scan(&x.TenantID, &x.TenantName, &x.ContentMode, &x.Domain, &x.Assigned, &x.Linked, &x.IsFeatured,
			&x.IsEditorsPick, &x.Hidden, &x.SEOTitle, &x.MetaDescription, &x.FeaturedImageURL, &x.CategoryID, &x.CanonicalMode,
			&x.IsOwner, &x.CanAssign); err != nil {
			s.serverError(w, r, err)
			return
		}
		out = append(out, x)
	}
	writeData(w, out)
}

// setPodcastTenants sets the list of sites a podcast is published on ("Distribution Across Sites").
func (s *Server) setPodcastTenants(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	var in struct {
		TenantIDs         []int64 `json:"tenant_ids"`
		CanonicalTenantID *int64  `json:"canonical_tenant_id"`
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	var owner *int64
	var ownerMode string
	if err := s.App.DB.QueryRow(r.Context(), `SELECT p.owner_tenant_id, COALESCE(t.content_mode,'') FROM podcasts p
		LEFT JOIN tenants t ON t.id=p.owner_tenant_id WHERE p.id=$1`, id).Scan(&owner, &ownerMode); err != nil {
		s.serverError(w, r, err)
		return
	}
	want := map[int64]bool{}
	for _, t := range in.TenantIDs {
		want[t] = true
	}
	if owner != nil {
		want[*owner] = true // the owner always keeps its podcast
	}
	for t := range want {
		if owner != nil && t == *owner {
			continue
		}
		var mode string
		if err := s.App.DB.QueryRow(r.Context(), `SELECT content_mode FROM tenants WHERE id=$1`, t).Scan(&mode); err != nil {
			badRequest(w, fmt.Sprintf("Unknown tenant %d", t))
			return
		}
		if mode == app.ModeIndependent {
			badRequest(w, fmt.Sprintf("Tenant %d is in Independent mode and only shows its own podcasts", t))
			return
		}
		if ownerMode == app.ModeIndependent {
			badRequest(w, "This podcast belongs to an Independent tenant and cannot be syndicated")
			return
		}
	}
	before := s.App.TenantsShowingPodcast(r.Context(), id)
	tx, err := s.App.DB.Begin(r.Context())
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	ids := make([]int64, 0, len(want))
	for t := range want {
		ids = append(ids, t)
		tx.Exec(r.Context(), `INSERT INTO tenant_podcasts(tenant_id, podcast_id) VALUES ($1,$2)
			ON CONFLICT (tenant_id, podcast_id) DO UPDATE SET hidden=false, updated_at=now()`, t, id)
	}
	// Remove links not wanted. Shared-mode tenants see library podcasts implicitly, so hide instead of delete.
	tx.Exec(r.Context(), `DELETE FROM tenant_podcasts tp USING tenants t WHERE tp.podcast_id=$1 AND t.id=tp.tenant_id
		AND NOT (tp.tenant_id = ANY($2)) AND NOT (t.content_mode='SHARED' AND $3::bigint IS NULL)`, id, ids, owner)
	tx.Exec(r.Context(), `INSERT INTO tenant_podcasts(tenant_id, podcast_id, hidden)
		SELECT t.id, $1, true FROM tenants t WHERE t.content_mode='SHARED' AND $3::bigint IS NULL AND NOT (t.id = ANY($2))
		ON CONFLICT (tenant_id, podcast_id) DO UPDATE SET hidden=true`, id, ids, owner)
	if in.CanonicalTenantID != nil {
		tx.Exec(r.Context(), `UPDATE podcasts SET canonical_tenant_id=$2 WHERE id=$1`, id, nilIfZeroPtr(in.CanonicalTenantID))
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.serverError(w, r, err)
		return
	}
	for _, t := range before {
		s.App.InvalidateTenant(r.Context(), t)
	}
	s.App.InvalidatePodcast(r.Context(), id)
	s.audit(r, "UPDATED_SYNDICATION", "podcast", id, owner, in)
	s.podcastTenants(w, r)
}

// setTenantOverride saves tenant-specific SEO title, description, image, category, featured status (PRD §91).
func (s *Server) setTenantOverride(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	tenantID := idParam(r, "tenantID")
	if !canManageTenant(principal(r), tenantID) {
		forbidden(w)
		return
	}
	if !s.App.PodcastVisibleOnTenantAnyStatus(r.Context(), tenantID, id) {
		badRequest(w, "Podcast is not published on this tenant")
		return
	}
	var in struct {
		IsFeatured       *bool   `json:"is_featured"`
		IsEditorsPick    *bool   `json:"is_editors_pick"`
		Hidden           *bool   `json:"hidden"`
		SEOTitle         *string `json:"seo_title"`
		MetaDescription  *string `json:"meta_description"`
		FeaturedImageURL *string `json:"featured_image_url"`
		CategoryID       *int64  `json:"category_id"`
		CanonicalMode    *string `json:"canonical_mode"`
		SortOrder        *int    `json:"sort_order"`
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if in.CanonicalMode != nil && *in.CanonicalMode != "SELF" && *in.CanonicalMode != "PRIMARY" {
		badRequest(w, "canonical_mode must be SELF or PRIMARY")
		return
	}
	if _, ok := cleanURL(in.FeaturedImageURL); !ok {
		badRequest(w, "featured_image_url must be a URL")
		return
	}
	plain := func(p *string) *string {
		if p == nil {
			return nil
		}
		v := util.PlainText(*p)
		return &v
	}
	clearCat := in.CategoryID != nil && *in.CategoryID == 0
	_, err := s.App.DB.Exec(r.Context(), `INSERT INTO tenant_podcasts(tenant_id, podcast_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, tenantID, id)
	if err == nil {
		_, err = s.App.DB.Exec(r.Context(), `UPDATE tenant_podcasts SET is_featured=COALESCE($3,is_featured),
			is_editors_pick=COALESCE($4,is_editors_pick), hidden=COALESCE($5,hidden), seo_title=COALESCE($6,seo_title),
			meta_description=COALESCE($7,meta_description), featured_image_url=COALESCE($8,featured_image_url),
			category_id=CASE WHEN $9 THEN NULL ELSE COALESCE($10,category_id) END, canonical_mode=COALESCE($11,canonical_mode),
			sort_order=COALESCE($12,sort_order), updated_at=now() WHERE tenant_id=$1 AND podcast_id=$2`,
			tenantID, id, in.IsFeatured, in.IsEditorsPick, in.Hidden, plain(in.SEOTitle), plain(in.MetaDescription),
			in.FeaturedImageURL, clearCat, nilIfZeroPtr(in.CategoryID), in.CanonicalMode, in.SortOrder)
	}
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	s.App.InvalidateTenant(r.Context(), tenantID)
	s.audit(r, "UPDATED_TENANT_OVERRIDE", "podcast", id, &tenantID, in)
	writeData(w, map[string]bool{"ok": true})
}

// ---------------------------------------------------------------------------
// Bulk operations (PRD §87)

func (s *Server) bulkPodcasts(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	var in struct {
		Action     string  `json:"action"` // publish, unpublish, archive, category, assign_tenants, delete
		IDs        []int64 `json:"ids"`
		CategoryID int64   `json:"category_id"`
		TenantIDs  []int64 `json:"tenant_ids"`
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if len(in.IDs) == 0 || len(in.IDs) > 500 {
		badRequest(w, "Provide between 1 and 500 ids")
		return
	}
	if in.Action == "assign_tenants" && !p.IsSuper() {
		forbidden(w)
		return
	}
	results := map[string][]int64{"ok": {}, "skipped": {}}
	for _, id := range in.IDs {
		acc, err := s.podcastAccessFor(r.Context(), p, id)
		allowed := err == nil && acc.Edit
		if in.Action == "delete" {
			allowed = err == nil && acc.Delete
		}
		if !allowed {
			results["skipped"] = append(results["skipped"], id)
			continue
		}
		var opErr error
		switch in.Action {
		case "publish":
			opErr = s.App.PublishPodcast(r.Context(), id)
		case "unpublish":
			_, opErr = s.App.DB.Exec(r.Context(), `UPDATE podcasts SET status='DRAFT', updated_at=now() WHERE id=$1`, id)
		case "archive":
			_, opErr = s.App.DB.Exec(r.Context(), `UPDATE podcasts SET status='ARCHIVED', updated_at=now() WHERE id=$1`, id)
		case "category":
			_, opErr = s.App.DB.Exec(r.Context(), `UPDATE podcasts SET category_id=$2, subcategory_id=NULL, updated_at=now() WHERE id=$1`, id, nilIfZero(in.CategoryID))
		case "assign_tenants":
			for _, t := range in.TenantIDs {
				var mode string
				s.App.DB.QueryRow(r.Context(), `SELECT content_mode FROM tenants WHERE id=$1`, t).Scan(&mode)
				if mode == app.ModeIndependent && (acc.Owner == nil || *acc.Owner != t) {
					continue
				}
				s.App.DB.Exec(r.Context(), `INSERT INTO tenant_podcasts(tenant_id, podcast_id) VALUES ($1,$2)
					ON CONFLICT (tenant_id, podcast_id) DO UPDATE SET hidden=false`, t, id)
			}
		case "delete":
			for _, t := range s.App.TenantsShowingPodcast(r.Context(), id) {
				s.App.InvalidateTenant(r.Context(), t)
			}
			_, opErr = s.App.DB.Exec(r.Context(), `DELETE FROM podcasts WHERE id=$1`, id)
		default:
			badRequest(w, "Unknown bulk action")
			return
		}
		if opErr != nil {
			results["skipped"] = append(results["skipped"], id)
			continue
		}
		if in.Action != "delete" {
			s.App.InvalidatePodcast(r.Context(), id)
		}
		results["ok"] = append(results["ok"], id)
	}
	s.audit(r, "BULK_PODCASTS_"+strings.ToUpper(in.Action), "podcast", fmt.Sprint(results["ok"]), p.TenantID, in)
	writeData(w, results)
}
