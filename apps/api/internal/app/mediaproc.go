package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"podcast/api/internal/media"
	"podcast/api/internal/storage"
)

// downloadToTemp copies a storage object to a temp file and returns its path.
func (a *App) downloadToTemp(ctx context.Context, key, ext string) (string, error) {
	r, err := a.Storage.Get(ctx, key)
	if err != nil {
		return "", err
	}
	defer r.Close()
	f, err := os.CreateTemp("", "pe-*"+ext)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(f, r); err != nil {
		f.Close()
		os.Remove(f.Name())
		return "", err
	}
	f.Close()
	return f.Name(), nil
}

func (a *App) putFile(ctx context.Context, key, path, contentType string) (int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	st, _ := f.Stat()
	return st.Size(), a.Storage.Put(ctx, key, f, st.Size(), contentType)
}

// ProcessAudio runs the pipeline: storage → probe/validate → normalize → MP3 → duration → ready (PRD §14).
func (a *App) ProcessAudio(ctx context.Context, audioFileID int64) error {
	var af AudioFile
	err := a.DB.QueryRow(ctx, `SELECT id, episode_id, podcast_id, original_key, original_name, tenant_id
		FROM audio_files WHERE id=$1`, audioFileID).Scan(&af.ID, &af.EpisodeID, &af.PodcastID, &af.OriginalKey, &af.OriginalName, &af.TenantID)
	if err != nil {
		return err
	}
	a.DB.Exec(ctx, `UPDATE audio_files SET status='PROCESSING', attempts=attempts+1, updated_at=now() WHERE id=$1`, af.ID)

	fail := func(err error) error {
		reason, detail := media.FriendlyReason(err)
		a.DB.Exec(ctx, `UPDATE audio_files SET status='FAILED', error_message=$2, error_detail=$3, updated_at=now() WHERE id=$1`,
			af.ID, reason, detail)
		if af.EpisodeID != nil {
			a.DB.Exec(ctx, `UPDATE episodes SET status='FAILED', processing_error=$2, updated_at=now() WHERE id=$1 AND audio_file_id=$3`,
				*af.EpisodeID, reason, af.ID)
		}
		a.SysLog(ctx, "error", "audio", fmt.Sprintf("Audio processing failed (audio_file %d): %s", af.ID, reason), detail, af.TenantID)
		a.Notify(ctx, af.TenantID, "audio.failed", "error", "Audio processing failed", reason,
			fmt.Sprintf("/episodes/%d", deref(af.EpisodeID)))
		return err
	}

	ext := filepath.Ext(af.OriginalName)
	src, err := a.downloadToTemp(ctx, af.OriginalKey, ext)
	if err != nil {
		return fail(&media.UserError{Reason: "Uploaded file could not be read from storage.", Detail: err.Error()})
	}
	defer os.Remove(src)

	info, err := a.Media.ProbeAudio(ctx, src)
	if err != nil {
		return fail(err)
	}

	var settings struct {
		BitrateKbps int  `json:"bitrate_kbps"`
		Normalize   *bool `json:"normalize"`
	}
	a.SystemSetting(ctx, "audio_processing", &settings)
	kbps := settings.BitrateKbps
	if kbps == 0 {
		kbps = 128
	}
	normalize := settings.Normalize == nil || *settings.Normalize

	out := src + ".mp3"
	defer os.Remove(out)
	tctx, cancel := context.WithTimeout(ctx, 60*time.Minute)
	defer cancel()
	if err := a.Media.TranscodeMP3(tctx, src, out, kbps, normalize); err != nil {
		return fail(err)
	}
	outInfo, err := a.Media.ProbeAudio(ctx, out)
	if err != nil {
		return fail(err)
	}

	key := storage.AudioKey(deref(af.PodcastID), deref(af.EpisodeID), uuid.NewString()[:8]+".mp3")
	size, err := a.putFile(ctx, key, out, "audio/mpeg")
	if err != nil {
		return fail(&media.UserError{Reason: "Processed audio could not be stored.", Detail: err.Error()})
	}
	duration := media.SecondsRounded(outInfo.Duration)
	_, err = a.DB.Exec(ctx, `UPDATE audio_files SET status='READY', processed_key=$2, processed_size=$3, codec=$4,
		bitrate=$5, sample_rate=$6, channels=$7, duration=$8, error_message='', error_detail='', updated_at=now() WHERE id=$1`,
		af.ID, key, size, info.Codec, info.Bitrate, info.SampleRate, info.Channels, duration)
	if err != nil {
		return err
	}

	if af.EpisodeID != nil {
		var status string
		var scheduledAt *time.Time
		var wantPublish bool
		a.DB.QueryRow(ctx, `SELECT status, scheduled_at, published_at IS NOT NULL FROM episodes WHERE id=$1`,
			*af.EpisodeID).Scan(&status, &scheduledAt, &wantPublish)
		next := EpisodeDraft
		switch {
		case scheduledAt != nil: // scheduled, or "publish when ready" (scheduled_at in the past → next scheduler tick)
			next = EpisodeScheduled
		case status == EpisodePublished || wantPublish:
			next = EpisodePublished
		}
		_, err = a.DB.Exec(ctx, `UPDATE episodes SET audio_url=$2, audio_size=$3, audio_mime='audio/mpeg', duration=$4,
			status=$5, processing_error='', updated_at=now() WHERE id=$1 AND audio_file_id=$6`,
			*af.EpisodeID, a.Storage.URL(key), size, duration, next, af.ID)
		if err != nil {
			return err
		}
		if next == EpisodePublished {
			a.InvalidatePodcast(ctx, deref(af.PodcastID))
		}
		var title string
		a.DB.QueryRow(ctx, `SELECT title FROM episodes WHERE id=$1`, *af.EpisodeID).Scan(&title)
		a.Notify(ctx, af.TenantID, "audio.completed", "success", "Audio processing completed",
			fmt.Sprintf("%q is ready (%s, %d kbps MP3).", title, formatDuration(duration), kbps),
			fmt.Sprintf("/episodes/%d", *af.EpisodeID))
	}
	return nil
}

