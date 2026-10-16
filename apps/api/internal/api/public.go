package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"podcast/api/internal/app"
	"podcast/api/internal/cache"
	"podcast/api/internal/rss"
	"podcast/api/internal/util"
)

const tenantKey ctxKey = "tenant"

type tenantCtx struct {
	ID   int64
	Host string
}

func requestHost(r *http.Request) string {
	for _, h := range []string{r.Header.Get("X-Tenant-Host"), r.Header.Get("X-Forwarded-Host"), r.Host} {
		if h != "" {
			return util.NormalizeHost(strings.Split(h, ",")[0])
		}
	}
	return ""
}

// tenantFromHost resolves the tenant from the request hostname (PRD §7). Every public query is scoped to it.
func (s *Server) tenantFromHost(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := requestHost(r)
		rd, err := s.App.ResolveHost(r.Context(), host)
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		if rd == nil {
			writeError(w, http.StatusNotFound, "site_not_found", "No site is configured for "+host)
			return
		}
		ctx := context.WithValue(r.Context(), tenantKey, &tenantCtx{ID: rd.TenantID, Host: host})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func tenantOf(r *http.Request) *tenantCtx { return r.Context().Value(tenantKey).(*tenantCtx) }

func cacheKey(tid int64, parts ...any) string {
	return fmt.Sprintf("t:%d:%s", tid, strings.Trim(fmt.Sprint(parts...), "[]"))
}

// ---------------------------------------------------------------------------
// Public DTOs (no internal fields)

type PubPodcast struct {
	ID               int64             `json:"id"`
	Title            string            `json:"title"`
	Slug             string            `json:"slug"`
	Description      string            `json:"description,omitempty"`
	ShortDescription string            `json:"short_description"`
	ArtworkURL       string            `json:"artwork_url"`
	BannerURL        string            `json:"banner_url,omitempty"`
	Author           string            `json:"author"`
	Language         string            `json:"language"`
	Explicit         bool              `json:"explicit"`
	Copyright        string            `json:"copyright,omitempty"`
	WebsiteURL       string            `json:"website_url,omitempty"`
	PodcastType      string            `json:"podcast_type"`
	Category         *app.CategoryRef  `json:"category"`
	Subcategory      *app.CategoryRef  `json:"subcategory,omitempty"`
	Categories       []app.CategoryRef `json:"categories"`
	Tags             []string          `json:"tags"`
	Hosts            []app.HostRef     `json:"hosts"`
	EpisodeCount     int               `json:"episode_count"`
	LatestEpisodeAt  *time.Time        `json:"latest_episode_at"`
	PublishedAt      *time.Time        `json:"published_at"`
	UpdatedAt        time.Time         `json:"updated_at"`
	SEOTitle         string            `json:"seo_title,omitempty"`
	MetaDescription  string            `json:"meta_description,omitempty"`
	IsFeatured       bool              `json:"is_featured"`
	IsEditorsPick    bool              `json:"is_editors_pick"`
	Plays            int64             `json:"plays,omitempty"`
}

type PubEpisode struct {
	ID               int64           `json:"id"`
	PodcastID        int64           `json:"podcast_id"`
	PodcastTitle     string          `json:"podcast_title"`
	PodcastSlug      string          `json:"podcast_slug"`
	PodcastArtwork   string          `json:"podcast_artwork_url"`
	Title            string          `json:"title"`
	Slug             string          `json:"slug"`
	Description      string          `json:"description,omitempty"`
	ShortDescription string          `json:"short_description"`
	ShowNotes        string          `json:"show_notes,omitempty"`
	EpisodeNumber    *int            `json:"episode_number"`
	SeasonNumber     *int            `json:"season_number"`
	EpisodeType      string          `json:"episode_type"`
	AudioURL         string          `json:"audio_url"`
	AudioSize        int64           `json:"audio_size"`
	AudioMime        string          `json:"audio_mime"`
	Duration         int             `json:"duration"`
	ArtworkURL       string          `json:"artwork_url"`
	Explicit         bool            `json:"explicit"`
	PublishedAt      *time.Time      `json:"published_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
	Tags             []string        `json:"tags"`
	Hosts            []app.HostRef   `json:"hosts"`
	Transcript       string          `json:"transcript,omitempty"`
	TranscriptFormat string          `json:"transcript_format,omitempty"`
	HasTranscript    bool            `json:"has_transcript"`
	SEOTitle         string          `json:"seo_title,omitempty"`
	MetaDescription  string          `json:"meta_description,omitempty"`
	KeyTopics        json.RawMessage `json:"key_topics,omitempty"`
	FAQ              json.RawMessage `json:"faq,omitempty"`
	Citations        json.RawMessage `json:"citations,omitempty"`
}

type override struct {
	SEOTitle, MetaDescription, FeaturedImageURL string
	CategoryID                                  *int64
	IsFeatured, IsEditorsPick                   bool
}

func (s *Server) overrides(ctx context.Context, tenantID int64, ids []int64) map[int64]override {
	out := map[int64]override{}
	if len(ids) == 0 {
		return out
	}
	rows, err := s.App.DB.Query(ctx, `SELECT podcast_id, seo_title, meta_description, featured_image_url, category_id, is_featured, is_editors_pick
		FROM tenant_podcasts WHERE tenant_id=$1 AND podcast_id = ANY($2)`, tenantID, ids)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var o override
		rows.Scan(&id, &o.SEOTitle, &o.MetaDescription, &o.FeaturedImageURL, &o.CategoryID, &o.IsFeatured, &o.IsEditorsPick)
		out[id] = o
	}
	return out
}

// toPub converts podcasts applying tenant-specific overrides (PRD §91).
func (s *Server) toPub(ctx context.Context, tenantID int64, list []*app.Podcast, withDescription bool) []PubPodcast {
	ids := make([]int64, len(list))
	for i, p := range list {
		ids[i] = p.ID
	}
	ov := s.overrides(ctx, tenantID, ids)
	var cats map[int64]app.CategoryRef
	out := make([]PubPodcast, 0, len(list))
	for _, p := range list {
		o := ov[p.ID]
		pp := PubPodcast{ID: p.ID, Title: p.Title, Slug: p.Slug, ShortDescription: p.ShortDescription, ArtworkURL: p.ArtworkURL,
			BannerURL: p.BannerURL, Author: p.Author, Language: p.Language, Explicit: p.Explicit, Copyright: p.Copyright,
			WebsiteURL: p.WebsiteURL, PodcastType: p.PodcastType, Category: p.Category, Subcategory: p.Subcategory,
			Categories: p.Categories, Tags: p.Tags, Hosts: p.Hosts, EpisodeCount: p.EpisodeCount, LatestEpisodeAt: p.LatestEpisodeAt,
			PublishedAt: p.PublishedAt, UpdatedAt: p.UpdatedAt, SEOTitle: o.SEOTitle, MetaDescription: o.MetaDescription,
			IsFeatured: o.IsFeatured, IsEditorsPick: o.IsEditorsPick}
		if pp.Categories == nil {
			pp.Categories = []app.CategoryRef{}
		}
		if withDescription {
			pp.Description = p.Description
		}
		if pp.ShortDescription == "" {
			pp.ShortDescription = util.Truncate(util.StripTags(p.Description), 200)
		}
		if o.FeaturedImageURL != "" {
			pp.BannerURL = o.FeaturedImageURL
		}
		if o.CategoryID != nil {
			if cats == nil {
				cats = s.categoryMap(ctx)
			}
			if c, ok := cats[*o.CategoryID]; ok {
				pp.Category = &c
			}
		}
		out = append(out, pp)
	}
	return out
}

func (s *Server) categoryMap(ctx context.Context) map[int64]app.CategoryRef {
	m := map[int64]app.CategoryRef{}
	rows, err := s.App.DB.Query(ctx, `SELECT id, name, slug FROM categories`)
	if err != nil {
		return m
	}
	defer rows.Close()
	for rows.Next() {
		var c app.CategoryRef
		rows.Scan(&c.ID, &c.Name, &c.Slug)
		m[c.ID] = c
	}
	return m
}

func toPubEpisodes(list []*app.Episode, detail bool) []PubEpisode {
	out := make([]PubEpisode, 0, len(list))
	for _, e := range list {
		pe := PubEpisode{ID: e.ID, PodcastID: e.PodcastID, PodcastTitle: e.PodcastTitle, PodcastSlug: e.PodcastSlug,
			PodcastArtwork: e.PodcastArtwork, Title: e.Title, Slug: e.Slug, ShortDescription: e.ShortDescription,
			EpisodeNumber: e.EpisodeNumber, SeasonNumber: e.SeasonNumber, EpisodeType: e.EpisodeType, AudioURL: e.AudioURL,
			AudioSize: e.AudioSize, AudioMime: e.AudioMime, Duration: e.Duration, ArtworkURL: e.ArtworkURL, Explicit: e.Explicit,
			PublishedAt: e.PublishedAt, UpdatedAt: e.UpdatedAt, Tags: e.Tags, Hosts: e.Hosts,
			HasTranscript: (e.TranscriptFormat != "" && e.TranscriptOK) || e.TranscriptURL != "", KeyTopics: e.KeyTopics}
		if pe.ShortDescription == "" {
			pe.ShortDescription = util.Truncate(util.StripTags(e.Description), 200)
		}
		if detail {
			pe.Description, pe.ShowNotes = e.Description, e.ShowNotes
			if e.TranscriptOK {
				pe.Transcript, pe.TranscriptFormat = e.Transcript, e.TranscriptFormat
			}
			pe.SEOTitle, pe.MetaDescription = e.SEOTitle, e.MetaDescription
			pe.FAQ, pe.Citations = e.FAQ, e.Citations
		}
		out = append(out, pe)
	}
	return out
}

// Visibility fragments ($1 = tenant id).
const visiblePodcast = `p.status='PUBLISHED' AND p.id IN (SELECT podcast_id FROM tenant_podcast_ids($1))`
const visibleEpisode = visiblePodcast + ` AND e.status='PUBLISHED' AND e.published_at<=now()`

func (s *Server) visiblePodcasts(ctx context.Context, tenantID int64, extraWhere, order string, limit, offset int, args ...any) ([]*app.Podcast, error) {
	all := append([]any{tenantID}, args...)
	q := `SELECT ` + app.PodcastCols + ` FROM podcasts p WHERE ` + visiblePodcast
	if extraWhere != "" {
		q += " AND " + extraWhere
	}
	q += " ORDER BY " + order + fmt.Sprintf(" LIMIT %d OFFSET %d", limit, offset)
	return s.App.QueryPodcasts(ctx, q, all...)
}

func (s *Server) visibleEpisodes(ctx context.Context, tenantID int64, extraWhere, order string, limit, offset int, args ...any) ([]*app.Episode, error) {
	all := append([]any{tenantID}, args...)
	q := `SELECT ` + app.EpisodeColsLight + ` FROM episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE ` + visibleEpisode
	if extraWhere != "" {
		q += " AND " + extraWhere
	}
	q += " ORDER BY " + order + fmt.Sprintf(" LIMIT %d OFFSET %d", limit, offset)
	return s.App.QueryEpisodes(ctx, q, all...)
}

// ---------------------------------------------------------------------------
// Handlers

// publicResolve is used by the web middleware: host → tenant, domain redirect, path redirect.
func (s *Server) publicResolve(w http.ResponseWriter, r *http.Request) {
	host := util.NormalizeHost(r.URL.Query().Get("host"))
	rd, err := s.App.ResolveHost(r.Context(), host)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if rd == nil {
		writeError(w, http.StatusNotFound, "site_not_found", "No site is configured for "+host)
		return
	}
	resp := map[string]any{"tenant_id": rd.TenantID, "theme": rd.ThemeKey, "domain": rd.Domain, "primary_domain": rd.PrimaryDomain}
	if rd.RedirectTo != "" {
		resp["redirect_host"] = rd.RedirectTo
	}
	if path := r.URL.Query().Get("path"); path != "" {
		if to, code := s.lookupRedirect(r.Context(), rd.TenantID, path); to != "" {
			resp["redirect"] = map[string]any{"to": to, "status": code}
		}
	}
	w.Header().Set("Cache-Control", "public, max-age=30")
	writeData(w, resp)
}

// publicDomainVerification returns the ownership token for a configured domain. It doubles as the
// on-demand TLS "ask" endpoint for the reverse proxy (404 for unknown hostnames).
func (s *Server) publicDomainVerification(w http.ResponseWriter, r *http.Request) {
	host := util.NormalizeHost(firstNonEmpty(r.URL.Query().Get("host"), r.URL.Query().Get("domain")))
	var tok string
	if err := s.App.DB.QueryRow(r.Context(), `SELECT verification_token FROM domains WHERE domain=$1`, host).Scan(&tok); err != nil {
		notFound(w)
		return
	}
	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(tok))
}

func (s *Server) publicSite(w http.ResponseWriter, r *http.Request) {
	site, err := s.App.LoadSite(r.Context(), tenantOf(r).ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeData(w, site)
}

type homeCategory struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	Slug         string `json:"slug"`
	PodcastCount int    `json:"podcast_count"`
}

type pubCollection struct {
	ID          int64        `json:"id"`
	Title       string       `json:"title"`
	Slug        string       `json:"slug"`
	Description string       `json:"description"`
	CoverURL    string       `json:"cover_url"`
	Podcasts    []PubPodcast `json:"podcasts"`
}

type homeData struct {
	Featured       []PubPodcast    `json:"featured"`
	Trending       []PubPodcast    `json:"trending"`
	LatestEpisodes []PubEpisode    `json:"latest_episodes"`
	Popular        []PubPodcast    `json:"popular"`
	EditorsPicks   []PubPodcast    `json:"editors_picks"`
	Categories     []homeCategory  `json:"categories"`
	NewPodcasts    []PubPodcast    `json:"new_podcasts"`
	Collections    []pubCollection `json:"collections"`
	Hosts          []app.HostRef   `json:"hosts"`
	Stats          map[string]int  `json:"stats"`
}

// publicHome returns all homepage sections in one cached payload (PRD §29, §53).
func (s *Server) publicHome(w http.ResponseWriter, r *http.Request) {
	tid := tenantOf(r).ID
	data, err := cache.Remember(r.Context(), s.App.Cache, cacheKey(tid, "home"), 5*time.Minute, func() (*homeData, error) {
		ctx := r.Context()
		h := &homeData{Stats: map[string]int{}}
		featured, err := s.visiblePodcasts(ctx, tid, `p.id IN (SELECT podcast_id FROM tenant_podcasts WHERE tenant_id=$1 AND is_featured)`,
			`(SELECT sort_order FROM tenant_podcasts WHERE tenant_id=$1 AND podcast_id=p.id), p.published_at DESC`, 12, 0)
		if err != nil {
			return nil, err
		}
		if len(featured) == 0 {
			featured, _ = s.visiblePodcasts(ctx, tid, "", "latest_episode_at DESC NULLS LAST", 8, 0)
		}
		h.Featured = s.toPub(ctx, tid, featured, false)
		h.Trending = s.rankedPodcasts(ctx, tid, 7, 12)
		h.Popular = s.rankedPodcasts(ctx, tid, 90, 12)
		eps, _ := s.visibleEpisodes(ctx, tid, "", "e.published_at DESC", 12, 0)
		h.LatestEpisodes = toPubEpisodes(eps, false)
		picks, _ := s.visiblePodcasts(ctx, tid, `p.id IN (SELECT podcast_id FROM tenant_podcasts WHERE tenant_id=$1 AND is_editors_pick)`, "p.title", 12, 0)
		h.EditorsPicks = s.toPub(ctx, tid, picks, false)
		newest, _ := s.visiblePodcasts(ctx, tid, "", "COALESCE(p.published_at, p.created_at) DESC", 12, 0)
		h.NewPodcasts = s.toPub(ctx, tid, newest, false)
		h.Categories = s.tenantCategories(ctx, tid, true)
		h.Collections = s.tenantCollections(ctx, tid, 6)
		h.Hosts = s.tenantHosts(ctx, tid, 12)
		var pc, ec int
		s.App.DB.QueryRow(ctx, `SELECT count(*) FROM podcasts p WHERE `+visiblePodcast, tid).Scan(&pc)
		s.App.DB.QueryRow(ctx, `SELECT count(*) FROM episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE `+visibleEpisode, tid).Scan(&ec)
		h.Stats["podcasts"], h.Stats["episodes"] = pc, ec
		return h, nil
	})
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	s.writePublicData(w, r, data)
}

// rankedPodcasts orders visible podcasts by plays over the last `days` days (trending / popular).
func (s *Server) rankedPodcasts(ctx context.Context, tid int64, days, limit int) []PubPodcast {
	type ranked struct {
		id    int64
		plays int64
	}
	rows, err := s.App.DB.Query(ctx, `SELECT p.id, COALESCE(sum(ad.events),0) AS plays FROM podcasts p
		LEFT JOIN analytics_daily ad ON ad.podcast_id=p.id AND ad.tenant_id=$1 AND ad.event_type='PLAY' AND ad.day >= current_date - $2::int
		WHERE `+visiblePodcast+` GROUP BY p.id
		ORDER BY plays DESC, (SELECT max(published_at) FROM episodes WHERE podcast_id=p.id AND status='PUBLISHED') DESC NULLS LAST
		LIMIT $3`, tid, days, limit)
	if err != nil {
		return []PubPodcast{}
	}
	var rk []ranked
	for rows.Next() {
		var x ranked
		rows.Scan(&x.id, &x.plays)
		rk = append(rk, x)
	}
	rows.Close()
	if len(rk) == 0 {
		return []PubPodcast{}
	}
	ids := make([]int64, len(rk))
	for i, x := range rk {
		ids[i] = x.id
	}
	list, _ := s.App.QueryPodcasts(ctx, `SELECT `+app.PodcastCols+` FROM podcasts p WHERE p.id = ANY($1) ORDER BY array_position($1, p.id)`, ids)
	pub := s.toPub(ctx, tid, list, false)
	for i := range pub {
		pub[i].Plays = rk[i].plays
	}
	return pub
}

func (s *Server) tenantCategories(ctx context.Context, tid int64, onlyWithPodcasts bool) []homeCategory {
	out := []homeCategory{}
	rows, err := s.App.DB.Query(ctx, `SELECT c.id, c.name, c.slug, count(DISTINCT p.id) FROM categories c
		LEFT JOIN podcasts p ON `+visiblePodcast+` AND (c.id IN (p.category_id, p.subcategory_id)
		     OR c.id = (SELECT category_id FROM tenant_podcasts WHERE tenant_id=$1 AND podcast_id=p.id)
		     OR c.id IN (SELECT category_id FROM podcast_categories WHERE podcast_id=p.id))
		WHERE c.parent_id IS NULL GROUP BY c.id ORDER BY count(DISTINCT p.id) DESC, c.sort_order`, tid)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var c homeCategory
		rows.Scan(&c.ID, &c.Name, &c.Slug, &c.PodcastCount)
		if onlyWithPodcasts && c.PodcastCount == 0 {
			continue
		}
		out = append(out, c)
	}
	return out
}

func (s *Server) tenantHosts(ctx context.Context, tid int64, limit int) []app.HostRef {
	out := []app.HostRef{}
	rows, err := s.App.DB.Query(ctx, `SELECT DISTINCT h.id, h.name, h.slug, h.photo_url FROM hosts h
		JOIN podcast_hosts ph ON ph.host_id=h.id JOIN podcasts p ON p.id=ph.podcast_id WHERE `+visiblePodcast+`
		ORDER BY h.name LIMIT $2`, tid, limit)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var h app.HostRef
		rows.Scan(&h.ID, &h.Name, &h.Slug, &h.PhotoURL)
		h.Role = "host"
		out = append(out, h)
	}
	return out
}

func (s *Server) tenantCollections(ctx context.Context, tid int64, limit int) []pubCollection {
	out := []pubCollection{}
	rows, err := s.App.DB.Query(ctx, `SELECT id, title, slug, description, cover_url FROM collections
		WHERE tenant_id=$1 AND is_published ORDER BY sort_order, title LIMIT $2`, tid, limit)
	if err != nil {
		return out
	}
	var cols []pubCollection
	for rows.Next() {
		var c pubCollection
		rows.Scan(&c.ID, &c.Title, &c.Slug, &c.Description, &c.CoverURL)
		cols = append(cols, c)
	}
	rows.Close()
	for _, c := range cols {
		list, _ := s.visiblePodcasts(ctx, tid, `p.id IN (SELECT podcast_id FROM collection_items WHERE collection_id=$2)`,
			`(SELECT sort_order FROM collection_items WHERE collection_id=$2 AND podcast_id=p.id)`, 12, 0, c.ID)
		c.Podcasts = s.toPub(ctx, tid, list, false)
		out = append(out, c)
	}
	return out
}

func (s *Server) publicPodcasts(w http.ResponseWriter, r *http.Request) {
	tid := tenantOf(r).ID
	page, per, offset := pagination(r, 24, 100)
	order := map[string]string{
		"title":  "p.title",
		"new":    "COALESCE(p.published_at, p.created_at) DESC",
		"latest": "latest_episode_at DESC NULLS LAST",
	}[r.URL.Query().Get("sort")]
	if order == "" {
		order = "latest_episode_at DESC NULLS LAST"
	}
	var total int
	s.App.DB.QueryRow(r.Context(), `SELECT count(*) FROM podcasts p WHERE `+visiblePodcast, tid).Scan(&total)
	list, err := s.visiblePodcasts(r.Context(), tid, "", order, per, offset)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	s.writePublicList(w, r, s.toPub(r.Context(), tid, list, false), total, page, per)
}

type listenOn struct {
	PlatformKey string `json:"platform_key"`
	Name        string `json:"name"`
	URL         string `json:"url"`
	Color       string `json:"color"`
}

// listenOn returns only LIVE platforms with an external URL (PRD §27).
func (s *Server) listenOn(ctx context.Context, podcastID int64) []listenOn {
	out := []listenOn{}
	rows, err := s.App.DB.Query(ctx, `SELECT pl.key, pl.name, d.external_url, pl.color FROM podcast_distributions d
		JOIN platforms pl ON pl.id=d.platform_id WHERE d.podcast_id=$1 AND d.status='LIVE' AND d.external_url<>''
		ORDER BY pl.sort_order, pl.name`, podcastID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var l listenOn
		rows.Scan(&l.PlatformKey, &l.Name, &l.URL, &l.Color)
		out = append(out, l)
	}
	return out
}

func (s *Server) findVisiblePodcast(ctx context.Context, tid int64, slug string) (*app.Podcast, error) {
	list, err := s.visiblePodcasts(ctx, tid, "p.slug=$2", "p.id", 1, 0, slug)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, nil
	}
	return list[0], nil
}

type podcastPage struct {
	Podcast       PubPodcast   `json:"podcast"`
	Episodes      []PubEpisode `json:"episodes"`
	EpisodesTotal int          `json:"episodes_total"`
	LatestEpisode *PubEpisode  `json:"latest_episode"`
	Seasons       []int        `json:"seasons"`
	ListenOn      []listenOn   `json:"listen_on"`
	Related       []PubPodcast `json:"related"`
	CanonicalURL  string       `json:"canonical_url"`
	FeedURL       string       `json:"feed_url"`
}

// publicPodcast powers /podcast/{slug} (PRD §12).
func (s *Server) publicPodcast(w http.ResponseWriter, r *http.Request) {
	tid := tenantOf(r).ID
	slug := chi.URLParam(r, "slug")
	page, err := cache.Remember(r.Context(), s.App.Cache, cacheKey(tid, "podcast:", slug), 5*time.Minute, func() (*podcastPage, error) {
		ctx := r.Context()
		p, err := s.findVisiblePodcast(ctx, tid, slug)
		if err != nil || p == nil {
			return nil, err
		}
		pg := &podcastPage{Podcast: s.toPub(ctx, tid, []*app.Podcast{p}, true)[0], Seasons: []int{}}
		order := "e.published_at DESC"
		if p.PodcastType == "serial" {
			order = "e.season_number NULLS FIRST, e.episode_number NULLS FIRST, e.published_at"
		}
		eps, _ := s.visibleEpisodes(ctx, tid, "e.podcast_id=$2", order, 30, 0, p.ID)
		pg.Episodes = toPubEpisodes(eps, false)
		pg.EpisodesTotal = p.EpisodeCount
		latest, _ := s.visibleEpisodes(ctx, tid, "e.podcast_id=$2", "e.published_at DESC", 1, 0, p.ID)
		if l := toPubEpisodes(latest, false); len(l) > 0 {
			pg.LatestEpisode = &l[0]
		}
		rows, _ := s.App.DB.Query(ctx, `SELECT DISTINCT season_number FROM episodes WHERE podcast_id=$1 AND status='PUBLISHED'
			AND season_number IS NOT NULL ORDER BY 1`, p.ID)
		for rows.Next() {
			var n int
			rows.Scan(&n)
			pg.Seasons = append(pg.Seasons, n)
		}
		rows.Close()
		pg.ListenOn = s.listenOn(ctx, p.ID)
		related, _ := s.visiblePodcasts(ctx, tid, `p.id<>$2 AND (p.category_id=$3 OR p.subcategory_id=$3 OR p.id IN (
			SELECT podcast_id FROM podcast_tags WHERE tag_id IN (SELECT tag_id FROM podcast_tags WHERE podcast_id=$2)))`,
			"latest_episode_at DESC NULLS LAST", 8, 0, p.ID, p.CategoryID)
		if len(related) < 4 {
			more, _ := s.visiblePodcasts(ctx, tid, "p.id<>$2", "latest_episode_at DESC NULLS LAST", 8-len(related), 0, p.ID)
			seen := map[int64]bool{}
			for _, x := range related {
				seen[x.ID] = true
			}
			for _, x := range more {
				if !seen[x.ID] {
					related = append(related, x)
				}
			}
		}
		pg.Related = s.toPub(ctx, tid, related, false)
		pg.CanonicalURL = s.App.CanonicalBase(ctx, p, tid) + "/podcast/" + p.Slug
		pg.FeedURL = s.App.FeedURL(ctx, p)
		return pg, nil
	})
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if page == nil {
		notFound(w)
		return
	}
	s.writePublicData(w, r, page)
}

func (s *Server) publicPodcastEpisodes(w http.ResponseWriter, r *http.Request) {
	tid := tenantOf(r).ID
	p, err := s.findVisiblePodcast(r.Context(), tid, chi.URLParam(r, "slug"))
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if p == nil {
		notFound(w)
		return
	}
	page, per, offset := pagination(r, 30, 100)
	where := "e.podcast_id=$2"
	args := []any{p.ID}
	if season := queryInt(r, "season", 0); season > 0 {
		where += " AND e.season_number=$3"
		args = append(args, season)
	}
	order := "e.published_at DESC"
	if r.URL.Query().Get("sort") == "oldest" {
		order = "e.published_at ASC"
	}
	var total int
	s.App.DB.QueryRow(r.Context(), `SELECT count(*) FROM episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE `+visibleEpisode+" AND "+where,
		append([]any{tid}, args...)...).Scan(&total)
	eps, err := s.visibleEpisodes(r.Context(), tid, where, order, per, offset, args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	s.writePublicList(w, r, toPubEpisodes(eps, false), total, page, per)
}

type episodePage struct {
	Episode      PubEpisode   `json:"episode"`
	Podcast      PubPodcast   `json:"podcast"`
	Previous     *PubEpisode  `json:"previous"`
	Next         *PubEpisode  `json:"next"`
	More         []PubEpisode `json:"more"`
	ListenOn     []listenOn   `json:"listen_on"`
	CanonicalURL string       `json:"canonical_url"`
	FeedURL      string       `json:"feed_url"`
}

func (s *Server) buildEpisodePage(ctx context.Context, tid int64, p *app.Podcast, e *app.Episode) *episodePage {
	pg := &episodePage{Episode: toPubEpisodes([]*app.Episode{e}, true)[0], Podcast: s.toPub(ctx, tid, []*app.Podcast{p}, false)[0]}
	if e.PublishedAt != nil {
		prev, _ := s.visibleEpisodes(ctx, tid, "e.podcast_id=$2 AND e.published_at < $3", "e.published_at DESC", 1, 0, p.ID, *e.PublishedAt)
		if l := toPubEpisodes(prev, false); len(l) > 0 {
			pg.Previous = &l[0]
		}
		next, _ := s.visibleEpisodes(ctx, tid, "e.podcast_id=$2 AND e.published_at > $3", "e.published_at ASC", 1, 0, p.ID, *e.PublishedAt)
		if l := toPubEpisodes(next, false); len(l) > 0 {
			pg.Next = &l[0]
		}
	}
	more, _ := s.visibleEpisodes(ctx, tid, "e.podcast_id=$2 AND e.id<>$3", "e.published_at DESC", 6, 0, p.ID, e.ID)
	pg.More = toPubEpisodes(more, false)
	pg.ListenOn = s.listenOn(ctx, p.ID)
	if e.CanonicalURL != "" {
		pg.CanonicalURL = e.CanonicalURL
	} else {
		pg.CanonicalURL = s.App.CanonicalBase(ctx, p, tid) + "/podcast/" + p.Slug + "/" + e.Slug
	}
	pg.FeedURL = s.App.FeedURL(ctx, p)
	return pg
}

func (s *Server) publicEpisode(w http.ResponseWriter, r *http.Request) {
	tid := tenantOf(r).ID
	slug, epSlug := chi.URLParam(r, "slug"), chi.URLParam(r, "episode")
	page, err := cache.Remember(r.Context(), s.App.Cache, cacheKey(tid, "episode:", slug, "/", epSlug), 5*time.Minute, func() (*episodePage, error) {
		ctx := r.Context()
		p, err := s.findVisiblePodcast(ctx, tid, slug)
		if err != nil || p == nil {
			return nil, err
		}
		list, err := s.App.QueryEpisodes(ctx, `SELECT `+app.EpisodeCols+` FROM episodes e JOIN podcasts p ON p.id=e.podcast_id
			WHERE `+visibleEpisode+` AND e.podcast_id=$2 AND e.slug=$3`, tid, p.ID, epSlug)
		if err != nil || len(list) == 0 {
			return nil, err
		}
		return s.buildEpisodePage(ctx, tid, p, list[0]), nil
	})
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if page == nil {
		notFound(w)
		return
	}
	s.writePublicData(w, r, page)
}

// publicTranscript serves the approved transcript file referenced from the RSS feed (podcast:transcript).
func (s *Server) publicTranscript(w http.ResponseWriter, r *http.Request) {
	tid := tenantOf(r).ID
	var text, format string
	err := s.App.DB.QueryRow(r.Context(), `SELECT e.transcript, e.transcript_format FROM episodes e JOIN podcasts p ON p.id=e.podcast_id
		WHERE `+visibleEpisode+` AND p.slug=$2 AND e.slug=$3 AND e.transcript<>'' AND e.transcript_approved`,
		tid, chi.URLParam(r, "slug"), chi.URLParam(r, "episode")).Scan(&text, &format)
	if err != nil {
		notFound(w)
		return
	}
	w.Header().Set("Content-Type", rss.TranscriptMIME(format)+"; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Write([]byte(text))
}

func (s *Server) publicEpisodes(w http.ResponseWriter, r *http.Request) {
	tid := tenantOf(r).ID
	page, per, offset := pagination(r, 24, 100)
	var total int
	s.App.DB.QueryRow(r.Context(), `SELECT count(*) FROM episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE `+visibleEpisode, tid).Scan(&total)
	eps, err := s.visibleEpisodes(r.Context(), tid, "", "e.published_at DESC", per, offset)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	s.writePublicList(w, r, toPubEpisodes(eps, false), total, page, per)
}

func (s *Server) publicCategories(w http.ResponseWriter, r *http.Request) {
	tid := tenantOf(r).ID
	data, err := cache.Remember(r.Context(), s.App.Cache, cacheKey(tid, "categories"), 10*time.Minute, func() ([]homeCategory, error) {
		return s.tenantCategories(r.Context(), tid, r.URL.Query().Get("all") != "1"), nil
	})
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	s.writePublicData(w, r, data)
}

const inCategory = `($2 IN (p.category_id, p.subcategory_id)
	OR $2 = (SELECT category_id FROM tenant_podcasts WHERE tenant_id=$1 AND podcast_id=p.id)
	OR $2 IN (SELECT category_id FROM podcast_categories WHERE podcast_id=p.id)
	OR p.subcategory_id IN (SELECT id FROM categories WHERE parent_id=$2))`

func (s *Server) publicCategory(w http.ResponseWriter, r *http.Request) {
	tid := tenantOf(r).ID
	var c app.Category
	err := s.App.DB.QueryRow(r.Context(), `SELECT id, name, slug, parent_id, description FROM categories WHERE slug=$1`, chi.URLParam(r, "slug")).
		Scan(&c.ID, &c.Name, &c.Slug, &c.ParentID, &c.Description)
	if err != nil {
		notFound(w)
		return
	}
	page, per, offset := pagination(r, 24, 100)
	var total int
	s.App.DB.QueryRow(r.Context(), `SELECT count(*) FROM podcasts p WHERE `+visiblePodcast+` AND `+inCategory, tid, c.ID).Scan(&total)
	list, err := s.visiblePodcasts(r.Context(), tid, inCategory, "latest_episode_at DESC NULLS LAST", per, offset, c.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	subs := []homeCategory{}
	rows, _ := s.App.DB.Query(r.Context(), `SELECT id, name, slug FROM categories WHERE parent_id=$1 ORDER BY sort_order`, c.ID)
	for rows.Next() {
		var h homeCategory
		rows.Scan(&h.ID, &h.Name, &h.Slug)
		subs = append(subs, h)
	}
	rows.Close()
	var parent *app.CategoryRef
	if c.ParentID != nil {
		var pr app.CategoryRef
		if s.App.DB.QueryRow(r.Context(), `SELECT id, name, slug FROM categories WHERE id=$1`, *c.ParentID).Scan(&pr.ID, &pr.Name, &pr.Slug) == nil {
			parent = &pr
		}
	}
	eps, _ := s.visibleEpisodes(r.Context(), tid, inCategory, "e.published_at DESC", 8, 0, c.ID)
	s.writePublic(w, r, map[string]any{
		"data": map[string]any{"category": c, "parent": parent, "subcategories": subs, "podcasts": s.toPub(r.Context(), tid, list, false),
			"latest_episodes": toPubEpisodes(eps, false)},
		"meta": map[string]int{"total": total, "page": page, "per_page": per, "pages": (total + per - 1) / per},
	})
}

func (s *Server) publicHosts(w http.ResponseWriter, r *http.Request) {
	tid := tenantOf(r).ID
	s.writePublicData(w, r, s.tenantHosts(r.Context(), tid, 500))
}

func (s *Server) publicHost(w http.ResponseWriter, r *http.Request) {
	tid := tenantOf(r).ID
	var h app.Host
	err := s.App.DB.QueryRow(r.Context(), `SELECT id, name, slug, photo_url, bio, website_url, social_links FROM hosts WHERE slug=$1`,
		chi.URLParam(r, "slug")).Scan(&h.ID, &h.Name, &h.Slug, &h.PhotoURL, &h.Bio, &h.WebsiteURL, &h.SocialLinks)
	if err != nil {
		notFound(w)
		return
	}
	podcasts, err := s.visiblePodcasts(r.Context(), tid, `p.id IN (SELECT podcast_id FROM podcast_hosts WHERE host_id=$2)`, "p.title", 50, 0, h.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	eps, _ := s.visibleEpisodes(r.Context(), tid, `(e.id IN (SELECT episode_id FROM episode_hosts WHERE host_id=$2)
		OR e.podcast_id IN (SELECT podcast_id FROM podcast_hosts WHERE host_id=$2))`, "e.published_at DESC", 20, 0, h.ID)
	if len(podcasts) == 0 && len(eps) == 0 {
		notFound(w) // hosts only exist on sites where they have content
		return
	}
	if h.SocialLinks == nil {
		h.SocialLinks = map[string]string{}
	}
	s.writePublicData(w, r, map[string]any{"host": h, "podcasts": s.toPub(r.Context(), tid, podcasts, false), "episodes": toPubEpisodes(eps, false)})
}

func (s *Server) publicTag(w http.ResponseWriter, r *http.Request) {
	tid := tenantOf(r).ID
	var id int64
	var name, slug string
	if err := s.App.DB.QueryRow(r.Context(), `SELECT id, name, slug FROM tags WHERE slug=$1`, chi.URLParam(r, "slug")).Scan(&id, &name, &slug); err != nil {
		notFound(w)
		return
	}
	podcasts, _ := s.visiblePodcasts(r.Context(), tid, `p.id IN (SELECT podcast_id FROM podcast_tags WHERE tag_id=$2)`, "p.title", 50, 0, id)
	eps, _ := s.visibleEpisodes(r.Context(), tid, `e.id IN (SELECT episode_id FROM episode_tags WHERE tag_id=$2)`, "e.published_at DESC", 30, 0, id)
	s.writePublicData(w, r, map[string]any{"tag": map[string]any{"id": id, "name": name, "slug": slug},
		"podcasts": s.toPub(r.Context(), tid, podcasts, false), "episodes": toPubEpisodes(eps, false)})
}

func (s *Server) publicCollections(w http.ResponseWriter, r *http.Request) {
	s.writePublicData(w, r, s.tenantCollections(r.Context(), tenantOf(r).ID, 100))
}

func (s *Server) publicCollection(w http.ResponseWriter, r *http.Request) {
	tid := tenantOf(r).ID
	var c pubCollection
	err := s.App.DB.QueryRow(r.Context(), `SELECT id, title, slug, description, cover_url FROM collections
		WHERE tenant_id=$1 AND slug=$2 AND is_published`, tid, chi.URLParam(r, "slug")).Scan(&c.ID, &c.Title, &c.Slug, &c.Description, &c.CoverURL)
	if err != nil {
		notFound(w)
		return
	}
	list, _ := s.visiblePodcasts(r.Context(), tid, `p.id IN (SELECT podcast_id FROM collection_items WHERE collection_id=$2)`,
		`(SELECT sort_order FROM collection_items WHERE collection_id=$2 AND podcast_id=p.id)`, 200, 0, c.ID)
	c.Podcasts = s.toPub(r.Context(), tid, list, false)
	s.writePublicData(w, r, c)
}

var wordRe = regexp.MustCompile(`[\p{L}\p{N}]+`)

// prefixQuery builds a prefix-matching tsquery ("busi mark" → busi:* & mark:*).
func prefixQuery(q string) string {
	words := wordRe.FindAllString(strings.ToLower(q), 8)
	for i, w := range words {
		words[i] = w + ":*"
	}
	return strings.Join(words, " & ")
}

// publicSearch searches podcasts, episodes, hosts, categories and tags with PostgreSQL FTS (PRD §28).
func (s *Server) publicSearch(w http.ResponseWriter, r *http.Request) {
	tid := tenantOf(r).ID
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	typ := r.URL.Query().Get("type")
	if len([]rune(q)) < 2 {
		writeData(w, map[string]any{"query": q, "podcasts": []any{}, "episodes": []any{}, "hosts": []any{}, "categories": []any{}, "tags": []any{}})
		return
	}
	tsq := prefixQuery(q)
	if tsq == "" {
		tsq = "''"
	}
	like := "%" + q + "%"
	limit := 10
	if typ != "" {
		limit = 40
	}
	ctx := r.Context()
	res := map[string]any{"query": q}
	if typ == "" || typ == "podcast" {
		list, err := s.visiblePodcasts(ctx, tid, `(p.search_vector @@ to_tsquery('simple', $2) OR p.title ILIKE $3)`,
			`ts_rank(p.search_vector, to_tsquery('simple', $2)) DESC, p.title`, limit, 0, tsq, like)
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		res["podcasts"] = s.toPub(ctx, tid, list, false)
	}
	if typ == "" || typ == "episode" {
		eps, err := s.visibleEpisodes(ctx, tid, `(e.search_vector @@ to_tsquery('simple', $2) OR e.title ILIKE $3)`,
			`ts_rank(e.search_vector, to_tsquery('simple', $2)) DESC, e.published_at DESC`, limit, 0, tsq, like)
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		res["episodes"] = toPubEpisodes(eps, false)
	}
	if typ == "" || typ == "host" {
		hosts := []app.HostRef{}
		rows, err := s.App.DB.Query(ctx, `SELECT DISTINCT h.id, h.name, h.slug, h.photo_url FROM hosts h
			JOIN podcast_hosts ph ON ph.host_id=h.id JOIN podcasts p ON p.id=ph.podcast_id
			WHERE `+visiblePodcast+` AND (h.search_vector @@ to_tsquery('simple', $2) OR h.name ILIKE $3) LIMIT $4`, tid, tsq, like, limit)
		if err == nil {
			for rows.Next() {
				var h app.HostRef
				rows.Scan(&h.ID, &h.Name, &h.Slug, &h.PhotoURL)
				hosts = append(hosts, h)
			}
			rows.Close()
		}
		res["hosts"] = hosts
	}
	if typ == "" || typ == "category" {
		cats := []homeCategory{}
		for _, c := range s.tenantCategories(ctx, tid, false) {
			if strings.Contains(strings.ToLower(c.Name), strings.ToLower(q)) {
				cats = append(cats, c)
			}
		}
		res["categories"] = cats
	}
	if typ == "" || typ == "tag" {
		type tag struct {
			Name string `json:"name"`
			Slug string `json:"slug"`
		}
		tags := []tag{}
		rows, err := s.App.DB.Query(ctx, `SELECT t.name, t.slug FROM tags t WHERE (t.name ILIKE $2 OR t.name % $3) AND (
			EXISTS (SELECT 1 FROM podcast_tags pt JOIN podcasts p ON p.id=pt.podcast_id WHERE pt.tag_id=t.id AND `+visiblePodcast+`)
			OR EXISTS (SELECT 1 FROM episode_tags et JOIN episodes e ON e.id=et.episode_id JOIN podcasts p ON p.id=e.podcast_id
			           WHERE et.tag_id=t.id AND `+visibleEpisode+`)) ORDER BY similarity(t.name, $3) DESC LIMIT 10`, tid, like, q)
		if err == nil {
			for rows.Next() {
				var t tag
				rows.Scan(&t.Name, &t.Slug)
				tags = append(tags, t)
			}
			rows.Close()
		}
		res["tags"] = tags
	}
	s.writePublicData(w, r, res)
}

// publicFeed serves /feed/{slug}.xml with caching headers (PRD §17, §116).
func (s *Server) publicFeed(w http.ResponseWriter, r *http.Request) {
	tid := tenantOf(r).ID
	slug := strings.TrimSuffix(chi.URLParam(r, "slug"), ".xml")
	var id int64
	err := s.App.DB.QueryRow(r.Context(), `SELECT p.id FROM podcasts p WHERE `+visiblePodcast+` AND p.slug=$2`, tid, slug).Scan(&id)
	if err != nil {
		notFound(w)
		return
	}
	xml, _, err := s.App.BuildFeed(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	sum := sha256.Sum256(xml)
	etag := `"` + hex.EncodeToString(sum[:12]) + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "public, max-age=300, stale-while-revalidate=600")
	w.Header().Set("Content-Type", "application/rss+xml; charset=utf-8")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Write(xml)
}

func (s *Server) publicSitemap(w http.ResponseWriter, r *http.Request) {
	seg := strings.TrimSuffix(chi.URLParam(r, "segment"), ".xml")
	if seg == "sitemap" || seg == "" {
		seg = "index"
	}
	b, err := s.App.Sitemap(r.Context(), tenantOf(r).ID, seg)
	if err != nil {
		notFound(w)
		return
	}
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=900")
	w.Write(b)
}

// publicRobots renders the tenant-specific robots.txt (PRD §37).
func (s *Server) publicRobots(w http.ResponseWriter, r *http.Request) {
	tid := tenantOf(r).ID
	seo, _ := s.App.SEOSettings(r.Context(), tid)
	base := s.App.SiteBaseURL(r.Context(), tid)
	var b strings.Builder
	b.WriteString("User-agent: *\n")
	if seo.IndexPolicy == "noindex" {
		b.WriteString("Disallow: /\n")
	} else {
		b.WriteString("Allow: /\nDisallow: /preview/\nDisallow: /api/\nDisallow: /search\n")
	}
	if seo.RobotsExtra != "" {
		b.WriteString("\n" + seo.RobotsExtra + "\n")
	}
	if seo.IndexPolicy != "noindex" {
		b.WriteString("\nSitemap: " + base + "/sitemap.xml\n")
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write([]byte(b.String()))
}

// lookupRedirect finds an exact redirect, or a prefix redirect for nested paths (episode pages under a renamed podcast).
func (s *Server) lookupRedirect(ctx context.Context, tid int64, path string) (string, int) {
	path = "/" + strings.Trim(strings.Split(path, "?")[0], "/")
	var id int64
	var to string
	var code int
	err := s.App.DB.QueryRow(ctx, `SELECT id, to_path, status_code FROM redirects WHERE from_path=$2 AND (tenant_id=$1 OR tenant_id IS NULL)
		ORDER BY tenant_id NULLS LAST LIMIT 1`, tid, path).Scan(&id, &to, &code)
	if err != nil {
		err = s.App.DB.QueryRow(ctx, `SELECT id, to_path || substr($2, length(from_path)+1), status_code FROM redirects
			WHERE is_auto AND $2 LIKE from_path || '/%' AND (tenant_id=$1 OR tenant_id IS NULL)
			ORDER BY length(from_path) DESC LIMIT 1`, tid, path).Scan(&id, &to, &code)
	}
	if err != nil {
		return "", 0
	}
	s.App.DB.Exec(ctx, `UPDATE redirects SET hits=hits+1 WHERE id=$1`, id)
	return to, code
}

func (s *Server) publicRedirect(w http.ResponseWriter, r *http.Request) {
	to, code := s.lookupRedirect(r.Context(), tenantOf(r).ID, r.URL.Query().Get("path"))
	if to == "" {
		notFound(w)
		return
	}
	writeData(w, map[string]any{"to": to, "status": code})
}

// publicPreviewEpisode renders a draft episode for editors holding a signed preview token.
func (s *Server) publicPreviewEpisode(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	c, err := s.App.Signer.Parse(r.URL.Query().Get("token"))
	if err != nil || c.Purpose != "preview" || c.Resource != id {
		writeError(w, http.StatusForbidden, "invalid_token", "Preview link is invalid or expired")
		return
	}
	e, err := s.App.EpisodeByID(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	p, err := s.App.PodcastByID(r.Context(), e.PodcastID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	e.TranscriptOK = true // editors review AI transcripts in preview
	pg := s.buildEpisodePage(r.Context(), tenantOf(r).ID, p, e)
	w.Header().Set("Cache-Control", "no-store")
	s.writePublicData(w, r, map[string]any{"page": pg, "status": e.Status})
}

// publicEvent records analytics events from the web player and page views (PRD §57, §58).
func (s *Server) publicEvent(w http.ResponseWriter, r *http.Request) {
	tc := tenantOf(r)
	var batch []app.EventInput
	var single app.EventInput
	body := http.MaxBytesReader(w, r.Body, 64<<10)
	raw := make([]byte, 0, 1024)
	buf := make([]byte, 4096)
	for {
		n, err := body.Read(buf)
		raw = append(raw, buf[:n]...)
		if err != nil {
			break
		}
	}
	if len(raw) > 0 && raw[0] == '[' {
		if err := json.Unmarshal(raw, &batch); err != nil {
			badRequest(w, "invalid JSON")
			return
		}
	} else {
		if err := json.Unmarshal(raw, &single); err != nil {
			badRequest(w, "invalid JSON")
			return
		}
		batch = []app.EventInput{single}
	}
	if len(batch) > 20 {
		batch = batch[:20]
	}
	ec := app.EventContext{TenantID: tc.ID, Domain: tc.Host, IP: clientIP(r), UserAgent: r.UserAgent(),
		Country: strings.ToUpper(firstHeader(r, "CF-IPCountry", "X-Country", "X-Vercel-IP-Country"))}
	accepted := 0
	for _, ev := range batch {
		if err := s.App.RecordEvent(r.Context(), ec, ev); err == nil {
			accepted++
		}
	}
	writeJSON(w, http.StatusAccepted, map[string]int{"accepted": accepted})
}

func firstHeader(r *http.Request, names ...string) string {
	for _, n := range names {
		if v := r.Header.Get(n); v != "" {
			return v
		}
	}
	return ""
}
