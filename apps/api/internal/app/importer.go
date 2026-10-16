package app

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"podcast/api/internal/queue"
	"podcast/api/internal/rss"
	"podcast/api/internal/storage"
	"podcast/api/internal/util"
)

const maxFeedBytes = 30 << 20

// FetchFeed downloads and parses an external RSS feed (SSRF-protected).
func (a *App) FetchFeed(ctx context.Context, feedURL, etag, lastModified string) (*rss.ParsedFeed, *http.Response, error) {
	resp, body, err := util.FetchLimited(ctx, a.HTTP, feedURL, maxFeedBytes, map[string]string{
		"If-None-Match": etag, "If-Modified-Since": lastModified, "Accept": "application/rss+xml, application/xml, text/xml, */*",
	})
	if err != nil {
		return nil, resp, fmt.Errorf("fetch RSS: %w", err)
	}
	if resp.StatusCode == http.StatusNotModified {
		return nil, resp, nil
	}
	if resp.StatusCode >= 400 {
		return nil, resp, fmt.Errorf("fetch RSS: HTTP %d", resp.StatusCode)
	}
	pf, err := rss.Parse(body)
	if err != nil {
		return nil, resp, fmt.Errorf("validate RSS: not a valid feed (%v)", err)
	}
	if pf.Title == "" {
		return nil, resp, fmt.Errorf("validate RSS: feed has no title")
	}
	return pf, resp, nil
}

// PreviewFeed returns parsed feed metadata without saving anything.
func (a *App) PreviewFeed(ctx context.Context, feedURL string) (*rss.ParsedFeed, error) {
	pf, _, err := a.FetchFeed(ctx, feedURL, "", "")
	return pf, err
}

// ImportFeedInput configures an RSS import (PRD §18).
type ImportFeedInput struct {
	FeedURL      string `json:"feed_url"`
	Mode         string `json:"mode"` // METADATA_ONLY | MIRROR_AUDIO
	TenantID     *int64 `json:"tenant_id"`
	SyncEnabled  bool   `json:"sync_enabled"`
	SyncInterval int    `json:"sync_interval_minutes"`
	UserID       *int64 `json:"user_id"`
}

