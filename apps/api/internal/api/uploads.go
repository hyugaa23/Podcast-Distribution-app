package api

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"podcast/api/internal/media"
	"podcast/api/internal/queue"
	"podcast/api/internal/storage"
	"podcast/api/internal/util"
)

// Upload purposes and the target record each one updates.
var uploadPurposes = map[string]string{
	"episode_audio":    "audio",
	"episode_artwork":  "image",
	"transcript":       "transcript",
	"podcast_artwork":  "image",
	"podcast_banner":   "image",
	"host_photo":       "image",
	"tenant_logo":      "image",
	"tenant_favicon":   "image",
	"tenant_cover":     "image",
	"og_image":         "image",
	"collection_cover": "image",
}

var allowedAudio = map[string][]string{
	"mp3": {"audio/mpeg", "audio/mp3", "audio/mpeg3"},
	"m4a": {"audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac"},
	"wav": {"audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"},
}
var allowedImage = map[string][]string{
	"jpg": {"image/jpeg"}, "jpeg": {"image/jpeg"}, "png": {"image/png"}, "webp": {"image/webp"},
}
var allowedTranscript = map[string][]string{
	"txt": {"text/plain"}, "srt": {"application/x-subrip", "text/plain", "application/octet-stream"}, "vtt": {"text/vtt", "text/plain"},
}

const maxTranscriptBytes = 5 << 20

type uploadInit struct {
	Purpose     string `json:"purpose"`
	TargetID    int64  `json:"target_id"`
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
}

func contentTypeAllowed(table map[string][]string, ext, ct string) bool {
	types, ok := table[ext]
	if !ok {
		return false
	}
	ct = strings.ToLower(strings.TrimSpace(strings.Split(ct, ";")[0]))
	if ct == "" || ct == "application/octet-stream" {
		return true // browsers sometimes omit; content is sniffed on upload
	}
	for _, t := range types {
		if t == ct {
			return true
		}
	}
	return false
}

// authorizeUploadTarget checks the principal may modify the record the upload targets; returns tenant & storage key.
func (s *Server) authorizeUploadTarget(ctx context.Context, p *Principal, in uploadInit, ext string) (*int64, string, error) {
	name := uuid.NewString()[:12] + "." + ext
	switch in.Purpose {
	case "episode_audio", "episode_artwork", "transcript":
		acc, podcastID, err := s.episodeAccess(ctx, p, in.TargetID)
		if err != nil || !acc.Edit {
			return nil, "", errForbidden
		}
		if in.Purpose == "episode_audio" {
			return acc.Owner, storage.AudioKey(podcastID, in.TargetID, "original-"+name), nil
		}
		return acc.Owner, storage.EpisodeKey(in.TargetID, in.Purpose+"-"+name), nil
	case "podcast_artwork", "podcast_banner":
		acc, err := s.podcastAccessFor(ctx, p, in.TargetID)
		if err != nil || !acc.Edit {
			return nil, "", errForbidden
		}
		return acc.Owner, storage.PodcastKey(in.TargetID, strings.TrimPrefix(in.Purpose, "podcast_")+"-"+name), nil
	case "host_photo":
		if p.Role == roleViewer {
			return nil, "", errForbidden
		}
		var owner *int64
		if err := s.App.DB.QueryRow(ctx, `SELECT owner_tenant_id FROM hosts WHERE id=$1`, in.TargetID).Scan(&owner); err != nil {
			return nil, "", errForbidden
		}
		if !p.IsSuper() && (owner == nil || *owner != p.Tenant()) {
			return nil, "", errForbidden
		}
		tid := int64(0)
		if owner != nil {
			tid = *owner
		}
		return owner, storage.TenantImageKey(tid, "host-"+name), nil
	case "tenant_logo", "tenant_favicon", "tenant_cover", "og_image":
		if !canManageTenant(p, in.TargetID) {
			return nil, "", errForbidden
		}
		t := in.TargetID
		return &t, storage.TenantImageKey(in.TargetID, in.Purpose+"-"+name), nil
	case "collection_cover":
		var tid int64
		if err := s.App.DB.QueryRow(ctx, `SELECT tenant_id FROM collections WHERE id=$1`, in.TargetID).Scan(&tid); err != nil {
			return nil, "", errForbidden
		}
		if !canAccessTenant(p, tid) || p.Role == roleViewer || p.Role == roleCreator {
			return nil, "", errForbidden
		}
		return &tid, storage.TenantImageKey(tid, "collection-"+name), nil
	}
	return nil, "", fmt.Errorf("unknown purpose")
}

var errForbidden = fmt.Errorf("forbidden")

