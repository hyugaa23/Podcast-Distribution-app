package app

import (
	"context"
	"errors"
	"fmt"
	"time"
)

var (
	ErrAudioNotReady = errors.New("episode audio is not ready; upload and process audio before publishing")
	ErrProcessing    = errors.New("episode audio is still processing")
)

// PublishEpisode publishes an episode now (PRD §85: Publish → RSS updated → Sitemap updated → Cache purged).
// A draft parent podcast is published along with its first episode.
func (a *App) PublishEpisode(ctx context.Context, episodeID int64) error {
	var status, audioURL string
	var podcastID int64
	var podcastStatus string
	err := a.DB.QueryRow(ctx, `SELECT e.status, e.audio_url, e.podcast_id, p.status FROM episodes e
		JOIN podcasts p ON p.id=e.podcast_id WHERE e.id=$1`, episodeID).Scan(&status, &audioURL, &podcastID, &podcastStatus)
	if err != nil {
		return err
	}
	if status == EpisodeProcessing {
		return ErrProcessing
	}
	if audioURL == "" {
		return ErrAudioNotReady
	}
	_, err = a.DB.Exec(ctx, `UPDATE episodes SET status='PUBLISHED', scheduled_at=NULL,
		published_at = CASE WHEN published_at IS NULL OR published_at > now() THEN now() ELSE published_at END,
		processing_error='', updated_at=now() WHERE id=$1`, episodeID)
	if err != nil {
		return err
	}
	if podcastStatus == PodcastDraft || podcastStatus == PodcastScheduled {
		a.PublishPodcast(ctx, podcastID)
	}
	a.afterEpisodePublished(ctx, episodeID, podcastID)
	return nil
}

func (a *App) afterEpisodePublished(ctx context.Context, episodeID, podcastID int64) {
	a.InvalidatePodcast(ctx, podcastID)
	var title, ptitle string
	var owner *int64
	a.DB.QueryRow(ctx, `SELECT e.title, p.title, p.owner_tenant_id FROM episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE e.id=$1`,
		episodeID).Scan(&title, &ptitle, &owner)
	a.EmitWebhook(ctx, owner, "episode.published", map[string]any{"episode_id": episodeID, "podcast_id": podcastID, "title": title})
	a.Log.Info("episode published", "episode_id", episodeID, "podcast", ptitle)
}

// ScheduleEpisode schedules publication at a UTC instant (PRD §86).
// Only DRAFT or PROCESSING episodes may be scheduled.
func (a *App) ScheduleEpisode(ctx context.Context, episodeID int64, at time.Time) error {
	if at.Before(time.Now()) {
		return fmt.Errorf("schedule time must be in the future")
	}
	var status, audioURL string
	var audioFileID *int64
	if err := a.DB.QueryRow(ctx, `SELECT status, COALESCE(audio_url,''), audio_file_id FROM episodes WHERE id=$1`, episodeID).Scan(&status, &audioURL, &audioFileID); err != nil {
		return err
	}
	// DRAFT, PROCESSING or already SCHEDULED episodes can be (re)scheduled.
	switch status {
	case EpisodeDraft, EpisodeProcessing, EpisodeScheduled:
		// allowed
	case EpisodePublished:
		return fmt.Errorf("cannot schedule a published episode; unpublish it first")
	case EpisodeArchived:
		return fmt.Errorf("cannot schedule an archived episode")
	case EpisodeFailed:
		return fmt.Errorf("cannot schedule an episode with failed audio; re-upload audio first")
	default:
		return fmt.Errorf("episode cannot be scheduled from status %s", status)
	}
	// Require audio: either already processed or currently processing.
	if audioURL == "" && audioFileID == nil {
		return fmt.Errorf("episode must have audio before scheduling; upload audio first")
	}
	newStatus := EpisodeScheduled
	if status == EpisodeProcessing {
		newStatus = EpisodeProcessing // stays processing; scheduled_at is honoured once audio is ready
	}
	_, err := a.DB.Exec(ctx, `UPDATE episodes SET status=$2, scheduled_at=$3, updated_at=now() WHERE id=$1`, episodeID, newStatus, at.UTC())
	return err
}

// UnpublishEpisode returns an episode to draft and removes it from feeds/sites.
func (a *App) UnpublishEpisode(ctx context.Context, episodeID int64) error {
	var podcastID int64
	if err := a.DB.QueryRow(ctx, `UPDATE episodes SET status='DRAFT', scheduled_at=NULL, updated_at=now()
		WHERE id=$1 RETURNING podcast_id`, episodeID).Scan(&podcastID); err != nil {
		return err
	}
	a.InvalidatePodcast(ctx, podcastID)
	return nil
}

// PublishPodcast marks a podcast as published.
func (a *App) PublishPodcast(ctx context.Context, podcastID int64) error {
	var owner *int64
	err := a.DB.QueryRow(ctx, `UPDATE podcasts SET status='PUBLISHED', scheduled_at=NULL,
		published_at=COALESCE(published_at, now()), updated_at=now() WHERE id=$1 RETURNING owner_tenant_id`, podcastID).Scan(&owner)
	if err != nil {
		return err
	}
	a.InvalidatePodcast(ctx, podcastID)
	return nil
}

// PublishDue publishes scheduled episodes and podcasts whose time has come (worker, PRD §86).
func (a *App) PublishDue(ctx context.Context) (int, error) {
	n := 0
	rows, err := a.DB.Query(ctx, `SELECT id FROM podcasts WHERE status='SCHEDULED' AND scheduled_at<=now()`)
	if err != nil {
		return 0, err
	}
	var pids []int64
	for rows.Next() {
		var id int64
		rows.Scan(&id)
		pids = append(pids, id)
	}
	rows.Close()
	for _, id := range pids {
		if err := a.PublishPodcast(ctx, id); err == nil {
			n++
		}
	}

	rows, err = a.DB.Query(ctx, `SELECT id FROM episodes WHERE status='SCHEDULED' AND scheduled_at<=now() AND audio_url<>''`)
	if err != nil {
		return n, err
	}
	var eids []int64
	for rows.Next() {
		var id int64
		rows.Scan(&id)
		eids = append(eids, id)
	}
	rows.Close()
	for _, id := range eids {
		// published_at is the scheduled instant, not the worker tick.
		a.DB.Exec(ctx, `UPDATE episodes SET published_at=scheduled_at WHERE id=$1`, id)
		if err := a.PublishEpisode(ctx, id); err != nil {
			a.SysLog(ctx, "error", "scheduler", fmt.Sprintf("Scheduled publish of episode %d failed", id), err.Error(), nil)
			continue
		}
		n++
	}
	return n, nil
}
