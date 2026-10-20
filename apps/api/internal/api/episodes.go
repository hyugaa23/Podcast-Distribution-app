package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"podcast/api/internal/app"
	"podcast/api/internal/queue"
	"podcast/api/internal/util"
)

type faqItem struct {
	Question string `json:"question"`
	Answer   string `json:"answer"`
}
type citation struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}

type episodeInput struct {
	PodcastID        *int64            `json:"podcast_id"`
	Title            *string           `json:"title"`
	Slug             *string           `json:"slug"`
	Description      *string           `json:"description"`
	ShortDescription *string           `json:"short_description"`
	ShowNotes        *string           `json:"show_notes"`
	EpisodeNumber    *int              `json:"episode_number"`
	SeasonNumber     *int              `json:"season_number"`
	EpisodeType      *string           `json:"episode_type"`
	ArtworkURL       *string           `json:"artwork_url"`
	AudioURL         *string           `json:"audio_url"`
	AudioSize        *int64            `json:"audio_size"`
	Duration         *int              `json:"duration"`
	PublishDate      *string           `json:"publish_date"`
	Explicit         *bool             `json:"explicit"`
	Transcript       *string           `json:"transcript"`
	TranscriptFormat *string           `json:"transcript_format"`
	TranscriptOK     *bool             `json:"transcript_approved"`
	Tags             *[]string         `json:"tags"`
	SEOTitle         *string           `json:"seo_title"`
	MetaDescription  *string           `json:"meta_description"`
	CanonicalURL     *string           `json:"canonical_url"`
	KeyTopics        *[]string         `json:"key_topics"`
	FAQ              *[]faqItem        `json:"faq"`
	Citations        *[]citation       `json:"citations"`
	Hosts            *[]hostAssignment `json:"hosts"`
	Status           *string           `json:"status"` // DRAFT | PUBLISHED | ARCHIVED (scheduling via /schedule)
	ClearEpisodeNum  bool              `json:"clear_episode_number"`
	ClearSeasonNum   bool              `json:"clear_season_number"`
	ClearPublishDate bool              `json:"clear_publish_date"`
}

func (in *episodeInput) normalize() string {
	plain := func(p *string) {
		if p != nil {
			*p = util.PlainText(*p)
		}
	}
	plain(in.Title)
	plain(in.ShortDescription)
	plain(in.SEOTitle)
	plain(in.MetaDescription)
	if in.Description != nil {
		*in.Description = util.SanitizeHTML(*in.Description)
	}
	if in.ShowNotes != nil {
		*in.ShowNotes = util.SanitizeHTML(*in.ShowNotes)
	}
	if in.Title != nil && *in.Title == "" {
		return "Episode title is required"
	}
	if in.EpisodeType != nil {
		t := strings.ToLower(*in.EpisodeType)
		if t != "full" && t != "trailer" && t != "bonus" {
			return "episode_type must be full, trailer or bonus"
		}
		in.EpisodeType = &t
	}
	for name, u := range map[string]*string{"artwork_url": in.ArtworkURL, "audio_url": in.AudioURL, "canonical_url": in.CanonicalURL} {
		if _, ok := cleanURL(u); !ok {
			return name + " must be an absolute http(s) URL"
		}
	}
	if in.TranscriptFormat != nil {
		f := strings.ToLower(*in.TranscriptFormat)
		if f != "" && f != "txt" && f != "srt" && f != "vtt" {
			return "transcript_format must be txt, srt or vtt"
		}
		in.TranscriptFormat = &f
	}
	if in.Transcript != nil {
		t := strings.ReplaceAll(*in.Transcript, "\r\n", "\n")
		t = util.StripTags(t) // transcripts are plain text; never render markup
		in.Transcript = &t
		if in.TranscriptFormat == nil {
			f := detectTranscriptFormat(t)
			in.TranscriptFormat = &f
		}
		if *in.TranscriptFormat == "vtt" && t != "" && !strings.HasPrefix(strings.TrimSpace(t), "WEBVTT") {
			return "VTT transcripts must start with WEBVTT"
		}
	}
	if in.EpisodeNumber != nil && *in.EpisodeNumber <= 0 {
		return "Episode number must be positive"
	}
	if in.SeasonNumber != nil && *in.SeasonNumber < 0 {
		return "Season number must not be negative"
	}
	if (in.EpisodeNumber != nil && *in.EpisodeNumber > 99999) || (in.SeasonNumber != nil && *in.SeasonNumber > 99999) {
		return "Episode and season numbers must be under 100000"
	}
	if in.Status != nil {
		switch *in.Status {
		case app.EpisodeDraft, app.EpisodePublished, app.EpisodeArchived:
		default:
			return "status must be DRAFT, PUBLISHED or ARCHIVED (use /schedule to schedule)"
		}
	}
	if in.KeyTopics != nil {
		for i, k := range *in.KeyTopics {
			(*in.KeyTopics)[i] = util.PlainText(k)
		}
	}
	if in.FAQ != nil {
		for i, f := range *in.FAQ {
			(*in.FAQ)[i] = faqItem{Question: util.PlainText(f.Question), Answer: util.PlainText(f.Answer)}
		}
	}
	if in.Citations != nil {
		for i, c := range *in.Citations {
			if _, err := util.ValidateFetchURL(c.URL); err != nil {
				return "Citation URLs must be absolute http(s) URLs"
			}
			(*in.Citations)[i].Title = util.PlainText(c.Title)
		}
	}
	return ""
}

