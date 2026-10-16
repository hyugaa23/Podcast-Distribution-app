package app

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ErrTranscriptionNotConfigured is returned when no speech-to-text provider is set up.
var ErrTranscriptionNotConfigured = fmt.Errorf("AI transcription provider is not configured (set TRANSCRIPTION_API_URL and TRANSCRIPTION_API_KEY)")

// TranscriptionConfigured reports whether AI transcript generation is available.
func (a *App) TranscriptionConfigured() bool {
	return a.Cfg.TranscriptionURL != "" && a.Cfg.TranscriptionKey != ""
}

// GenerateTranscript sends episode audio to an OpenAI-compatible /audio/transcriptions endpoint
// and stores a VTT transcript (PRD §32 "AI generated transcript"). The result is saved for
// editorial review and is not auto-published (PRD §109).
func (a *App) GenerateTranscript(ctx context.Context, episodeID int64) error {
	if !a.TranscriptionConfigured() {
		return ErrTranscriptionNotConfigured
	}
	var key, title string
	var tenantID *int64
	err := a.DB.QueryRow(ctx, `SELECT COALESCE(af.processed_key,''), e.title, p.owner_tenant_id FROM episodes e
		JOIN podcasts p ON p.id=e.podcast_id LEFT JOIN audio_files af ON af.id=e.audio_file_id WHERE e.id=$1`, episodeID).
		Scan(&key, &title, &tenantID)
	if err != nil {
		return err
	}
	if key == "" {
		return fmt.Errorf("episode has no processed audio in storage")
	}
	src, err := a.downloadToTemp(ctx, key, ".mp3")
	if err != nil {
		return err
	}
	defer os.Remove(src)

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	mw.WriteField("model", a.Cfg.TranscriptionModel)
	mw.WriteField("response_format", "vtt")
	fw, _ := mw.CreateFormFile("file", filepath.Base(src))
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	io.Copy(fw, f)
	f.Close()
	mw.Close()

	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(a.Cfg.TranscriptionURL, "/")+"/audio/transcriptions", &body)
	req.Header.Set("Authorization", "Bearer "+a.Cfg.TranscriptionKey)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := (&http.Client{Timeout: 30 * time.Minute}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if resp.StatusCode >= 300 {
		return fmt.Errorf("transcription provider: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(out)))
	}
	if _, err := a.DB.Exec(ctx, `UPDATE episodes SET transcript=$2, transcript_format='vtt', transcript_source='ai', transcript_approved=false, updated_at=now() WHERE id=$1`,
		episodeID, string(out)); err != nil {
		return err
	}
	a.Notify(ctx, tenantID, "transcript.generated", "info", "AI transcript ready for review",
		fmt.Sprintf("Review the generated transcript of %q before it is shown publicly.", title), fmt.Sprintf("/episodes/%d", episodeID))
	return nil
}