// CreateRSSSource registers a feed and enqueues the import job.
func (a *App) CreateRSSSource(ctx context.Context, in ImportFeedInput) (int64, error) {
	if _, err := util.ValidateFetchURL(in.FeedURL); err != nil {
		return 0, err
	}
	if in.Mode != "MIRROR_AUDIO" {
		in.Mode = "METADATA_ONLY"
	}
	if !validSyncInterval(in.SyncInterval) {
		in.SyncInterval = 60
	}
	var exists bool
	a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM rss_sources WHERE feed_url=$1 AND COALESCE(tenant_id,0)=COALESCE($2,0))`,
		in.FeedURL, in.TenantID).Scan(&exists)
	if exists {
		return 0, fmt.Errorf("this feed has already been imported")
	}
	var id int64
	err := a.DB.QueryRow(ctx, `INSERT INTO rss_sources(feed_url, import_mode, tenant_id, sync_enabled, sync_interval_minutes, status, created_by)
		VALUES ($1,$2,$3,$4,$5,'PENDING',$6) RETURNING id`, in.FeedURL, in.Mode, in.TenantID, in.SyncEnabled, in.SyncInterval, in.UserID).Scan(&id)
	if err != nil {
		return 0, err
	}
	_, err = a.Enqueue(ctx, queue.ImportRSS, map[string]any{"rss_source_id": id}, queue.Options{TenantID: deref(in.TenantID), MaxAttempts: 2})
	return id, err
}

// Sync frequencies offered to admins (PRD §19).
var SyncIntervals = []int{15, 30, 60, 360, 1440}

func validSyncInterval(m int) bool {
	for _, v := range SyncIntervals {
		if v == m {
			return true
		}
	}
	return false
}

type SyncResult struct {
	NewEpisodes     int `json:"new_episodes"`
	UpdatedEpisodes int `json:"updated_episodes"`
	NotModified     bool `json:"not_modified"`
}

// SyncRSSSource fetches a feed, creates the podcast on first import and inserts new episodes by GUID
// (PRD §18 import and §19 automatic synchronization).
func (a *App) SyncRSSSource(ctx context.Context, sourceID int64) (*SyncResult, error) {
	rows, err := a.DB.Query(ctx, RSSSourceSelect+` WHERE s.id=$1`, sourceID)
	if err != nil {
		return nil, err
	}
	src, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[RSSSource])
	if err != nil {
		return nil, err
	}
	var logID int64
	a.DB.QueryRow(ctx, `INSERT INTO rss_sync_logs(rss_source_id) VALUES ($1) RETURNING id`, sourceID).Scan(&logID)
	finish := func(status, msg string, res *SyncResult) {
		if res == nil {
			res = &SyncResult{}
		}
		a.DB.Exec(ctx, `UPDATE rss_sync_logs SET finished_at=now(), status=$2, message=$3, new_episodes=$4, updated_episodes=$5 WHERE id=$1`,
			logID, status, util.Truncate(msg, 2000), res.NewEpisodes, res.UpdatedEpisodes)
	}
	next := time.Now().Add(time.Duration(src.SyncIntervalMinutes) * time.Minute)
	a.DB.Exec(ctx, `UPDATE rss_sources SET status=CASE WHEN podcast_id IS NULL THEN 'IMPORTING' ELSE status END WHERE id=$1`, sourceID)

	etag, lm := src.ETag, src.LastModified
	if src.PodcastID == nil {
		etag, lm = "", ""
	}
	pf, resp, err := a.FetchFeed(ctx, src.FeedURL, etag, lm)
	if err != nil {
		a.DB.Exec(ctx, `UPDATE rss_sources SET status='ERROR', last_error=$2, next_sync_at=$3, updated_at=now() WHERE id=$1`,
			sourceID, err.Error(), next)
		finish("FAILED", err.Error(), nil)
		a.SysLog(ctx, "error", "rss", "RSS sync failed for "+src.FeedURL, err.Error(), src.TenantID)
		a.Notify(ctx, src.TenantID, "rss.error", "error", "RSS error", fmt.Sprintf("Could not sync %s: %v", src.FeedURL, err), "/imports")
		return nil, err
	}
	if pf == nil { // 304
		a.DB.Exec(ctx, `UPDATE rss_sources SET last_synced_at=now(), next_sync_at=$2, last_error='', status='ACTIVE' WHERE id=$1`, sourceID, next)
		finish("NOT_MODIFIED", "Feed not modified", nil)
		return &SyncResult{NotModified: true}, nil
	}

	podcastID := deref(src.PodcastID)
	if podcastID == 0 {
		podcastID, err = a.createImportedPodcast(ctx, &src, pf)
		if err != nil {
			a.DB.Exec(ctx, `UPDATE rss_sources SET status='ERROR', last_error=$2 WHERE id=$1`, sourceID, err.Error())
			finish("FAILED", err.Error(), nil)
			return nil, err
		}
	}

	res := &SyncResult{}
	var ptitle string
	a.DB.QueryRow(ctx, `SELECT title FROM podcasts WHERE id=$1`, podcastID).Scan(&ptitle)
	for i := len(pf.Episodes) - 1; i >= 0; i-- { // oldest first so numbering/slugs are stable
		ep := pf.Episodes[i]
		var existingID int64
		err := a.DB.QueryRow(ctx, `SELECT id FROM episodes WHERE podcast_id=$1 AND source_guid=$2`, podcastID, ep.GUID).Scan(&existingID)
		if err == nil {
			// Refresh metadata of existing episodes (title/description changes upstream).
			tag, _ := a.DB.Exec(ctx, `UPDATE episodes SET title=$2, description=$3, updated_at=now()
				WHERE id=$1 AND (title<>$2 OR description<>$3)`, existingID, util.PlainText(ep.Title), util.SanitizeHTML(ep.Description))
			if tag.RowsAffected() > 0 {
				res.UpdatedEpisodes++
			}
			continue
		}
		if err := a.insertImportedEpisode(ctx, podcastID, &src, ep); err != nil {
			a.Log.Warn("import episode failed", "guid", ep.GUID, "err", err)
			continue
		}
		res.NewEpisodes++
	}

	newETag, newLM := "", ""
	if resp != nil {
		newETag, newLM = resp.Header.Get("ETag"), resp.Header.Get("Last-Modified")
	}
	a.DB.Exec(ctx, `UPDATE rss_sources SET status='ACTIVE', last_error='', last_synced_at=now(), next_sync_at=$2,
		etag=$3, last_modified=$4, podcast_id=$5, updated_at=now() WHERE id=$1`, sourceID, next, newETag, newLM, podcastID)
	finish("SUCCESS", fmt.Sprintf("%d new, %d updated", res.NewEpisodes, res.UpdatedEpisodes), res)
	if res.NewEpisodes > 0 || res.UpdatedEpisodes > 0 {
		a.InvalidatePodcast(ctx, podcastID)
		a.DB.Exec(ctx, `UPDATE podcasts SET updated_at=now() WHERE id=$1`, podcastID)
	}
	if res.NewEpisodes > 0 && src.PodcastID != nil {
		a.Notify(ctx, src.TenantID, "rss.new_episode", "info", "New RSS episode detected",
			fmt.Sprintf("%d new episode(s) imported for %s.", res.NewEpisodes, ptitle), fmt.Sprintf("/podcasts/%d", podcastID))
	}
	a.EmitWebhook(ctx, src.TenantID, "rss.synced", map[string]any{"podcast_id": podcastID, "new_episodes": res.NewEpisodes})
	return res, nil
}

func (a *App) createImportedPodcast(ctx context.Context, src *RSSSource, pf *rss.ParsedFeed) (int64, error) {
	var catID, subID *int64
	if len(pf.Categories) > 0 {
		catID = a.categoryByName(ctx, pf.Categories[0].Name)
		if pf.Categories[0].Sub != "" {
			subID = a.categoryByName(ctx, pf.Categories[0].Sub)
		}
	}
	slug := a.UniquePodcastSlug(ctx, pf.Title, 0)
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	var id int64
	err = tx.QueryRow(ctx, `INSERT INTO podcasts(owner_tenant_id, title, slug, description, short_description, artwork_url,
		author, owner_name, owner_email, language, explicit, copyright, website_url, rss_url, source_type, podcast_type,
		category_id, subcategory_id, status, published_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'IMPORTED',$15,$16,$17,'PUBLISHED',now()) RETURNING id`,
		src.TenantID, util.PlainText(pf.Title), slug, util.SanitizeHTML(pf.Description),
		util.Truncate(util.StripTags(pf.Description), 240), pf.ImageURL, util.PlainText(pf.Author),
		util.PlainText(pf.OwnerName), strings.ToLower(pf.OwnerEmail), pf.Language, pf.Explicit,
		util.PlainText(pf.Copyright), pf.Link, src.FeedURL, pf.Type, catID, subID).Scan(&id)
	if err != nil {
		return 0, err
	}
	if src.TenantID != nil {
		tx.Exec(ctx, `INSERT INTO tenant_podcasts(tenant_id, podcast_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, *src.TenantID, id)
	}
	if pf.Author != "" {
		var hostID int64
		hslug := a.UniqueHostSlug(ctx, pf.Author, 0)
		if tx.QueryRow(ctx, `INSERT INTO hosts(owner_tenant_id, name, slug) VALUES ($1,$2,$3) RETURNING id`,
			src.TenantID, util.PlainText(pf.Author), hslug).Scan(&hostID) == nil {
			tx.Exec(ctx, `INSERT INTO podcast_hosts(podcast_id, host_id) VALUES ($1,$2)`, id, hostID)
		}
	}
	tx.Exec(ctx, `UPDATE rss_sources SET podcast_id=$2 WHERE id=$1`, src.ID, id)
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	src.PodcastID = &id

	// Import artwork into our storage so the platform does not hotlink third-party images.
	if pf.ImageURL != "" {
		if url, err := a.mirrorImage(ctx, pf.ImageURL, storage.PodcastKey(id, "artwork-"+uuid.NewString()[:8]), "podcast", id, src.TenantID); err == nil {
			a.DB.Exec(ctx, `UPDATE podcasts SET artwork_url=$2 WHERE id=$1`, id, url)
		} else {
			a.Log.Warn("artwork import failed", "err", err)
		}
	}
	a.Notify(ctx, src.TenantID, "rss.imported", "success", "Podcast imported",
		fmt.Sprintf("%s was imported from RSS.", pf.Title), fmt.Sprintf("/podcasts/%d", id))
	a.EmitWebhook(ctx, src.TenantID, "podcast.created", map[string]any{"podcast_id": id, "title": pf.Title, "source": "rss"})
	return id, nil
}