func formatDuration(sec int) string {
	h, m, s := sec/3600, (sec%3600)/60, sec%60
	if h > 0 {
		return fmt.Sprintf("%d:%02d:%02d", h, m, s)
	}
	return fmt.Sprintf("%d:%02d", m, s)
}

func deref(p *int64) int64 {
	if p == nil {
		return 0
	}
	return *p
}

// ImageTarget describes which record an uploaded image belongs to.
type ImageTarget struct {
	OwnerType string `json:"owner_type"` // podcast, podcast_banner, episode, host, tenant_logo, tenant_favicon, tenant_cover, collection, og_image
	OwnerID   int64  `json:"owner_id"`
}

// ProcessImage generates thumbnail/small/medium/large WebP variants and stores dimensions (PRD §76).
func (a *App) ProcessImage(ctx context.Context, imageID int64) error {
	var key, ownerType string
	var ownerID *int64
	var tenantID *int64
	if err := a.DB.QueryRow(ctx, `SELECT original_key, owner_type, owner_id, tenant_id FROM images WHERE id=$1`, imageID).
		Scan(&key, &ownerType, &ownerID, &tenantID); err != nil {
		return err
	}
	src, err := a.downloadToTemp(ctx, key, filepath.Ext(key))
	if err != nil {
		return err
	}
	defer os.Remove(src)
	info, err := a.Media.ProbeImage(ctx, src)
	if err != nil {
		reason, detail := media.FriendlyReason(err)
		a.DB.Exec(ctx, `UPDATE images SET status='FAILED', error=$2 WHERE id=$1`, imageID, reason)
		a.SysLog(ctx, "warning", "image", "Image processing failed: "+reason, detail, tenantID)
		return err
	}
	variants := map[string]string{"original": a.Storage.URL(key)}
	base := strings.TrimSuffix(key, filepath.Ext(key))
	for _, v := range media.ImageVariants {
		out := fmt.Sprintf("%s-%s.webp", src, v.Name)
		if err := a.Media.ResizeWebP(ctx, src, out, v.Size); err != nil {
			os.Remove(out)
			continue
		}
		vkey := fmt.Sprintf("%s-%s.webp", base, v.Name)
		if _, err := a.putFile(ctx, vkey, out, "image/webp"); err == nil {
			variants[v.Name] = a.Storage.URL(vkey)
		}
		os.Remove(out)
	}
	vj, _ := json.Marshal(variants)
	_, err = a.DB.Exec(ctx, `UPDATE images SET status='READY', variants=$2, width=$3, height=$4 WHERE id=$1`,
		imageID, vj, info.Width, info.Height)
	return err
}
