package app

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"podcast/api/internal/rss"
	"podcast/api/internal/util"
)

// ChecklistItem is one entry of the distribution readiness checklist (PRD §26).
type ChecklistItem struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Passed bool   `json:"passed"`
	Detail string `json:"detail,omitempty"`
}

type Readiness struct {
	Percent   int             `json:"percent"`
	Ready     bool            `json:"ready"`
	Checklist []ChecklistItem `json:"checklist"`
	Missing   []string        `json:"missing"`
	FeedURL   string          `json:"feed_url"`
	Feed      rss.Result      `json:"feed_validation"`
}

// DistributionReadiness evaluates whether a podcast can be submitted to directories.
func (a *App) DistributionReadiness(ctx context.Context, podcastID int64) (*Readiness, error) {
	p, err := a.PodcastByID(ctx, podcastID)
	if err != nil {
		return nil, err
	}
	var published, invalidAudio int
	a.DB.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status='PUBLISHED' AND published_at<=now()),
		count(*) FILTER (WHERE status='PUBLISHED' AND (audio_url='' OR audio_size<=0 OR duration<=0))
		FROM episodes WHERE podcast_id=$1`, podcastID).Scan(&published, &invalidAudio)

	feed, _, err := a.BuildFeed(ctx, podcastID)
	if err != nil {
		return nil, err
	}
	fv := rss.Validate(feed)

	items := []ChecklistItem{
		{Key: "title", Label: "Podcast title", Passed: strings.TrimSpace(p.Title) != ""},
		{Key: "description", Label: "Description", Passed: len(strings.TrimSpace(util.StripTags(p.Description))) >= 10},
		{Key: "artwork", Label: "Artwork", Passed: p.ArtworkURL != ""},
		{Key: "owner", Label: "Owner", Passed: strings.TrimSpace(p.OwnerName) != ""},
		{Key: "email", Label: "Owner email", Passed: util.ValidEmail(p.OwnerEmail)},
		{Key: "category", Label: "Category", Passed: p.CategoryID != nil},
		{Key: "language", Label: "Language", Passed: p.Language != ""},
		{Key: "explicit", Label: "Explicit setting", Passed: true, Detail: map[bool]string{true: "Explicit", false: "Clean"}[p.Explicit]},
		{Key: "episodes", Label: "Minimum 1 episode", Passed: published > 0, Detail: fmt.Sprintf("%d published", published)},
		{Key: "audio", Label: "Valid audio", Passed: published > 0 && invalidAudio == 0},
		{Key: "rss", Label: "Valid RSS", Passed: fv.Valid},
	}
	if invalidAudio > 0 {
		items[9].Detail = fmt.Sprintf("%d episode(s) missing audio, size or duration", invalidAudio)
	}
	if !fv.Valid {
		items[10].Detail = fmt.Sprintf("%d error(s)", fv.Errors)
	}
	// Artwork must meet directory size requirements when we know the dimensions.
	var w, h int
	if a.DB.QueryRow(ctx, `SELECT width, height FROM images WHERE owner_type='podcast' AND owner_id=$1 AND status='READY'
		ORDER BY id DESC LIMIT 1`, podcastID).Scan(&w, &h) == nil && w > 0 {
		if w != h || w < 1400 || w > 3000 {
			items[2].Detail = fmt.Sprintf("Artwork is %dx%d; directories require a square image between 1400 and 3000 px", w, h)
		}
	}

	r := &Readiness{Checklist: items, Missing: []string{}, Feed: fv, FeedURL: a.FeedURL(ctx, p)}
	passed := 0
	for _, it := range items {
		if it.Passed {
			passed++
		} else {
			r.Missing = append(r.Missing, it.Label)
		}
	}
	r.Percent = passed * 100 / len(items)
	r.Ready = passed == len(items)
	return r, nil
}

// SetDistributionInput updates a podcast-platform record (manual tracking, PRD §25).
type SetDistributionInput struct {
	Status             *string `json:"status"`
	ExternalURL        *string `json:"external_url"`
	ExternalID         *string `json:"external_id"`
	Notes              *string `json:"notes"`
	IssueReason        *string `json:"issue_reason"`
	Note               string  `json:"note"`
	AccountLabel       *string `json:"account_label"`
	SubmittedBy        *string `json:"submitted_by"`
	Method             *string `json:"method"`
	VerificationMethod *string `json:"verification_method"`
}

// UpsertDistribution creates/updates the record for (podcast, platform) and logs the change.
func (a *App) UpsertDistribution(ctx context.Context, podcastID, platformID int64, in SetDistributionInput, userID *int64, userEmail string) (*Distribution, error) {
	if in.Status != nil && !ValidDistributionStatus(*in.Status) {
		return nil, fmt.Errorf("invalid status %q", *in.Status)
	}
	if in.ExternalURL != nil && *in.ExternalURL != "" {
		if _, err := util.ValidateFetchURL(*in.ExternalURL); err != nil {
			return nil, fmt.Errorf("external_url: %w", err)
		}
	}
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var id int64
	var prev string
	err = tx.QueryRow(ctx, `SELECT id, status FROM podcast_distributions WHERE podcast_id=$1 AND platform_id=$2 FOR UPDATE`,
		podcastID, platformID).Scan(&id, &prev)
	if err == pgx.ErrNoRows {
		prev = "NOT_STARTED"
		if err := tx.QueryRow(ctx, `INSERT INTO podcast_distributions(podcast_id, platform_id) VALUES ($1,$2) RETURNING id`,
			podcastID, platformID).Scan(&id); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}

	next := prev
	if in.Status != nil {
		next = *in.Status
	}
	_, err = tx.Exec(ctx, `UPDATE podcast_distributions SET
		status=$2,
		external_url=COALESCE($3, external_url),
		external_id=COALESCE($4, external_id),
		notes=COALESCE($5, notes),
		issue_reason=CASE WHEN $2 IN ('ACTION_REQUIRED','FAILED','REJECTED') THEN COALESCE($6, issue_reason)
		                  WHEN $2 <> $7 THEN '' ELSE COALESCE($6, issue_reason) END,
		submitted_at=CASE WHEN $2 IN ('SUBMITTED','PENDING','PENDING_REVIEW') AND submitted_at IS NULL THEN now() ELSE submitted_at END,
		approved_at=CASE WHEN $2='LIVE' AND $7<>'LIVE' THEN now() WHEN $2<>'LIVE' THEN NULL ELSE approved_at END,
		resolved_at=CASE WHEN $7 IN ('ACTION_REQUIRED','FAILED','REJECTED') AND $2 NOT IN ('ACTION_REQUIRED','FAILED','REJECTED') THEN now() ELSE resolved_at END,
		verified_at=CASE WHEN $2='LIVE' AND $7<>'LIVE' THEN now() ELSE verified_at END,
		account_label=COALESCE($8, account_label),
		submitted_by=COALESCE($9, submitted_by),
		method=COALESCE($10, method),
		verification_method=COALESCE($11, verification_method),
		last_checked_at=now(), updated_at=now()
		WHERE id=$1`, id, next, in.ExternalURL, in.ExternalID, in.Notes, in.IssueReason, prev,
		in.AccountLabel, in.SubmittedBy, in.Method, in.VerificationMethod)
	if err != nil {
		return nil, err
	}
	if next != prev || in.Note != "" || in.IssueReason != nil {
		note := in.Note
		if note == "" && in.IssueReason != nil {
			note = *in.IssueReason
		}
		tx.Exec(ctx, `INSERT INTO distribution_events(distribution_id, from_status, to_status, note, user_id, user_email)
			VALUES ($1,$2,$3,$4,$5,$6)`, id, prev, next, note, userID, userEmail)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	d, err := a.DistributionByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if next != prev {
		a.onDistributionStatusChange(ctx, d, prev)
	}
	if next == "LIVE" || prev == "LIVE" || in.ExternalURL != nil {
		a.InvalidatePodcast(ctx, podcastID) // public "Listen On" buttons change
	}
	return d, nil
}

func (a *App) onDistributionStatusChange(ctx context.Context, d *Distribution, prev string) {
	var owner *int64
	a.DB.QueryRow(ctx, `SELECT owner_tenant_id FROM podcasts WHERE id=$1`, d.PodcastID).Scan(&owner)
	link := fmt.Sprintf("/podcasts/%d/distribution", d.PodcastID)
	switch d.Status {
	case "LIVE":
		a.Notify(ctx, owner, "distribution.approved", "success", "Distribution approved",
			fmt.Sprintf("%s is now live on %s.", d.PodcastTitle, d.PlatformName), link)
		a.EmitWebhook(ctx, owner, "distribution.live", d)
	case "FAILED", "REJECTED":
		a.Notify(ctx, owner, "distribution.failed", "error", "Distribution failed",
			fmt.Sprintf("%s on %s: %s %s", d.PodcastTitle, d.PlatformName, d.Status, d.IssueReason), link)
		a.EmitWebhook(ctx, owner, "distribution.failed", d)
	case "ACTION_REQUIRED":
		a.Notify(ctx, owner, "distribution.action_required", "warning", "Distribution needs attention",
			fmt.Sprintf("%s on %s: %s", d.PodcastTitle, d.PlatformName, d.IssueReason), link)
	case "DISCOVERY_PENDING":
		a.Notify(ctx, owner, "distribution.discovery", "info", "Discovery pending",
			fmt.Sprintf("%s may be auto-indexed on %s — verification needed.", d.PodcastTitle, d.PlatformName), link)
	case "PAUSED":
		a.Notify(ctx, owner, "distribution.paused", "info", "Distribution paused",
			fmt.Sprintf("%s on %s has been paused.", d.PodcastTitle, d.PlatformName), link)
	}
}

func (a *App) DistributionByID(ctx context.Context, id int64) (*Distribution, error) {
	rows, err := a.DB.Query(ctx, DistributionSelect+` WHERE d.id=$1`, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[Distribution])
}

// PodcastDistributions returns one row per active platform for the podcast (virtual NOT_STARTED rows included).
func (a *App) PodcastDistributions(ctx context.Context, podcastID int64) ([]Distribution, error) {
	rows, err := a.DB.Query(ctx, `
		SELECT COALESCE(d.id,0) AS id, p.id AS podcast_id, p.title AS podcast_title, p.slug AS podcast_slug,
		       pl.id AS platform_id, pl.key AS platform_key, pl.name AS platform_name, pl.color AS platform_color,
		       COALESCE(d.status,'NOT_STARTED') AS status, COALESCE(d.external_id,'') AS external_id,
		       COALESCE(d.external_url,'') AS external_url, d.submitted_at, d.approved_at, d.last_checked_at,
		       COALESCE(d.notes,'') AS notes, COALESCE(d.issue_reason,'') AS issue_reason, d.resolved_at,
		       COALESCE(d.account_label,'') AS account_label, COALESCE(d.submitted_by,'') AS submitted_by,
		       COALESCE(d.method,'MANUAL') AS method, COALESCE(d.verification_method,'') AS verification_method,
		       d.next_review_at, d.verified_at,
		       COALESCE(d.created_at, now()) AS created_at, COALESCE(d.updated_at, now()) AS updated_at
		  FROM platforms pl
		  JOIN podcasts p ON p.id=$1
		  LEFT JOIN podcast_distributions d ON d.platform_id=pl.id AND d.podcast_id=p.id
		 WHERE pl.is_active OR d.id IS NOT NULL
		 ORDER BY pl.sort_order, pl.name`, podcastID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Distribution])
}

// ---------------------------------------------------------------------------
// Automated submission providers (PRD §25: only where the provider offers a permitted API).

type SubmitResult struct {
	ExternalID  string
	ExternalURL string
	Status      string
	Message     string
}

// SubmitViaAPI submits the feed through the platform's official API.
func (a *App) SubmitViaAPI(ctx context.Context, pl *Platform, feedURL string) (*SubmitResult, error) {
	switch pl.APIProvider {
	case "podcastindex":
		return a.podcastIndexAdd(ctx, feedURL)
	default:
		return nil, fmt.Errorf("platform %s has no automated submission provider; track it manually", pl.Name)
	}
}

// CheckViaAPI polls the provider for listing status.
func (a *App) CheckViaAPI(ctx context.Context, pl *Platform, feedURL, externalID string) (*SubmitResult, error) {
	switch pl.APIProvider {
	case "podcastindex":
		return a.podcastIndexLookup(ctx, feedURL)
	default:
		return nil, fmt.Errorf("no provider")
	}
}

func (a *App) podcastIndexRequest(ctx context.Context, path string, q url.Values) (map[string]any, error) {
	key, secret := a.Cfg.PodcastIndexKey, a.Cfg.PodcastIndexSecret
	var cfg struct {
		Key    string `json:"podcastindex_key"`
		Secret string `json:"podcastindex_secret"`
	}
	if a.SystemSetting(ctx, "api", &cfg) && cfg.Key != "" {
		key, secret = cfg.Key, cfg.Secret
	}
	if key == "" || secret == "" {
		return nil, fmt.Errorf("Podcast Index API credentials are not configured (PODCASTINDEX_API_KEY / PODCASTINDEX_API_SECRET)")
	}
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	h := sha1.Sum([]byte(key + secret + ts))
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.podcastindex.org/api/1.0"+path+"?"+q.Encode(), nil)
	req.Header.Set("User-Agent", "PodcastEngine/1.0")
	req.Header.Set("X-Auth-Key", key)
	req.Header.Set("X-Auth-Date", ts)
	req.Header.Set("Authorization", hex.EncodeToString(h[:]))
	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("podcast index: %s", resp.Status)
	}
	if resp.StatusCode >= 400 {
		return out, fmt.Errorf("podcast index: %s %v", resp.Status, out["description"])
	}
	return out, nil
}

func (a *App) podcastIndexAdd(ctx context.Context, feedURL string) (*SubmitResult, error) {
	out, err := a.podcastIndexRequest(ctx, "/add/byfeedurl", url.Values{"url": {feedURL}})
	if err != nil {
		return nil, err
	}
	res := &SubmitResult{Status: "SUBMITTED", Message: fmt.Sprint(out["description"])}
	if id, ok := out["feedId"]; ok && fmt.Sprint(id) != "0" && fmt.Sprint(id) != "<nil>" {
		res.ExternalID = fmt.Sprint(id)
		res.ExternalURL = "https://podcastindex.org/podcast/" + res.ExternalID
		res.Status = "PENDING"
	}
	return res, nil
}

func (a *App) podcastIndexLookup(ctx context.Context, feedURL string) (*SubmitResult, error) {
	out, err := a.podcastIndexRequest(ctx, "/podcasts/byfeedurl", url.Values{"url": {feedURL}})
	if err != nil {
		return nil, err
	}
	feed, _ := out["feed"].(map[string]any)
	if feed == nil || fmt.Sprint(feed["id"]) == "" || fmt.Sprint(feed["id"]) == "<nil>" {
		return &SubmitResult{Status: "PENDING", Message: "Not yet indexed"}, nil
	}
	id := strconv.FormatFloat(toFloat(feed["id"]), 'f', 0, 64)
	return &SubmitResult{Status: "LIVE", ExternalID: id, ExternalURL: "https://podcastindex.org/podcast/" + id}, nil
}

func toFloat(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case json.Number:
		f, _ := x.Float64()
		return f
	}
	f, _ := strconv.ParseFloat(fmt.Sprint(v), 64)
	return f
}

// RefreshDistribution polls API providers and checks LIVE external URLs (worker; PRD §95).
func (a *App) RefreshDistribution(ctx context.Context, distributionID int64) error {
	d, err := a.DistributionByID(ctx, distributionID)
	if err != nil {
		return err
	}
	var pl Platform
	rows, err := a.DB.Query(ctx, PlatformSelect+` WHERE id=$1`, d.PlatformID)
	if err != nil {
		return err
	}
	pl, err = pgx.CollectOneRow(rows, pgx.RowToStructByName[Platform])
	if err != nil {
		return err
	}
	p, err := a.PodcastByID(ctx, d.PodcastID)
	if err != nil {
		return err
	}

	if pl.SubmissionType == "API" && (d.Status == "SUBMITTED" || d.Status == "PENDING" || d.Status == "PENDING_REVIEW") {
		res, err := a.CheckViaAPI(ctx, &pl, a.FeedURL(ctx, p), d.ExternalID)
		if err != nil {
			a.DB.Exec(ctx, `UPDATE podcast_distributions SET last_checked_at=now() WHERE id=$1`, d.ID)
			if strings.Contains(err.Error(), "not configured") {
				return nil // provider credentials absent: status stays manual
			}
			return err
		}
		if res.Status != d.Status {
			s := res.Status
			_, err = a.UpsertDistribution(ctx, d.PodcastID, d.PlatformID, SetDistributionInput{
				Status: &s, ExternalID: &res.ExternalID, ExternalURL: &res.ExternalURL, Note: "Status refreshed via API",
			}, nil, "system")
			return err
		}
	}
	if d.Status == "LIVE" && d.ExternalURL != "" {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, d.ExternalURL, nil)
		req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; PodcastEngine/1.0)")
		resp, err := a.HTTP.Do(req)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 404 || resp.StatusCode == 410 {
				s := "ACTION_REQUIRED"
				reason := fmt.Sprintf("External listing URL returned %d.", resp.StatusCode)
				_, err = a.UpsertDistribution(ctx, d.PodcastID, d.PlatformID, SetDistributionInput{Status: &s, IssueReason: &reason}, nil, "system")
				return err
			}
		}
	}
	a.DB.Exec(ctx, `UPDATE podcast_distributions SET last_checked_at=now() WHERE id=$1`, d.ID)
	return nil
}

// EnqueueAutoDiscoveryChecks creates DISCOVERY_PENDING records for published podcasts
// on platforms that have auto_discovery=true (e.g. Overcast indexes from Apple).
func (a *App) EnqueueAutoDiscoveryChecks(ctx context.Context) {
	rows, err := a.DB.Query(ctx, `
		SELECT p.id, pl.id FROM podcasts p
		CROSS JOIN platforms pl
		WHERE p.status='PUBLISHED' AND pl.is_active AND pl.auto_discovery
		  AND NOT EXISTS (SELECT 1 FROM podcast_distributions d WHERE d.podcast_id=p.id AND d.platform_id=pl.id)
		  AND EXISTS (SELECT 1 FROM episodes e WHERE e.podcast_id=p.id AND e.status='PUBLISHED')
		LIMIT 100`)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var podcastID, platformID int64
		rows.Scan(&podcastID, &platformID)
		s := "DISCOVERY_PENDING"
		m := "INDEXED"
		a.UpsertDistribution(ctx, podcastID, platformID, SetDistributionInput{
			Status: &s, Method: &m, Note: "Auto-discovery: platform may index this podcast from other catalogs",
		}, nil, "system")
	}
}