func (a *App) insertImportedEpisode(ctx context.Context, podcastID int64, src *RSSSource, ep rss.ParsedEpisode) error {
	if ep.AudioURL == "" {
		return fmt.Errorf("episode has no enclosure")
	}
	slug := a.UniqueEpisodeSlug(ctx, podcastID, ep.Title, 0)
	mime := ep.AudioType
	if mime == "" {
		mime = "audio/mpeg"
	}
	transcriptFormat := ""
	if ep.TranscriptURL != "" {
		switch {
		case strings.Contains(ep.TranscriptType, "vtt"):
			transcriptFormat = "vtt"
		case strings.Contains(ep.TranscriptType, "srt") || strings.Contains(ep.TranscriptType, "subrip"):
			transcriptFormat = "srt"
		default:
			transcriptFormat = "txt"
		}
	}
	var id int64
	err := a.DB.QueryRow(ctx, `INSERT INTO episodes(podcast_id, title, slug, description, short_description, episode_number,
		season_number, episode_type, audio_url, audio_size, audio_mime, duration, artwork_url, explicit, status, published_at,
		guid, source_guid, transcript_url, transcript_format, transcript_source)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'PUBLISHED',$15,$16,$17,$18,$19,$20) RETURNING id`,
		podcastID, util.PlainText(ep.Title), slug, util.SanitizeHTML(ep.Description),
		util.Truncate(util.StripTags(firstNonEmpty(ep.Summary, ep.Description)), 240),
		ep.EpisodeNumber, ep.SeasonNumber, ep.EpisodeType, ep.AudioURL, ep.AudioLength, mime, ep.Duration,
		ep.ImageURL, ep.Explicit, ep.PublishedAt, ep.GUID, ep.GUID, ep.TranscriptURL, transcriptFormat,
		map[bool]string{true: "upload", false: ""}[ep.TranscriptURL != ""]).Scan(&id)
	if err != nil {
		return err
	}
	if src.ImportMode == "MIRROR_AUDIO" {
		a.Enqueue(ctx, queue.MirrorAudio, map[string]any{"episode_id": id, "url": ep.AudioURL},
			queue.Options{TenantID: deref(src.TenantID), MaxAttempts: 3})
	}
	return nil
}