// initUpload validates file type/size and returns a signed direct-upload URL (PRD §77: signed uploads, MIME validation, size limit).
func (s *Server) initUpload(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	var in uploadInit
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	kind, ok := uploadPurposes[in.Purpose]
	if !ok {
		badRequest(w, "Unknown upload purpose")
		return
	}
	ext := media.ExtFor(in.Filename)
	var limit int64
	switch kind {
	case "audio":
		if !contentTypeAllowed(allowedAudio, ext, in.ContentType) {
			badRequest(w, "Unsupported audio format. Supported formats: MP3, M4A, WAV")
			return
		}
		limit = s.App.Cfg.MaxAudioUploadMB << 20
	case "image":
		if !contentTypeAllowed(allowedImage, ext, in.ContentType) {
			badRequest(w, "Unsupported image format. Use JPG, PNG or WebP")
			return
		}
		if (in.Purpose == "podcast_artwork" || in.Purpose == "episode_artwork") && ext == "webp" {
			badRequest(w, "Podcast artwork must be JPG or PNG for directory compatibility")
			return
		}
		limit = s.App.Cfg.MaxImageUploadMB << 20
	case "transcript":
		if !contentTypeAllowed(allowedTranscript, ext, in.ContentType) {
			badRequest(w, "Unsupported transcript format. Use TXT, SRT or VTT")
			return
		}
		limit = maxTranscriptBytes
	}
	if in.Size <= 0 {
		badRequest(w, "File size is required")
		return
	}
	if in.Size > limit {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", fmt.Sprintf("File exceeds the %d MB limit", limit>>20))
		return
	}
	tenantID, key, err := s.authorizeUploadTarget(r.Context(), p, in, ext)
	if err == errForbidden {
		forbidden(w)
		return
	}
	if err != nil {
		badRequest(w, err.Error())
		return
	}
	ct := in.ContentType
	if ct == "" || ct == "application/octet-stream" {
		ct = mime.TypeByExtension("." + ext)
	}
	expires := time.Now().Add(30 * time.Minute)
	var id string
	err = s.App.DB.QueryRow(r.Context(), `INSERT INTO uploads(tenant_id, user_id, kind, target_type, target_id, purpose, filename,
		content_type, size, storage_key, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
		tenantID, p.userIDPtr(), kind, in.Purpose, in.TargetID, in.Purpose, util.Truncate(filepath.Base(in.Filename), 200), ct, in.Size,
		key, expires).Scan(&id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	url, err := s.App.Storage.PresignPut(r.Context(), key, ct, 30*time.Minute)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if url == "" {
		exp := strconv.FormatInt(expires.Unix(), 10)
		sig := s.App.Signer.HMAC(id + "|" + exp)
		url = fmt.Sprintf("%s/api/uploads/%s/data?expires=%s&sig=%s", s.App.Cfg.APIPublicURL, id, exp, sig)
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": map[string]any{
		"upload_id": id, "method": "PUT", "url": url, "headers": map[string]string{"Content-Type": ct}, "expires_at": expires,
	}})
}

// uploadData receives the file for the local storage driver, authorised by the HMAC signature.
func (s *Server) uploadData(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	exp := r.URL.Query().Get("expires")
	sig := r.URL.Query().Get("sig")
	expUnix, _ := strconv.ParseInt(exp, 10, 64)
	if !s.App.Signer.VerifyHMAC(id+"|"+exp, sig) || time.Now().Unix() > expUnix {
		writeError(w, http.StatusForbidden, "invalid_signature", "Upload URL is invalid or expired")
		return
	}
	var key, kind, status string
	var size int64
	if err := s.App.DB.QueryRow(r.Context(), `SELECT storage_key, kind, status, size FROM uploads WHERE id=$1`, id).Scan(&key, &kind, &status, &size); err != nil {
		notFound(w)
		return
	}
	if status != "PENDING" {
		badRequest(w, "Upload already received")
		return
	}
	body := http.MaxBytesReader(w, r.Body, size+1024)
	br := bufio.NewReaderSize(body, 4096)
	head, _ := br.Peek(512)
	if !sniffOK(kind, head) {
		s.App.DB.Exec(r.Context(), `UPDATE uploads SET status='FAILED' WHERE id=$1`, id)
		badRequest(w, "File content does not match an allowed "+kind+" format")
		return
	}
	if err := s.App.Storage.Put(r.Context(), key, br, size, r.Header.Get("Content-Type")); err != nil {
		if strings.Contains(err.Error(), "request body too large") {
			writeError(w, http.StatusRequestEntityTooLarge, "too_large", "File is larger than declared")
			return
		}
		s.serverError(w, r, err)
		return
	}
	s.App.DB.Exec(r.Context(), `UPDATE uploads SET status='UPLOADED' WHERE id=$1`, id)
	writeData(w, map[string]bool{"ok": true})
}

func sniffOK(kind string, head []byte) bool {
	switch kind {
	case "audio":
		return util.SniffAudio(head) != ""
	case "image":
		return util.SniffImage(head) != ""
	case "transcript":
		ct := http.DetectContentType(head)
		return strings.HasPrefix(ct, "text/") || ct == "application/octet-stream"
	}
	return false
}

type uploadRow struct {
	ID, Kind, Purpose, Filename, ContentType, Key, Status string
	TenantID                                            *int64
	UserID                                              *int64
	TargetID                                            int64
	Size                                                int64
}

// completeUpload finalises an upload and applies it to its target (audio → processing queue, images → variants).
func (s *Server) completeUpload(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	id := chi.URLParam(r, "id")
	var u uploadRow
	err := s.App.DB.QueryRow(r.Context(), `SELECT id, kind, purpose, filename, content_type, storage_key, status, tenant_id, user_id, target_id, size
		FROM uploads WHERE id=$1`, id).Scan(&u.ID, &u.Kind, &u.Purpose, &u.Filename, &u.ContentType, &u.Key, &u.Status, &u.TenantID, &u.UserID, &u.TargetID, &u.Size)
	if err != nil {
		notFound(w)
		return
	}
	if u.UserID != nil && p.UserID != 0 && *u.UserID != p.UserID && !p.IsSuper() {
		forbidden(w)
		return
	}
	if u.Status == "COMPLETED" {
		badRequest(w, "Upload already completed")
		return
	}
	// Verify the object exists, respects the size limit and has valid magic bytes (S3 direct uploads bypass uploadData).
	info, err := s.App.Storage.Stat(r.Context(), u.Key)
	if err != nil {
		badRequest(w, "File has not been uploaded yet")
		return
	}
	if info.Size > u.Size+1024 {
		s.App.Storage.Delete(r.Context(), u.Key)
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "File is larger than declared")
		return
	}
	if u.Status == "PENDING" { // direct-to-S3 upload: sniff now
		rc, err := s.App.Storage.Get(r.Context(), u.Key)
		if err == nil {
			head := make([]byte, 512)
			n, _ := io.ReadFull(rc, head)
			rc.Close()
			if !sniffOK(u.Kind, head[:n]) {
				s.App.Storage.Delete(r.Context(), u.Key)
				badRequest(w, "File content does not match an allowed "+u.Kind+" format")
				return
			}
		}
	}
	url := s.App.Storage.URL(u.Key)
	result := map[string]any{"url": url, "purpose": u.Purpose, "target_id": u.TargetID}

	switch u.Purpose {
	case "episode_audio":
		var podcastID int64
		s.App.DB.QueryRow(r.Context(), `SELECT podcast_id FROM episodes WHERE id=$1`, u.TargetID).Scan(&podcastID)
		var afID int64
		err = s.App.DB.QueryRow(r.Context(), `INSERT INTO audio_files(tenant_id, podcast_id, episode_id, original_key, original_name,
			original_mime, original_size, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
			u.TenantID, podcastID, u.TargetID, u.Key, u.Filename, u.ContentType, info.Size, p.userIDPtr()).Scan(&afID)
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		s.App.DB.Exec(r.Context(), `UPDATE episodes SET audio_file_id=$2, status='PROCESSING', processing_error='', updated_at=now() WHERE id=$1`, u.TargetID, afID)
		jobID, _ := s.App.Enqueue(r.Context(), queue.ProcessAudio, map[string]any{"audio_file_id": afID},
			queue.Options{TenantID: derefInt(u.TenantID), MaxAttempts: 3})
		result["audio_file_id"], result["job_id"] = afID, jobID
		s.audit(r, "UPLOADED_AUDIO", "episode", u.TargetID, u.TenantID, map[string]any{"file": u.Filename, "size": info.Size})
	case "transcript":
		rc, err := s.App.Storage.Get(r.Context(), u.Key)
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		b, _ := io.ReadAll(io.LimitReader(rc, maxTranscriptBytes))
		rc.Close()
		format := media.ExtFor(u.Filename)
		text := strings.ReplaceAll(util.StripTags(string(b)), "\r\n", "\n")
		if format == "vtt" && !strings.HasPrefix(strings.TrimSpace(text), "WEBVTT") {
			badRequest(w, "VTT transcripts must start with WEBVTT")
			return
		}
		s.App.DB.Exec(r.Context(), `UPDATE episodes SET transcript=$2, transcript_format=$3, transcript_source='upload',
			transcript_approved=true, updated_at=now() WHERE id=$1`, u.TargetID, text, format)
		s.invalidateEpisode(r.Context(), u.TargetID)
	default: // images
		imgID := s.registerImage(r.Context(), u, info.Size)
		result["image_id"] = imgID
		if err := s.applyImage(r.Context(), u, url); err != nil {
			s.serverError(w, r, err)
			return
		}
	}
	s.App.DB.Exec(r.Context(), `UPDATE uploads SET status='COMPLETED' WHERE id=$1`, u.ID)
	writeData(w, result)
}