func detectTranscriptFormat(t string) string {
	tt := strings.TrimSpace(t)
	switch {
	case strings.HasPrefix(tt, "WEBVTT"):
		return "vtt"
	case strings.Contains(tt, " --> ") && strings.Contains(tt, ","):
		return "srt"
	case tt == "":
		return ""
	}
	return "txt"
}

func jsonOrNil(v any, set bool) []byte {
	if !set {
		return nil
	}
	b, _ := json.Marshal(v)
	return b
}

func (s *Server) episodeAccess(ctx context.Context, p *Principal, episodeID int64) (podcastAccess, int64, error) {
	var podcastID int64
	if err := s.App.DB.QueryRow(ctx, `SELECT podcast_id FROM episodes WHERE id=$1`, episodeID).Scan(&podcastID); err != nil {
		return podcastAccess{}, 0, err
	}
	acc, err := s.podcastAccessFor(ctx, p, podcastID)
	return acc, podcastID, err
}

func (s *Server) createEpisode(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	var in episodeInput
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if in.PodcastID == nil || in.Title == nil {
		badRequest(w, "podcast_id and title are required")
		return
	}
	if msg := in.normalize(); msg != "" {
		badRequest(w, msg)
		return
	}
	if in.Title != nil && len(*in.Title) > 500 { badRequest(w, "title must be under 500 characters"); return }
	if in.ShortDescription != nil && len(*in.ShortDescription) > 300 { badRequest(w, "short_description must be under 300 characters"); return }
	if in.Description != nil && len(*in.Description) > 50000 { badRequest(w, "description must be under 50000 characters"); return }
	if in.ShowNotes != nil && len(*in.ShowNotes) > 100000 { badRequest(w, "show_notes must be under 100000 characters"); return }
	if in.SEOTitle != nil && len(*in.SEOTitle) > 200 { badRequest(w, "seo_title must be under 200 characters"); return }
	if in.MetaDescription != nil && len(*in.MetaDescription) > 500 { badRequest(w, "meta_description must be under 500 characters"); return }
	if in.CanonicalURL != nil && len(*in.CanonicalURL) > 2000 { badRequest(w, "canonical_url must be under 2000 characters"); return }
	acc, err := s.podcastAccessFor(r.Context(), p, *in.PodcastID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			badRequest(w, "Unknown podcast")
			return
		}
		s.serverError(w, r, err)
		return
	}
	if !acc.Edit {
		forbidden(w)
		return
	}
	slugBase := *in.Title
	if in.Slug != nil && *in.Slug != "" {
		slugBase = *in.Slug
	}
	slug := s.App.UniqueEpisodeSlug(r.Context(), *in.PodcastID, slugBase, 0)
	str := func(v *string) string {
		if v == nil {
			return ""
		}
		return *v
	}
	if in.EpisodeNumber == nil && (in.EpisodeType == nil || *in.EpisodeType == "full") {
		var next int
		s.App.DB.QueryRow(r.Context(), `SELECT COALESCE(max(episode_number),0)+1 FROM episodes WHERE podcast_id=$1`, *in.PodcastID).Scan(&next)
		in.EpisodeNumber = &next
	}
	etype := "full"
	if in.EpisodeType != nil {
		etype = *in.EpisodeType
	}
	var publishedAt *time.Time
	if in.PublishDate != nil && *in.PublishDate != "" {
		t, err := parseTime(*in.PublishDate, s.App.TenantLocation(r.Context(), acc.Owner))
		if err != nil {
			badRequest(w, "Invalid publish_date")
			return
		}
		publishedAt = &t
	}
	var podcastExplicit bool
	s.App.DB.QueryRow(r.Context(), `SELECT explicit FROM podcasts WHERE id=$1`, *in.PodcastID).Scan(&podcastExplicit)
	explicit := podcastExplicit
	if in.Explicit != nil {
		explicit = *in.Explicit
	}
	audioURL, audioSize, duration := str(in.AudioURL), int64(0), 0
	if in.AudioSize != nil {
		audioSize = *in.AudioSize
	}
	if in.Duration != nil {
		duration = *in.Duration
	}
	mime := ""
	if audioURL != "" {
		mime = "audio/mpeg"
		if strings.HasSuffix(strings.ToLower(strings.Split(audioURL, "?")[0]), ".m4a") {
			mime = "audio/x-m4a"
		}
	}
	tFormat, transcript := "", ""
	if in.Transcript != nil {
		transcript, tFormat = *in.Transcript, str(in.TranscriptFormat)
	}

	tx, err := s.App.DB.Begin(r.Context())
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	var id int64
	err = tx.QueryRow(r.Context(), `INSERT INTO episodes(podcast_id, title, slug, description, short_description, show_notes,
		episode_number, season_number, episode_type, artwork_url, audio_url, audio_size, audio_mime, duration, explicit,
		transcript, transcript_format, transcript_source, guid, seo_title, meta_description, canonical_url, key_topics, faq,
		citations, published_at, status, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
		COALESCE($23,'[]'::jsonb), COALESCE($24,'[]'::jsonb), COALESCE($25,'[]'::jsonb), $26, 'DRAFT', $27) RETURNING id`,
		*in.PodcastID, *in.Title, slug, str(in.Description), str(in.ShortDescription), str(in.ShowNotes),
		in.EpisodeNumber, in.SeasonNumber, etype, str(in.ArtworkURL), audioURL, audioSize, mime, duration, explicit,
		transcript, tFormat, map[bool]string{true: "manual", false: ""}[transcript != ""], uuid.NewString(),
		str(in.SEOTitle), str(in.MetaDescription), str(in.CanonicalURL),
		jsonOrNil(in.KeyTopics, in.KeyTopics != nil), jsonOrNil(in.FAQ, in.FAQ != nil), jsonOrNil(in.Citations, in.Citations != nil),
		publishedAt, p.userIDPtr()).Scan(&id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if err := s.saveEpisodeRelations(r.Context(), tx, id, &in); err != nil {
		s.serverError(w, r, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.serverError(w, r, err)
		return
	}
	s.audit(r, "CREATED_EPISODE", "episode", id, acc.Owner, map[string]any{"title": *in.Title, "podcast_id": *in.PodcastID})
	if in.Status != nil && *in.Status == app.EpisodePublished {
		if err := s.App.PublishEpisode(r.Context(), id); err != nil && !errors.Is(err, app.ErrAudioNotReady) {
			s.serverError(w, r, err)
			return
		}
	}
	s.writeEpisode(w, r, id, http.StatusCreated)
}

func (s *Server) saveEpisodeRelations(ctx context.Context, tx pgx.Tx, id int64, in *episodeInput) error {
	if in.Tags != nil {
		if err := s.App.SetEpisodeTags(ctx, tx, id, *in.Tags); err != nil {
			return err
		}
	}
	if in.Hosts != nil {
		tx.Exec(ctx, `DELETE FROM episode_hosts WHERE episode_id=$1`, id)
		for _, h := range *in.Hosts {
			role := h.Role
			if role == "" {
				role = "guest"
			}
			if _, err := tx.Exec(ctx, `INSERT INTO episode_hosts(episode_id, host_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
				id, h.HostID, util.PlainText(role)); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Server) writeEpisode(w http.ResponseWriter, r *http.Request, id int64, status int) {
	e, err := s.App.EpisodeByID(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	var audio *app.AudioFile
	if e.AudioFileID != nil {
		rows, err := s.App.DB.Query(r.Context(), `SELECT id, tenant_id, podcast_id, episode_id, original_key, original_name, original_mime,
			original_size, processed_key, processed_size, codec, bitrate, sample_rate, channels, duration, status, error_message,
			'' AS error_detail, attempts, created_at, updated_at FROM audio_files WHERE id=$1`, *e.AudioFileID)
		if err == nil {
			if af, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[app.AudioFile]); err == nil {
				audio = af
			}
		}
	}
	writeJSON(w, status, map[string]any{"data": e, "audio": audio})
}

func (s *Server) getEpisode(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	acc, _, err := s.episodeAccess(r.Context(), principal(r), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Read {
		forbidden(w)
		return
	}
	s.writeEpisode(w, r, id, http.StatusOK)
}

// listEpisodes lists episodes across all podcasts in scope (admin episodes screen).
func (s *Server) listEpisodes(w http.ResponseWriter, r *http.Request) {
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
	if v := queryInt64(r, "podcast_id"); v != 0 {
		where = append(where, "e.podcast_id="+arg(v))
	}
	if v := q.Get("status"); v != "" {
		where = append(where, "e.status="+arg(v))
	}
	if v := strings.TrimSpace(q.Get("q")); v != "" {
		ph := arg(v)
		where = append(where, fmt.Sprintf("(e.search_vector @@ websearch_to_tsquery('simple', %s) OR e.title ILIKE '%%' || %s || '%%')", ph, ph))
	}
	w2 := "TRUE"
	if len(where) > 0 {
		w2 = strings.Join(where, " AND ")
	}
	var total int
	if err := s.App.DB.QueryRow(r.Context(), `SELECT count(*) FROM episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE `+w2, args...).Scan(&total); err != nil {
		s.serverError(w, r, err)
		return
	}
	list, err := s.App.QueryEpisodes(r.Context(), `SELECT `+app.EpisodeColsLight+` FROM episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE `+w2+
		fmt.Sprintf(` ORDER BY e.updated_at DESC LIMIT %d OFFSET %d`, per, offset), args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeList(w, list, total, page, per)
}

func (s *Server) updateEpisode(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	acc, podcastID, err := s.episodeAccess(r.Context(), principal(r), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Edit {
		forbidden(w)
		return
	}
	var in episodeInput
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if msg := in.normalize(); msg != "" {
		badRequest(w, msg)
		return
	}
	if in.Title != nil && len(*in.Title) > 500 { badRequest(w, "title must be under 500 characters"); return }
	if in.ShortDescription != nil && len(*in.ShortDescription) > 300 { badRequest(w, "short_description must be under 300 characters"); return }
	if in.Description != nil && len(*in.Description) > 50000 { badRequest(w, "description must be under 50000 characters"); return }
	if in.ShowNotes != nil && len(*in.ShowNotes) > 100000 { badRequest(w, "show_notes must be under 100000 characters"); return }
	if in.SEOTitle != nil && len(*in.SEOTitle) > 200 { badRequest(w, "seo_title must be under 200 characters"); return }
	if in.MetaDescription != nil && len(*in.MetaDescription) > 500 { badRequest(w, "meta_description must be under 500 characters"); return }
	if in.CanonicalURL != nil && len(*in.CanonicalURL) > 2000 { badRequest(w, "canonical_url must be under 2000 characters"); return }
	cur, err := s.App.EpisodeByID(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	newSlug := cur.Slug
	if in.Slug != nil && *in.Slug != "" && util.Slugify(*in.Slug) != cur.Slug {
		newSlug = s.App.UniqueEpisodeSlug(r.Context(), podcastID, *in.Slug, id)
	}
	var publishedAt *time.Time
	if in.PublishDate != nil && *in.PublishDate != "" {
		t, err := parseTime(*in.PublishDate, s.App.TenantLocation(r.Context(), acc.Owner))
		if err != nil {
			badRequest(w, "Invalid publish_date")
			return
		}
		publishedAt = &t
	}
	var transcriptSource *string
	if in.Transcript != nil {
		src := "manual"
		if *in.Transcript == "" {
			src = ""
		}
		transcriptSource = &src
		ok := true
		in.TranscriptOK = &ok // a human saved it, so it is reviewed
	}
	var mime *string
	if in.AudioURL != nil {
		m := "audio/mpeg"
		if *in.AudioURL == "" {
			m = ""
		}
		mime = &m
	}

	tx, err := s.App.DB.Begin(r.Context())
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	_, err = tx.Exec(r.Context(), `UPDATE episodes SET
		title=COALESCE($2,title), slug=$3, description=COALESCE($4,description), short_description=COALESCE($5,short_description),
		show_notes=COALESCE($6,show_notes),
		episode_number=CASE WHEN $7 THEN NULL ELSE COALESCE($8,episode_number) END,
		season_number=CASE WHEN $9 THEN NULL ELSE COALESCE($10,season_number) END,
		episode_type=COALESCE($11,episode_type), artwork_url=COALESCE($12,artwork_url),
		audio_url=COALESCE($13,audio_url), audio_size=COALESCE($14,audio_size), duration=COALESCE($15,duration),
		audio_mime=COALESCE($16,audio_mime), audio_file_id=CASE WHEN $13 IS NOT NULL THEN NULL ELSE audio_file_id END,
		published_at=CASE WHEN $29 THEN NULL ELSE COALESCE($17,published_at) END, explicit=COALESCE($18,explicit),
		transcript=COALESCE($19,transcript), transcript_format=COALESCE($20,transcript_format),
		transcript_source=COALESCE($21,transcript_source), transcript_approved=COALESCE($22,transcript_approved),
		seo_title=COALESCE($23,seo_title), meta_description=COALESCE($24,meta_description), canonical_url=COALESCE($25,canonical_url),
		key_topics=COALESCE($26,key_topics), faq=COALESCE($27,faq), citations=COALESCE($28,citations),
		updated_at=now() WHERE id=$1`,
		id, in.Title, newSlug, in.Description, in.ShortDescription, in.ShowNotes,
		in.ClearEpisodeNum, in.EpisodeNumber, in.ClearSeasonNum, in.SeasonNumber,
		in.EpisodeType, in.ArtworkURL, in.AudioURL, in.AudioSize, in.Duration, mime, publishedAt, in.Explicit,
		in.Transcript, in.TranscriptFormat, transcriptSource, in.TranscriptOK,
		in.SEOTitle, in.MetaDescription, in.CanonicalURL,
		jsonOrNil(in.KeyTopics, in.KeyTopics != nil), jsonOrNil(in.FAQ, in.FAQ != nil), jsonOrNil(in.Citations, in.Citations != nil),
		in.ClearPublishDate)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if err := s.saveEpisodeRelations(r.Context(), tx, id, &in); err != nil {
		s.serverError(w, r, err)
		return
	}
	if newSlug != cur.Slug {
		base := "/podcast/" + cur.PodcastSlug + "/"
		tx.Exec(r.Context(), `INSERT INTO redirects(tenant_id, from_path, to_path, status_code, is_auto) VALUES (NULL,$1,$2,301,true)
			ON CONFLICT (COALESCE(tenant_id,0), from_path) DO UPDATE SET to_path=EXCLUDED.to_path`, base+cur.Slug, base+newSlug)
		tx.Exec(r.Context(), `UPDATE redirects SET to_path=$2 WHERE to_path=$1`, base+cur.Slug, base+newSlug)
		tx.Exec(r.Context(), `DELETE FROM redirects WHERE from_path=$1 AND tenant_id IS NULL`, base+newSlug)
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.serverError(w, r, err)
		return
	}
	if in.Status != nil && *in.Status != cur.Status {
		switch *in.Status {
		case app.EpisodePublished:
			if err := s.App.PublishEpisode(r.Context(), id); err != nil {
				s.publishError(w, r, err)
				return
			}
		case app.EpisodeDraft:
			s.App.UnpublishEpisode(r.Context(), id)
		case app.EpisodeArchived:
			s.App.DB.Exec(r.Context(), `UPDATE episodes SET status='ARCHIVED', scheduled_at=NULL WHERE id=$1`, id)
		}
	}
	s.App.InvalidatePodcast(r.Context(), podcastID)
	s.audit(r, "UPDATED_EPISODE", "episode", id, acc.Owner, in)
	s.writeEpisode(w, r, id, http.StatusOK)
}

func (s *Server) publishError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, app.ErrAudioNotReady) || errors.Is(err, app.ErrProcessing) {
		writeError(w, http.StatusUnprocessableEntity, "not_ready", err.Error())
		return
	}
	s.serverError(w, r, err)
}

func (s *Server) deleteEpisode(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	p := principal(r)
	acc, podcastID, err := s.episodeAccess(r.Context(), p, id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Edit {
		forbidden(w)
		return
	}
	tag, err := s.App.DB.Exec(r.Context(), `DELETE FROM episodes WHERE id=$1`, id)
	if err != nil { s.serverError(w, r, err); return }
	if tag.RowsAffected() == 0 { notFound(w); return }
	s.App.InvalidatePodcast(r.Context(), podcastID)
	s.audit(r, "DELETED_EPISODE", "episode", id, acc.Owner, nil)
	writeData(w, map[string]bool{"ok": true})
}

// publishEpisode publishes now. If audio is still processing it is published automatically once ready.
func (s *Server) publishEpisode(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	acc, _, err := s.episodeAccess(r.Context(), principal(r), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Edit {
		forbidden(w)
		return
	}
	err = s.App.PublishEpisode(r.Context(), id)
	if errors.Is(err, app.ErrProcessing) {
		s.App.DB.Exec(r.Context(), `UPDATE episodes SET scheduled_at=now(), updated_at=now() WHERE id=$1`, id)
		s.audit(r, "PUBLISH_WHEN_READY_EPISODE", "episode", id, acc.Owner, nil)
		writeJSON(w, http.StatusAccepted, map[string]any{"data": map[string]any{"queued": true,
			"message": "Audio is still processing; the episode will be published automatically when it is ready."}})
		return
	}
	if err != nil {
		s.publishError(w, r, err)
		return
	}
	s.audit(r, "PUBLISHED_EPISODE", "episode", id, acc.Owner, nil)
	s.writeEpisode(w, r, id, http.StatusOK)
}

func (s *Server) unpublishEpisode(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	acc, _, err := s.episodeAccess(r.Context(), principal(r), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Edit {
		forbidden(w)
		return
	}
	if err := s.App.UnpublishEpisode(r.Context(), id); err != nil {
		s.serverError(w, r, err)
		return
	}
	s.audit(r, "UNPUBLISHED_EPISODE", "episode", id, acc.Owner, nil)
	s.writeEpisode(w, r, id, http.StatusOK)
}

// scheduleEpisode accepts a local date/time interpreted in the tenant's timezone (PRD §86).
func (s *Server) scheduleEpisode(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	acc, _, err := s.episodeAccess(r.Context(), principal(r), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Edit {
		forbidden(w)
		return
	}
	var in struct {
		PublishAt string `json:"publish_at"`
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	loc := s.App.TenantLocation(r.Context(), acc.Owner)
	at, err := parseTime(in.PublishAt, loc)
	if err != nil {
		badRequest(w, "publish_at must be a date/time like 2026-10-20 09:00")
		return
	}
	if err := s.App.ScheduleEpisode(r.Context(), id, at); err != nil {
		badRequest(w, err.Error())
		return
	}
	s.audit(r, "SCHEDULED_EPISODE", "episode", id, acc.Owner, map[string]any{"publish_at": at.UTC(), "timezone": loc.String()})
	s.writeEpisode(w, r, id, http.StatusOK)
}

func (s *Server) episodeAudio(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	acc, _, err := s.episodeAccess(r.Context(), principal(r), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Read {
		forbidden(w)
		return
	}
	rows, err := s.App.DB.Query(r.Context(), `SELECT id, tenant_id, podcast_id, episode_id, original_key, original_name, original_mime,
		original_size, processed_key, processed_size, codec, bitrate, sample_rate, channels, duration, status, error_message,
		'' AS error_detail, attempts, created_at, updated_at FROM audio_files WHERE episode_id=$1 ORDER BY id DESC`, id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[app.AudioFile])
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if list == nil {
		list = []app.AudioFile{}
	}
	writeData(w, list)
}

// retryAudio re-queues failed audio processing ("[Retry]" in PRD §80).
func (s *Server) retryAudio(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	acc, _, err := s.episodeAccess(r.Context(), principal(r), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Edit {
		forbidden(w)
		return
	}
	var afID int64
	if err := s.App.DB.QueryRow(r.Context(), `SELECT audio_file_id FROM episodes WHERE id=$1 AND audio_file_id IS NOT NULL`, id).Scan(&afID); err != nil {
		badRequest(w, "This episode has no uploaded audio to process")
		return
	}
	s.App.DB.Exec(r.Context(), `UPDATE audio_files SET status='UPLOADED', error_message='', error_detail='' WHERE id=$1`, afID)
	s.App.DB.Exec(r.Context(), `UPDATE episodes SET status='PROCESSING', processing_error='' WHERE id=$1`, id)
	s.App.Enqueue(r.Context(), queue.ProcessAudio, map[string]any{"audio_file_id": afID}, queue.Options{TenantID: derefInt(acc.Owner)})
	s.audit(r, "RETRIED_AUDIO_PROCESSING", "episode", id, acc.Owner, nil)
	s.writeEpisode(w, r, id, http.StatusOK)
}

func derefInt(p *int64) int64 {
	if p == nil {
		return 0
	}
	return *p
}

func (s *Server) generateTranscript(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	acc, _, err := s.episodeAccess(r.Context(), principal(r), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Edit {
		forbidden(w)
		return
	}
	if !s.App.TranscriptionConfigured() {
		writeError(w, http.StatusUnprocessableEntity, "not_configured", app.ErrTranscriptionNotConfigured.Error())
		return
	}
	jobID, err := s.App.Enqueue(r.Context(), queue.GenerateTranscript, map[string]any{"episode_id": id},
		queue.Options{TenantID: derefInt(acc.Owner), MaxAttempts: 2})
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"data": map[string]string{"job_id": jobID}})
}

// previewToken returns a signed URL to preview an unpublished episode on its site (PRD §85 Preview).
func (s *Server) previewToken(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	acc, podcastID, err := s.episodeAccess(r.Context(), principal(r), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !acc.Read {
		forbidden(w)
		return
	}
	tok, err := s.App.Signer.PreviewToken(id, time.Hour)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	pc, _ := s.App.PodcastByID(r.Context(), podcastID)
	base := s.App.Cfg.WebInternalURL
	if t := s.App.CanonicalTenantID(r.Context(), pc); t != 0 {
		base = s.App.SiteBaseURL(r.Context(), t)
	}
	writeData(w, map[string]string{"token": tok, "url": fmt.Sprintf("%s/preview/episode/%d?token=%s", base, id, tok)})
}

func (s *Server) bulkEpisodes(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	var in struct {
		Action string  `json:"action"` // publish, unpublish, archive, delete
		IDs    []int64 `json:"ids"`
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if len(in.IDs) == 0 || len(in.IDs) > 500 {
		badRequest(w, "Provide between 1 and 500 ids")
		return
	}
	results := map[string][]int64{"ok": {}, "skipped": {}}
	touched := map[int64]bool{}
	for _, id := range in.IDs {
		acc, podcastID, err := s.episodeAccess(r.Context(), p, id)
		if err != nil || !acc.Edit || (in.Action == "delete" && p.Role == roleViewer) {
			results["skipped"] = append(results["skipped"], id)
			continue
		}
		var opErr error
		switch in.Action {
		case "publish":
			opErr = s.App.PublishEpisode(r.Context(), id)
		case "unpublish":
			opErr = s.App.UnpublishEpisode(r.Context(), id)
		case "archive":
			_, opErr = s.App.DB.Exec(r.Context(), `UPDATE episodes SET status='ARCHIVED', scheduled_at=NULL, updated_at=now() WHERE id=$1`, id)
		case "delete":
			_, opErr = s.App.DB.Exec(r.Context(), `DELETE FROM episodes WHERE id=$1`, id)
		default:
			badRequest(w, "Unknown bulk action")
			return
		}
		if opErr != nil {
			results["skipped"] = append(results["skipped"], id)
			continue
		}
		touched[podcastID] = true
		results["ok"] = append(results["ok"], id)
	}
	for pid := range touched {
		s.App.InvalidatePodcast(r.Context(), pid)
	}
	s.audit(r, "BULK_EPISODES_"+strings.ToUpper(in.Action), "episode", fmt.Sprint(results["ok"]), p.TenantID, in)
	writeData(w, results)
}