func (a *App) categoryByName(ctx context.Context, name string) *int64 {
	var id int64
	if a.DB.QueryRow(ctx, `SELECT id FROM categories WHERE lower(itunes_name)=lower($1) OR lower(name)=lower($1) OR slug=$2 LIMIT 1`,
		name, util.Slugify(name)).Scan(&id) != nil {
		return nil
	}
	return &id
}

// mirrorImage downloads a remote image into storage and registers it for variant processing.
func (a *App) mirrorImage(ctx context.Context, rawURL, keyBase, ownerType string, ownerID int64, tenantID *int64) (string, error) {
	_, body, err := util.FetchLimited(ctx, a.HTTP, rawURL, a.Cfg.MaxImageUploadMB<<20, nil)
	if err != nil {
		return "", err
	}
	kind := util.SniffImage(body)
	if kind == "" {
		return "", fmt.Errorf("not an image")
	}
	ext := map[string]string{"jpeg": ".jpg", "png": ".png", "webp": ".webp", "gif": ".gif"}[kind]
	key := keyBase + ext
	if err := a.Storage.Put(ctx, key, bytes.NewReader(body), int64(len(body)), "image/"+kind); err != nil {
		return "", err
	}
	var imgID int64
	a.DB.QueryRow(ctx, `INSERT INTO images(tenant_id, owner_type, owner_id, original_key, mime, size) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		tenantID, ownerType, ownerID, key, "image/"+kind, len(body)).Scan(&imgID)
	a.Enqueue(ctx, queue.ProcessImage, map[string]any{"image_id": imgID}, queue.Options{MaxAttempts: 2})
	return a.Storage.URL(key), nil
}

// MirrorEpisodeAudio copies an imported enclosure into our storage/CDN (Mirror audio mode).
func (a *App) MirrorEpisodeAudio(ctx context.Context, episodeID int64, rawURL string) error {
	var podcastID int64
	if err := a.DB.QueryRow(ctx, `SELECT podcast_id FROM episodes WHERE id=$1`, episodeID).Scan(&podcastID); err != nil {
		return err
	}
	if _, err := util.ValidateFetchURL(rawURL); err != nil {
		return err
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	req.Header.Set("User-Agent", "PodcastEngine/1.0")
	client := *a.HTTP
	client.Timeout = 2 * time.Hour
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("download audio: HTTP %d", resp.StatusCode)
	}
	max := a.Cfg.MaxAudioUploadMB << 20
	ext := path.Ext(strings.Split(rawURL, "?")[0])
	if ext == "" || len(ext) > 5 {
		ext = ".mp3"
	}
	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "audio/") {
		ct = "audio/mpeg"
	}
	key := storage.AudioKey(podcastID, episodeID, "mirror-"+uuid.NewString()[:8]+ext)
	lr := &io.LimitedReader{R: resp.Body, N: max + 1}
	if err := a.Storage.Put(ctx, key, lr, resp.ContentLength, ct); err != nil {
		return err
	}
	if lr.N <= 0 {
		a.Storage.Delete(ctx, key)
		return fmt.Errorf("audio exceeds upload size limit")
	}
	info, _ := a.Storage.Stat(ctx, key)
	_, err = a.DB.Exec(ctx, `UPDATE episodes SET audio_url=$2, audio_size=$3, audio_mime=$4, updated_at=now() WHERE id=$1`,
		episodeID, a.Storage.URL(key), info.Size, ct)
	a.InvalidatePodcast(ctx, podcastID)
	return err
}

// EnqueueDueRSSSyncs schedules SYNC_RSS for every source whose interval elapsed (worker cron).
func (a *App) EnqueueDueRSSSyncs(ctx context.Context) int {
	rows, err := a.DB.Query(ctx, `SELECT id, COALESCE(tenant_id,0) FROM rss_sources
		WHERE sync_enabled AND podcast_id IS NOT NULL AND (next_sync_at IS NULL OR next_sync_at<=now())`)
	if err != nil {
		return 0
	}
	type item struct{ id, tenant int64 }
	var items []item
	for rows.Next() {
		var it item
		rows.Scan(&it.id, &it.tenant)
		items = append(items, it)
	}
	rows.Close()
	for _, it := range items {
		a.Enqueue(ctx, queue.SyncRSS, map[string]any{"rss_source_id": it.id},
			queue.Options{TenantID: it.tenant, UniqueKey: fmt.Sprintf("sync:%d", it.id), UniqueTTL: 15 * time.Minute, MaxAttempts: 1})
	}
	return len(items)
}
