package api

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"podcast/api/internal/app"
	"podcast/api/internal/util"
)

// ---------------------------------------------------------------------------
// Platform registry (PRD §21, §115) — stored in the database, extensible by admins.

func (s *Server) listPlatforms(w http.ResponseWriter, r *http.Request) {
	q := app.PlatformSelect
	if r.URL.Query().Get("active") == "1" {
		q += ` WHERE is_active`
	}
	rows, err := s.App.DB.Query(r.Context(), q+` ORDER BY sort_order, name`)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[app.Platform])
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeData(w, list)
}

type platformInput struct {
	Key                  string `json:"key"`
	Name                 string `json:"name"`
	WebsiteURL           string `json:"website_url"`
	SubmitURL            string `json:"submit_url"`
	Icon                 string `json:"icon"`
	Color                string `json:"color"`
	SubmissionType       string `json:"submission_type"`
	APIProvider          string `json:"api_provider"`
	URLPattern           string `json:"url_pattern"`
	Instructions         string `json:"instructions"`
	IsActive             *bool  `json:"is_active"`
	SortOrder            int    `json:"sort_order"`
	HelpURL              string `json:"help_url"`
	AccountRequired      *bool  `json:"account_required"`
	VerificationRequired *bool  `json:"verification_required"`
	SupportsAPI          *bool  `json:"supports_api"`
	AutoDiscovery        *bool  `json:"auto_discovery"`
	Notes                string `json:"notes"`
}

func (in *platformInput) normalize() string {
	in.Name = util.PlainText(in.Name)
	in.Instructions = util.PlainText(in.Instructions)
	in.Icon = util.PlainText(in.Icon)
	if in.Name == "" {
		return "Name is required"
	}
	if in.Key == "" {
		in.Key = in.Name
	}
	in.Key = util.Slugify(in.Key)
	if in.Color == "" {
		in.Color = "#555555"
	}
	if !util.ValidColor(in.Color) {
		return "Color must be a hex value"
	}
	for _, u := range []*string{&in.WebsiteURL, &in.SubmitURL, &in.HelpURL} {
		if _, ok := cleanURL(u); !ok {
			return "URLs must be absolute http(s) URLs"
		}
	}
	in.Notes = util.PlainText(in.Notes)
	if in.SubmissionType == "" {
		in.SubmissionType = "MANUAL"
	}
	if in.SubmissionType != "MANUAL" && in.SubmissionType != "API" {
		return "submission_type must be MANUAL or API"
	}
	if in.SubmissionType == "API" && in.APIProvider != "podcastindex" {
		return "Supported API providers: podcastindex"
	}
	return ""
}