func (s *Server) registerImage(ctx context.Context, u uploadRow, size int64) int64 {
	ownerType := map[string]string{"podcast_artwork": "podcast", "podcast_banner": "podcast_banner", "episode_artwork": "episode",
		"host_photo": "host", "tenant_logo": "tenant_logo", "tenant_favicon": "tenant_favicon", "tenant_cover": "tenant_cover",
		"og_image": "og_image", "collection_cover": "collection"}[u.Purpose]
	var id int64
	s.App.DB.QueryRow(ctx, `INSERT INTO images(tenant_id, owner_type, owner_id, original_key, mime, size) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		u.TenantID, ownerType, u.TargetID, u.Key, u.ContentType, size).Scan(&id)
	s.App.Enqueue(ctx, queue.ProcessImage, map[string]any{"image_id": id}, queue.Options{MaxAttempts: 2})
	return id
}

func (s *Server) applyImage(ctx context.Context, u uploadRow, url string) error {
	var err error
	switch u.Purpose {
	case "podcast_artwork":
		_, err = s.App.DB.Exec(ctx, `UPDATE podcasts SET artwork_url=$2, updated_at=now() WHERE id=$1`, u.TargetID, url)
		s.App.InvalidatePodcast(ctx, u.TargetID)
	case "podcast_banner":
		_, err = s.App.DB.Exec(ctx, `UPDATE podcasts SET banner_url=$2, updated_at=now() WHERE id=$1`, u.TargetID, url)
		s.App.InvalidatePodcast(ctx, u.TargetID)
	case "episode_artwork":
		_, err = s.App.DB.Exec(ctx, `UPDATE episodes SET artwork_url=$2, updated_at=now() WHERE id=$1`, u.TargetID, url)
		s.invalidateEpisode(ctx, u.TargetID)
	case "host_photo":
		_, err = s.App.DB.Exec(ctx, `UPDATE hosts SET photo_url=$2, updated_at=now() WHERE id=$1`, u.TargetID, url)
	case "tenant_logo", "tenant_favicon", "tenant_cover":
		field := map[string]string{"tenant_logo": "logo_url", "tenant_favicon": "favicon_url", "tenant_cover": "default_cover_url"}[u.Purpose]
		patch, _ := json.Marshal(map[string]string{field: url})
		_, err = s.App.DB.Exec(ctx, `UPDATE tenant_settings SET branding = branding || $2::jsonb, updated_at=now() WHERE tenant_id=$1`, u.TargetID, patch)
		if u.Purpose == "tenant_logo" {
			s.App.DB.Exec(ctx, `UPDATE seo_settings SET organization_logo=$2 WHERE tenant_id=$1 AND organization_logo=''`, u.TargetID, url)
		}
		s.App.InvalidateTenant(ctx, u.TargetID)
	case "og_image":
		_, err = s.App.DB.Exec(ctx, `UPDATE seo_settings SET default_og_image=$2, updated_at=now() WHERE tenant_id=$1`, u.TargetID, url)
		s.App.InvalidateTenant(ctx, u.TargetID)
	case "collection_cover":
		_, err = s.App.DB.Exec(ctx, `UPDATE collections SET cover_url=$2, updated_at=now() WHERE id=$1`, u.TargetID, url)
		if u.TenantID != nil {
			s.App.InvalidateTenant(ctx, *u.TenantID)
		}
	}
	return err
}

func (s *Server) invalidateEpisode(ctx context.Context, episodeID int64) {
	var pid int64
	if s.App.DB.QueryRow(ctx, `SELECT podcast_id FROM episodes WHERE id=$1`, episodeID).Scan(&pid) == nil {
		s.App.InvalidatePodcast(ctx, pid)
	}
}

// serveLocalMedia serves files from the local storage driver with Range support (dev / single node).
func (s *Server) serveLocalMedia(w http.ResponseWriter, r *http.Request) {
	key, err := storage.CleanKey(chi.URLParam(r, "*"))
	if err != nil {
		notFound(w)
		return
	}
	local, ok := s.App.Storage.(*storage.Local)
	if !ok {
		notFound(w)
		return
	}
	path := filepath.Join(local.Dir, filepath.FromSlash(key))
	f, err := os.Open(path)
	if err != nil {
		notFound(w)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		notFound(w)
		return
	}
	if ct := mime.TypeByExtension(filepath.Ext(path)); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("Accept-Ranges", "bytes")
	http.ServeContent(w, r, filepath.Base(path), st.ModTime(), f)
}