func (s *Server) createPlatform(w http.ResponseWriter, r *http.Request) {
	var in platformInput
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if msg := in.normalize(); msg != "" {
		badRequest(w, msg)
		return
	}
	active := in.IsActive == nil || *in.IsActive
	accReq := in.AccountRequired == nil || *in.AccountRequired
	verReq := in.VerificationRequired != nil && *in.VerificationRequired
	supAPI := in.SupportsAPI != nil && *in.SupportsAPI
	autoDisc := in.AutoDiscovery != nil && *in.AutoDiscovery
	var id int64
	err := s.App.DB.QueryRow(r.Context(), `INSERT INTO platforms(key, name, website_url, submit_url, icon, color, submission_type, api_provider,
		url_pattern, instructions, is_active, sort_order,
		help_url, account_required, verification_required, supports_api, auto_discovery, notes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
		CASE WHEN $12=0 THEN (SELECT COALESCE(max(sort_order),0)+1 FROM platforms) ELSE $12 END,
		$13,$14,$15,$16,$17,$18) RETURNING id`,
		in.Key, in.Name, in.WebsiteURL, in.SubmitURL, in.Icon, in.Color, in.SubmissionType, in.APIProvider, in.URLPattern,
		in.Instructions, active, in.SortOrder,
		in.HelpURL, accReq, verReq, supAPI, autoDisc, in.Notes).Scan(&id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	s.audit(r, "CREATED_PLATFORM", "platform", id, nil, in)
	writeJSON(w, http.StatusCreated, map[string]any{"data": map[string]any{"id": id, "key": in.Key}})
}

func (s *Server) updatePlatform(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	var in platformInput
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if msg := in.normalize(); msg != "" {
		badRequest(w, msg)
		return
	}
	_, err := s.App.DB.Exec(r.Context(), `UPDATE platforms SET name=$2, website_url=$3, submit_url=$4, icon=$5, color=$6, submission_type=$7,
		api_provider=$8, url_pattern=$9, instructions=$10, is_active=COALESCE($11,is_active), sort_order=$12,
		help_url=$13, account_required=COALESCE($14,account_required), verification_required=COALESCE($15,verification_required),
		supports_api=COALESCE($16,supports_api), auto_discovery=COALESCE($17,auto_discovery), notes=$18,
		updated_at=now() WHERE id=$1`,
		id, in.Name, in.WebsiteURL, in.SubmitURL, in.Icon, in.Color, in.SubmissionType, in.APIProvider, in.URLPattern, in.Instructions,
		in.IsActive, in.SortOrder,
		in.HelpURL, in.AccountRequired, in.VerificationRequired, in.SupportsAPI, in.AutoDiscovery, in.Notes)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	s.App.Cache.DelPrefix(r.Context(), "t:")
	s.audit(r, "UPDATED_PLATFORM", "platform", id, nil, in)
	writeData(w, map[string]bool{"ok": true})
}

func (s *Server) deletePlatform(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	var used int
	s.App.DB.QueryRow(r.Context(), `SELECT count(*) FROM podcast_distributions WHERE platform_id=$1 AND status<>'NOT_STARTED'`, id).Scan(&used)
	if used > 0 && r.URL.Query().Get("force") != "1" {
		writeError(w, http.StatusConflict, "in_use", fmt.Sprintf("Platform has %d distribution records. Deactivate it instead, or pass force=1.", used))
		return
	}
	s.App.DB.Exec(r.Context(), `DELETE FROM platforms WHERE id=$1`, id)
	s.App.Cache.DelPrefix(r.Context(), "t:")
	s.audit(r, "DELETED_PLATFORM", "platform", id, nil, nil)
	writeData(w, map[string]bool{"ok": true})
}

func (s *Server) platformByParam(ctx context.Context, param string) (*app.Platform, error) {
	q := app.PlatformSelect + ` WHERE key=$1`
	var arg any = param
	if n, err := strconv.ParseInt(param, 10, 64); err == nil {
		q, arg = app.PlatformSelect+` WHERE id=$1`, n
	}
	rows, err := s.App.DB.Query(ctx, q, arg)
	if err != nil {
		return nil, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[app.Platform])
}

// ---------------------------------------------------------------------------
// Distribution records

// distributionScope restricts distribution queries to podcasts the principal may see.
func distributionScope(r *http.Request, args *[]any) string {
	p := principal(r)
	parts := []string{}
	if tid := scopeTenant(r); tid != 0 {
		*args = append(*args, tid)
		n := itoa(len(*args))
		parts = append(parts, "(p.owner_tenant_id=$"+n+" OR p.id IN (SELECT podcast_id FROM tenant_podcast_ids($"+n+")))")
	}
	if p.Role == roleCreator {
		*args = append(*args, p.UserID)
		parts = append(parts, "p.id IN (SELECT podcast_id FROM user_podcasts WHERE user_id=$"+itoa(len(*args))+")")
	}
	if len(parts) == 0 {
		return "TRUE"
	}
	return strings.Join(parts, " AND ")
}

// listDistribution backs the Pending / Submitted / Live / Failed / Issues menus (PRD §20).
func (s *Server) listDistribution(w http.ResponseWriter, r *http.Request) {
	var args []any
	where := distributionScope(r, &args)
	q := r.URL.Query()
	switch st := q.Get("status"); st {
	case "":
	case "ISSUES":
		where += " AND d.status IN ('ACTION_REQUIRED','FAILED','REJECTED')"
	case "FAILED":
		where += " AND d.status IN ('FAILED','REJECTED')"
	default:
		args = append(args, st)
		where += " AND d.status=$" + itoa(len(args))
	}
	if v := q.Get("platform"); v != "" {
		args = append(args, v)
		where += " AND pl.key=$" + itoa(len(args))
	}
	if v := queryInt64(r, "podcast_id"); v != 0 {
		args = append(args, v)
		where += " AND d.podcast_id=$" + itoa(len(args))
	}
	page, per, offset := pagination(r, 50, 500)
	var total int
	s.App.DB.QueryRow(r.Context(), `SELECT count(*) FROM podcast_distributions d JOIN podcasts p ON p.id=d.podcast_id
		JOIN platforms pl ON pl.id=d.platform_id WHERE `+where, args...).Scan(&total)
	rows, err := s.App.DB.Query(r.Context(), app.DistributionSelect+` WHERE `+where+
		fmt.Sprintf(` ORDER BY d.updated_at DESC LIMIT %d OFFSET %d`, per, offset), args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[app.Distribution])
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if list == nil {
		list = []app.Distribution{}
	}
	writeList(w, list, total, page, per)
}

type platformHealth struct {
	PlatformID int64  `json:"platform_id"`
	Key        string `json:"key"`
	Name       string `json:"name"`
	Color      string `json:"color"`
	Live       int    `json:"live"`
	Pending    int    `json:"pending"`
	Issues     int    `json:"issues"`
	Total      int    `json:"total"`
}

// distributionOverview is the Distribution Health dashboard (PRD §24, §95).
func (s *Server) distributionOverview(w http.ResponseWriter, r *http.Request) {
	var args []any
	where := distributionScope(r, &args)
	ctx := r.Context()
	counts := map[string]int{}
	for _, st := range app.DistributionStatuses {
		counts[st] = 0
	}
	rows, err := s.App.DB.Query(ctx, `SELECT d.status, count(*) FROM podcast_distributions d JOIN podcasts p ON p.id=d.podcast_id
		WHERE `+where+` GROUP BY 1`, args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	for rows.Next() {
		var st string
		var n int
		rows.Scan(&st, &n)
		counts[st] = n
	}
	rows.Close()

	perPlatform := []platformHealth{}
	rows, err = s.App.DB.Query(ctx, `SELECT pl.id, pl.key, pl.name, pl.color,
		count(d.id) FILTER (WHERE d.status='LIVE'),
		count(d.id) FILTER (WHERE d.status IN ('SUBMITTED','PENDING','PENDING_REVIEW','READY','DISCOVERY_PENDING')),
		count(d.id) FILTER (WHERE d.status IN ('ACTION_REQUIRED','FAILED','REJECTED')),
		count(d.id) FILTER (WHERE d.status<>'NOT_STARTED')
		FROM platforms pl
		LEFT JOIN (podcast_distributions d JOIN podcasts p ON p.id=d.podcast_id AND `+where+`) ON d.platform_id=pl.id
		WHERE pl.is_active GROUP BY pl.id ORDER BY 5 DESC, pl.sort_order`, args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	for rows.Next() {
		var ph platformHealth
		rows.Scan(&ph.PlatformID, &ph.Key, &ph.Name, &ph.Color, &ph.Live, &ph.Pending, &ph.Issues, &ph.Total)
		perPlatform = append(perPlatform, ph)
	}
	rows.Close()

	tracked := 0
	for st, n := range counts {
		if st != "NOT_STARTED" {
			tracked += n
		}
	}
	issues := counts["ACTION_REQUIRED"] + counts["FAILED"] + counts["REJECTED"]
	health := 100
	if tracked > 0 {
		health = (tracked - issues) * 100 / tracked
	}

	var podcasts int
	pargs := []any{}
	pwhere := strings.ReplaceAll(distributionScope(r, &pargs), "d.", "")
	s.App.DB.QueryRow(ctx, `SELECT count(*) FROM podcasts p WHERE p.status='PUBLISHED' AND `+pwhere, pargs...).Scan(&podcasts)

	issueRows, err := s.App.DB.Query(ctx, app.DistributionSelect+` WHERE `+where+
		` AND d.status IN ('ACTION_REQUIRED','FAILED','REJECTED') ORDER BY d.updated_at DESC LIMIT 20`, args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	issueList, _ := pgx.CollectRows(issueRows, pgx.RowToStructByName[app.Distribution])
	if issueList == nil {
		issueList = []app.Distribution{}
	}
	writeData(w, map[string]any{
		"counts": counts, "tracked": tracked, "issues": issues, "health_percent": health,
		"platforms": perPlatform, "published_podcasts": podcasts, "recent_issues": issueList,
	})
}

// podcastDistribution is the per-podcast Distribution dashboard with progress (PRD §24).
func (s *Server) podcastDistribution(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "podcastID")
	acc, err := s.podcastAccessFor(r.Context(), principal(r), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Read {
		forbidden(w)
		return
	}
	list, err := s.App.PodcastDistributions(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	live, total := 0, 0
	for _, d := range list {
		total++
		if d.Status == "LIVE" {
			live++
		}
	}
	pct := 0
	if total > 0 {
		pct = live * 100 / total
	}
	readiness, err := s.App.DistributionReadiness(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeData(w, map[string]any{"podcast_id": id, "platforms": list, "live": live, "total": total, "progress_percent": pct,
		"readiness": readiness, "can_manage": principal(r).Role == roleSuper || (principal(r).Role == roleTenantAdmin && acc.Read)})
}

func (s *Server) podcastReadiness(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "podcastID")
	acc, err := s.podcastAccessFor(r.Context(), principal(r), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Read {
		forbidden(w)
		return
	}
	rd, err := s.App.DistributionReadiness(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeData(w, rd)
}

// setDistribution updates status / external URL / notes for a podcast on a platform
// (manual tracking, Resolve, Add Note, Mark Submitted — PRD §25, §97).
func (s *Server) setDistribution(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "podcastID")
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
	pl, err := s.platformByParam(r.Context(), chi.URLParam(r, "platform"))
	if err != nil {
		badRequest(w, "Unknown platform")
		return
	}
	var in app.SetDistributionInput
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if in.Notes != nil {
		in.Notes = strPtr(util.PlainText(*in.Notes))
	}
	if in.IssueReason != nil {
		in.IssueReason = strPtr(util.PlainText(*in.IssueReason))
	}
	in.Note = util.PlainText(in.Note)
	// Build the URL from the platform pattern when only an external id is given.
	if (in.ExternalURL == nil || *in.ExternalURL == "") && in.ExternalID != nil && *in.ExternalID != "" && pl.URLPattern != "" {
		u := strings.ReplaceAll(pl.URLPattern, "{id}", *in.ExternalID)
		in.ExternalURL = &u
	}
	if in.Status != nil && *in.Status == "LIVE" && (in.ExternalURL == nil || *in.ExternalURL == "") {
		var existing string
		s.App.DB.QueryRow(r.Context(), `SELECT external_url FROM podcast_distributions WHERE podcast_id=$1 AND platform_id=$2`, id, pl.ID).Scan(&existing)
		if existing == "" {
			badRequest(w, "An external URL (or external id) is required to mark a platform LIVE")
			return
		}
	}
	d, err := s.App.UpsertDistribution(r.Context(), id, pl.ID, in, p.userIDPtr(), p.Email)
	if err != nil {
		if strings.Contains(err.Error(), "invalid") || strings.Contains(err.Error(), "external_url") {
			badRequest(w, err.Error())
			return
		}
		s.serverError(w, r, err)
		return
	}
	s.audit(r, "UPDATED_DISTRIBUTION", "podcast_distribution", d.ID, acc.Owner, map[string]any{"platform": pl.Key, "input": in})
	writeData(w, d)
}

// submitDistribution performs an automated submission via an official API where available (PRD §25).
func (s *Server) submitDistribution(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "podcastID")
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
	pl, err := s.platformByParam(r.Context(), chi.URLParam(r, "platform"))
	if err != nil {
		badRequest(w, "Unknown platform")
		return
	}
	rd, err := s.App.DistributionReadiness(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !rd.Ready {
		writeError(w, http.StatusUnprocessableEntity, "not_ready", fmt.Sprintf("Distribution readiness is %d%%", rd.Percent), rd)
		return
	}
	if pl.SubmissionType != "API" {
		// Manual platform: mark as submitted and return the submission link for the admin.
		st := "SUBMITTED"
		d, err := s.App.UpsertDistribution(r.Context(), id, pl.ID, app.SetDistributionInput{Status: &st, Note: "Marked submitted"}, p.userIDPtr(), p.Email)
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		s.audit(r, "SUBMITTED_DISTRIBUTION", "podcast_distribution", d.ID, acc.Owner, map[string]string{"platform": pl.Key, "mode": "manual"})
		writeData(w, map[string]any{"distribution": d, "mode": "manual", "submit_url": pl.SubmitURL, "feed_url": rd.FeedURL})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	res, err := s.App.SubmitViaAPI(ctx, pl, rd.FeedURL)
	if err != nil {
		st, reason := "FAILED", err.Error()
		s.App.UpsertDistribution(r.Context(), id, pl.ID, app.SetDistributionInput{Status: &st, IssueReason: &reason}, p.userIDPtr(), p.Email)
		writeError(w, http.StatusBadGateway, "submission_failed", reason)
		return
	}
	d, err := s.App.UpsertDistribution(r.Context(), id, pl.ID, app.SetDistributionInput{
		Status: &res.Status, ExternalID: &res.ExternalID, ExternalURL: &res.ExternalURL, Note: "Submitted via API: " + res.Message,
	}, p.userIDPtr(), p.Email)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	s.audit(r, "SUBMITTED_DISTRIBUTION", "podcast_distribution", d.ID, acc.Owner, map[string]string{"platform": pl.Key, "mode": "api"})
	writeData(w, map[string]any{"distribution": d, "mode": "api"})
}

func (s *Server) distributionEvents(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "podcastID")
	acc, err := s.podcastAccessFor(r.Context(), principal(r), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Read {
		forbidden(w)
		return
	}
	pl, err := s.platformByParam(r.Context(), chi.URLParam(r, "platform"))
	if err != nil {
		badRequest(w, "Unknown platform")
		return
	}
	rows, err := s.App.DB.Query(r.Context(), `SELECT ev.from_status, ev.to_status, ev.note, ev.user_email, ev.created_at
		FROM distribution_events ev JOIN podcast_distributions d ON d.id=ev.distribution_id
		WHERE d.podcast_id=$1 AND d.platform_id=$2 ORDER BY ev.created_at DESC LIMIT 100`, id, pl.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer rows.Close()
	type ev struct {
		From      string    `json:"from_status"`
		To        string    `json:"to_status"`
		Note      string    `json:"note"`
		User      string    `json:"user_email"`
		CreatedAt time.Time `json:"created_at"`
	}
	out := []ev{}
	for rows.Next() {
		var e ev
		rows.Scan(&e.From, &e.To, &e.Note, &e.User, &e.CreatedAt)
		out = append(out, e)
	}
	writeData(w, out)
}

// bulkDistribution sets a status on many podcast × platform combinations (PRD §87 Bulk Distribution).
func (s *Server) bulkDistribution(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	var in struct {
		PodcastIDs  []int64 `json:"podcast_ids"`
		PlatformIDs []int64 `json:"platform_ids"`
		Status      string  `json:"status"`
		Note        string  `json:"note"`
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if !app.ValidDistributionStatus(in.Status) || in.Status == "LIVE" {
		badRequest(w, "Bulk status must be a valid non-LIVE status (LIVE requires an external URL per platform)")
		return
	}
	if len(in.PodcastIDs)*len(in.PlatformIDs) == 0 || len(in.PodcastIDs)*len(in.PlatformIDs) > 5000 {
		badRequest(w, "Select podcasts and platforms (max 5000 combinations)")
		return
	}
	n := 0
	for _, pid := range in.PodcastIDs {
		acc, err := s.podcastAccessFor(r.Context(), p, pid)
		if err != nil || !acc.Read {
			continue
		}
		for _, plid := range in.PlatformIDs {
			st := in.Status
			if _, err := s.App.UpsertDistribution(r.Context(), pid, plid, app.SetDistributionInput{Status: &st, Note: util.PlainText(in.Note)},
				p.userIDPtr(), p.Email); err == nil {
				n++
			}
		}
	}
	s.audit(r, "BULK_DISTRIBUTION", "podcast_distribution", n, p.TenantID, in)
	writeData(w, map[string]int{"updated": n})
}
