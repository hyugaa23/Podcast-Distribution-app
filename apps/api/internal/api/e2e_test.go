package api

// End-to-end acceptance test covering the PRD Definition of Done (§122) and acceptance criteria
// §117–§120 against a real PostgreSQL + Redis + FFmpeg, with the worker running in-process.
//
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/podcast_test?sslmode=disable \
//   TEST_REDIS_URL=redis://localhost:6379/1 go test ./internal/api -run TestE2E -v

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"podcast/api/internal/app"
	"podcast/api/internal/config"
	"podcast/api/internal/rss"
	"podcast/api/internal/worker"
)

type client struct {
	t     *testing.T
	base  string
	token string
	host  string
}

func (c *client) do(method, path string, body any, out any) int {
	c.t.Helper()
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.base+path, rdr)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	if c.host != "" {
		req.Header.Set("X-Tenant-Host", c.host)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			c.t.Fatalf("%s %s: decode %v: %s", method, path, err, raw)
		}
	}
	return resp.StatusCode
}

func (c *client) must(method, path string, body any, out any, want int) {
	c.t.Helper()
	var raw json.RawMessage
	code := c.do(method, path, body, &raw)
	if code != want {
		c.t.Fatalf("%s %s: status %d (want %d): %s", method, path, code, want, raw)
	}
	if out != nil {
		json.Unmarshal(raw, out)
	}
}

func (c *client) raw(path string) (int, []byte) {
	req, _ := http.NewRequest(http.MethodGet, c.base+path, nil)
	if c.host != "" {
		req.Header.Set("X-Tenant-Host", c.host)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, b
}

func login(t *testing.T, base, email, pw string) *client {
	c := &client{t: t, base: base}
	var out struct {
		Data struct {
			AccessToken string `json:"access_token"`
		} `json:"data"`
	}
	c.must("POST", "/api/auth/login", map[string]string{"email": email, "password": pw}, &out, 200)
	c.token = out.Data.AccessToken
	return c
}

// upload performs the signed upload flow.
func (c *client) upload(purpose string, target int64, path, ctype string) map[string]any {
	c.t.Helper()
	st, _ := os.Stat(path)
	var init struct {
		Data struct {
			UploadID string            `json:"upload_id"`
			URL      string            `json:"url"`
			Headers  map[string]string `json:"headers"`
		} `json:"data"`
	}
	c.must("POST", "/api/uploads", map[string]any{"purpose": purpose, "target_id": target, "filename": filepath.Base(path),
		"content_type": ctype, "size": st.Size()}, &init, 201)
	f, _ := os.Open(path)
	defer f.Close()
	req, _ := http.NewRequest(http.MethodPut, init.Data.URL, f)
	req.ContentLength = st.Size()
	for k, v := range init.Data.Headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		c.t.Fatalf("PUT upload: %v %d %s", err, resp.StatusCode, b)
	}
	resp.Body.Close()
	var done struct {
		Data map[string]any `json:"data"`
	}
	c.must("POST", "/api/uploads/"+init.Data.UploadID+"/complete", nil, &done, 200)
	return done.Data
}

func ffmpeg(t *testing.T, args ...string) {
	t.Helper()
	if out, err := exec.Command("ffmpeg", append([]string{"-hide_banner", "-loglevel", "error", "-y"}, args...)...).CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg: %v %s", err, out)
	}
}

func TestE2E(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	redisURL := os.Getenv("TEST_REDIS_URL")
	if dbURL == "" || redisURL == "" {
		t.Skip("set TEST_DATABASE_URL and TEST_REDIS_URL to run the end-to-end test")
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Fresh database.
	adminURL := strings.Replace(dbURL, "/podcast_test", "/postgres", 1)
	if conn, err := pgx.Connect(ctx, adminURL); err == nil {
		conn.Exec(ctx, `DROP DATABASE IF EXISTS podcast_test WITH (FORCE)`)
		conn.Close(ctx)
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	base := "http://" + ln.Addr().String()
	tmp := t.TempDir()
	os.Setenv("JWT_SECRET", "e2e-secret-e2e-secret-e2e-secret-123")
	cfg := config.Load()
	cfg.DatabaseURL, cfg.RedisURL = dbURL, redisURL
	cfg.StorageDriver, cfg.StorageLocalDir, cfg.CDNURL = "local", filepath.Join(tmp, "storage"), base+"/media"
	cfg.APIPublicURL, cfg.WebInternalURL = base, "http://127.0.0.1:1"
	cfg.SeedAdminEmail, cfg.SeedAdminPassword = "root@e2e.test", "Sup3r-Secret!"
	cfg.AllowPrivateFetch, cfg.CORSOrigins = true, []string{"*"}

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := app.New(ctx, cfg, log)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	a.Redis.FlushDB(ctx)
	if err := a.EnsureBaseData(ctx); err != nil {
		t.Fatal(err)
	}
	srv := &httptest.Server{Listener: ln, Config: &http.Server{Handler: New(a).Router()}}
	srv.Start()
	defer srv.Close()
	go (&worker.Worker{App: a, ID: "e2e", Concurrency: 2}).Run(ctx)

	root := login(t, base, "root@e2e.test", "Sup3r-Secret!")

	// ---- §117.1–4: create tenant, connect domain, resolve, theme -------------------------------
	type idResp struct {
		Data struct {
			ID int64 `json:"id"`
		} `json:"data"`
	}
	var tenantA idResp
	root.must("POST", "/api/tenants", map[string]any{"name": "Business Voice", "domain": "businessvoice.test", "theme": "business",
		"primary_color": "#1457FF", "content_mode": "INDEPENDENT", "language": "en", "timezone": "America/Chicago"}, &tenantA, 201)
	var tenantB idResp
	root.must("POST", "/api/tenants", map[string]any{"name": "Tech Voice", "domain": "techvoice.test", "theme": "tech",
		"content_mode": "SYNDICATED"}, &tenantB, 201)
	var www struct {
		Data struct {
			ID int64 `json:"id"`
		} `json:"data"`
	}
	root.must("POST", "/api/domains", map[string]any{"tenant_id": tenantA.Data.ID, "domain": "www.businessvoice.test", "redirect_to_primary": true}, &www, 201)

	pub := &client{t: t, base: base}
	var res struct {
		Data map[string]any `json:"data"`
	}
	pub.must("GET", "/api/public/resolve?host=businessvoice.test", nil, &res, 200)
	if res.Data["theme"] != "business" || int64(res.Data["tenant_id"].(float64)) != tenantA.Data.ID {
		t.Fatalf("resolve: %v", res.Data)
	}
	pub.must("GET", "/api/public/resolve?host=www.businessvoice.test", nil, &res, 200)
	if res.Data["redirect_host"] != "businessvoice.test" {
		t.Fatalf("www should redirect to primary: %v", res.Data)
	}
	pub.must("GET", "/api/public/resolve?host=techvoice.test", nil, &res, 200)
	if res.Data["theme"] != "tech" {
		t.Fatal("tenant B must use a different theme")
	}
	if code := pub.do("GET", "/api/public/resolve?host=unknown.test", nil, nil); code != 404 {
		t.Fatalf("unknown host: %d", code)
	}

	// ---- Configure brand -----------------------------------------------------------------------
	root.must("PUT", fmt.Sprintf("/api/tenants/%d/settings", tenantA.Data.ID), map[string]any{
		"branding": map[string]any{"primary_color": "#0044FF", "tagline": "Business insights", "heading_font": "Inter", "social_links": map[string]string{"x": "https://x.com/bv"}},
	}, nil, 200)
	siteA := &client{t: t, base: base, host: "businessvoice.test"}
	var site struct {
		Data app.Site `json:"data"`
	}
	siteA.must("GET", "/api/public/site", nil, &site, 200)
	if site.Data.ThemeConfig["primary"] != "#0044FF" || site.Data.Branding.Tagline != "Business insights" {
		t.Fatalf("branding not applied: %+v", site.Data.ThemeConfig)
	}

	// Tenant users.
	root.must("POST", "/api/users", map[string]any{"email": "admin@bv.test", "password": "Passw0rd!!", "role": "TENANT_ADMIN", "tenant_id": tenantA.Data.ID}, nil, 201)
	root.must("POST", "/api/users", map[string]any{"email": "admin@tv.test", "password": "Passw0rd!!", "role": "TENANT_ADMIN", "tenant_id": tenantB.Data.ID}, nil, 201)
	root.must("POST", "/api/users", map[string]any{"email": "viewer@bv.test", "password": "Passw0rd!!", "role": "VIEWER", "tenant_id": tenantA.Data.ID}, nil, 201)
	bvAdmin := login(t, base, "admin@bv.test", "Passw0rd!!")
	tvAdmin := login(t, base, "admin@tv.test", "Passw0rd!!")
	viewer := login(t, base, "viewer@bv.test", "Passw0rd!!")

	// ---- §118: create podcast, upload artwork -----------------------------------------------------
	var cats struct {
		Data []app.Category `json:"data"`
	}
	bvAdmin.must("GET", "/api/categories", nil, &cats, 200)
	var businessCat int64
	for _, c := range cats.Data {
		if c.Slug == "business" {
			businessCat = c.ID
		}
	}
	var pod struct {
		Data app.Podcast `json:"data"`
	}
	bvAdmin.must("POST", "/api/podcasts", map[string]any{"title": "Norton Remodeling Podcast", "description": "<p>Remodeling insights<script>alert(1)</script></p>",
		"author": "Mark Norton", "owner_name": "Mark Norton", "owner_email": "mark@norton.test", "category_id": businessCat, "tags": []string{"remodeling", "texas"}}, &pod, 201)
	podID := pod.Data.ID
	if strings.Contains(pod.Data.Description, "<script") {
		t.Fatal("description must be sanitized (XSS)")
	}
	if code := viewer.do("POST", "/api/podcasts", map[string]any{"title": "nope"}, nil); code != 403 {
		t.Fatalf("viewer must not create podcasts: %d", code)
	}
	art := filepath.Join(tmp, "art.jpg")
	ffmpeg(t, "-f", "lavfi", "-i", "color=c=blue:s=1400x1400:d=1", "-frames:v", "1", art)
	bvAdmin.upload("podcast_artwork", podID, art, "image/jpeg")

	// MIME validation: a text file disguised as mp3 is rejected.
	fake := filepath.Join(tmp, "fake.mp3")
	os.WriteFile(fake, []byte("this is not audio at all, just text"), 0o644)

	// ---- Episode + audio upload + processing ----------------------------------------------------
	var ep struct {
		Data app.Episode `json:"data"`
	}
	bvAdmin.must("POST", "/api/episodes", map[string]any{"podcast_id": podID, "title": "Best Remodeling Company in New Braunfels",
		"description": "<p>Why homeowners choose Norton.</p>", "key_topics": []string{"remodeling", "New Braunfels"},
		"faq": []map[string]string{{"question": "Where?", "answer": "New Braunfels, Texas"}}, "transcript": "Mark: Welcome.\nGuest: Thanks."}, &ep, 201)
	epID, guid := ep.Data.ID, ep.Data.GUID
	if guid == "" || ep.Data.EpisodeNumber == nil || *ep.Data.EpisodeNumber != 1 {
		t.Fatalf("episode defaults: %+v", ep.Data)
	}
	if code := bvAdmin.do("POST", fmt.Sprintf("/api/episodes/%d/publish", epID), nil, nil); code != 422 {
		t.Fatalf("publishing without audio must fail: %d", code)
	}
	{ // spoofed upload rejected by magic-byte sniffing
		st, _ := os.Stat(fake)
		var init struct {
			Data struct {
				UploadID, URL string
			} `json:"data"`
		}
		bvAdmin.must("POST", "/api/uploads", map[string]any{"purpose": "episode_audio", "target_id": epID, "filename": "fake.mp3", "content_type": "audio/mpeg", "size": st.Size()}, &init, 201)
		req, _ := http.NewRequest(http.MethodPut, init.Data.URL, bytes.NewReader([]byte("this is not audio at all, just text")))
		resp, _ := http.DefaultClient.Do(req)
		if resp.StatusCode != 400 {
			t.Fatalf("fake audio must be rejected, got %d", resp.StatusCode)
		}
		resp.Body.Close()
		if code := bvAdmin.do("POST", "/api/uploads", map[string]any{"purpose": "episode_audio", "target_id": epID, "filename": "x.exe", "content_type": "application/x-msdownload", "size": 10}, nil); code != 400 {
			t.Fatalf("exe must be rejected: %d", code)
		}
		if code := bvAdmin.do("POST", "/api/uploads", map[string]any{"purpose": "episode_audio", "target_id": epID, "filename": "big.mp3", "content_type": "audio/mpeg", "size": 10 << 30}, nil); code != 413 {
			t.Fatalf("oversized upload must be rejected: %d", code)
		}
	}
	wav := filepath.Join(tmp, "ep.wav")
	ffmpeg(t, "-f", "lavfi", "-i", "sine=frequency=440:duration=12", wav)
	up := bvAdmin.upload("episode_audio", epID, wav, "audio/wav")
	if up["audio_file_id"] == nil {
		t.Fatalf("audio upload result: %v", up)
	}
	var epDetail struct {
		Data  app.Episode    `json:"data"`
		Audio *app.AudioFile `json:"audio"`
	}
	deadline := time.Now().Add(90 * time.Second)
	for {
		bvAdmin.must("GET", fmt.Sprintf("/api/episodes/%d", epID), nil, &epDetail, 200)
		if epDetail.Data.Status != "PROCESSING" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("audio processing timed out")
		}
		time.Sleep(500 * time.Millisecond)
	}
	if epDetail.Audio == nil || epDetail.Audio.Status != "READY" || epDetail.Data.AudioMime != "audio/mpeg" || epDetail.Data.Duration < 11 || epDetail.Data.AudioSize == 0 {
		t.Fatalf("audio not processed: %+v %+v", epDetail.Data, epDetail.Audio)
	}
	// Audio is playable from storage/CDN with range support (§118.5).
	req, _ := http.NewRequest(http.MethodGet, epDetail.Data.AudioURL, nil)
	req.Header.Set("Range", "bytes=0-99")
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 206 {
		t.Fatalf("audio not streamable: %v %v", err, resp)
	}
	resp.Body.Close()

	// ---- Publish (§118.6) ------------------------------------------------------------------------
	bvAdmin.must("POST", fmt.Sprintf("/api/episodes/%d/publish", epID), nil, nil, 200)
	bvAdmin.must("GET", fmt.Sprintf("/api/podcasts/%d", podID), nil, &pod, 200)
	if pod.Data.Status != "PUBLISHED" {
		t.Fatal("podcast should be published along with its first episode")
	}

	// ---- §119 RSS generated, public, valid, GUID stable ----------------------------------------
	code, feed := siteA.raw("/api/public/feeds/" + pod.Data.Slug)
	if code != 200 {
		t.Fatalf("feed status %d", code)
	}
	if v := rss.Validate(feed); !v.Valid {
		t.Fatalf("feed invalid: %+v\n%s", v.Issues, feed)
	}
	if !bytes.Contains(feed, []byte(guid)) || !bytes.Contains(feed, []byte(`type="audio/mpeg"`)) || !bytes.Contains(feed, []byte("<itunes:episode>1</itunes:episode>")) {
		t.Fatalf("feed content:\n%s", feed)
	}
	// New episode automatically appears; GUID unchanged after edits.
	bvAdmin.must("PUT", fmt.Sprintf("/api/episodes/%d", epID), map[string]any{"title": "Best Remodeling Company in New Braunfels, TX", "slug": "best-remodeler-new-braunfels"}, nil, 200)
	if _, err := a.DB.Exec(ctx, `UPDATE episodes SET guid='hijack' WHERE id=$1`, epID); err == nil {
		t.Fatal("database must refuse changing a published GUID")
	}
	var ep2 struct {
		Data app.Episode `json:"data"`
	}
	bvAdmin.must("POST", "/api/episodes", map[string]any{"podcast_id": podID, "title": "Kitchen Remodels", "audio_url": "https://cdn.example.com/k.mp3",
		"audio_size": 12345, "duration": 600, "status": "PUBLISHED"}, &ep2, 201)
	_, feed = siteA.raw("/api/public/feeds/" + pod.Data.Slug)
	if !bytes.Contains(feed, []byte(guid)) || !bytes.Contains(feed, []byte(ep2.Data.GUID)) || !bytes.Contains(feed, []byte("Kitchen Remodels")) {
		t.Fatalf("new episode must appear in feed with stable GUIDs:\n%s", feed)
	}
	// Slug change → automatic 301 redirect.
	pub.must("GET", "/api/public/resolve?host=businessvoice.test&path=/podcast/"+pod.Data.Slug+"/best-remodeling-company-in-new-braunfels", nil, &res, 200)
	if r, ok := res.Data["redirect"].(map[string]any); !ok || !strings.HasSuffix(r["to"].(string), "/best-remodeler-new-braunfels") {
		t.Fatalf("episode slug redirect missing: %v", res.Data)
	}

	// ---- §118.7–8 podcast & episode pages on the website ---------------------------------------
	var page struct {
		Data struct {
			Podcast  map[string]any   `json:"podcast"`
			Episodes []map[string]any `json:"episodes"`
			ListenOn []map[string]any `json:"listen_on"`
			FeedURL  string           `json:"feed_url"`
		} `json:"data"`
	}
	siteA.must("GET", "/api/public/podcasts/"+pod.Data.Slug, nil, &page, 200)
	if len(page.Data.Episodes) != 2 || !strings.HasSuffix(page.Data.FeedURL, "/feed/"+pod.Data.Slug+".xml") {
		t.Fatalf("podcast page: %+v", page.Data)
	}
	siteA.must("GET", "/api/public/podcasts/"+pod.Data.Slug+"/episodes/best-remodeler-new-braunfels", nil, nil, 200)
	// Uploaded artwork gets responsive WebP variants exposed to the website (PRD §76).
	var withVariants struct {
		Data struct {
			Podcast struct {
				ArtworkURL string `json:"artwork_url"`
			} `json:"podcast"`
		} `json:"data"`
		ImageVariants map[string]map[string]string `json:"image_variants"`
	}
	for i := 0; i < 60; i++ {
		siteA.must("GET", "/api/public/podcasts/"+pod.Data.Slug, nil, &withVariants, 200)
		if withVariants.ImageVariants[withVariants.Data.Podcast.ArtworkURL]["medium"] != "" {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if v := withVariants.ImageVariants[withVariants.Data.Podcast.ArtworkURL]; !strings.HasSuffix(v["medium"], "-medium.webp") || v["thumbnail"] == "" || v["large"] == "" {
		t.Fatalf("artwork WebP variants missing: %+v", withVariants.ImageVariants)
	}
	var search struct {
		Data struct {
			Podcasts []map[string]any `json:"podcasts"`
			Episodes []map[string]any `json:"episodes"`
		} `json:"data"`
	}
	siteA.must("GET", "/api/public/search?q=remodel", nil, &search, 200)
	if len(search.Data.Podcasts) == 0 || len(search.Data.Episodes) == 0 {
		t.Fatalf("search: %+v", search.Data)
	}
	code, sm := siteA.raw("/api/public/sitemap/podcasts")
	if code != 200 || !bytes.Contains(sm, []byte("/podcast/"+pod.Data.Slug)) {
		t.Fatalf("sitemap: %d %s", code, sm)
	}

	// ---- §117.5 tenant isolation -------------------------------------------------------------------
	siteB := &client{t: t, base: base, host: "techvoice.test"}
	if code := siteB.do("GET", "/api/public/podcasts/"+pod.Data.Slug, nil, nil); code != 404 {
		t.Fatalf("podcast of tenant A leaked onto tenant B: %d", code)
	}
	if code := tvAdmin.do("GET", fmt.Sprintf("/api/podcasts/%d", podID), nil, nil); code != 403 {
		t.Fatalf("tenant B admin read tenant A podcast: %d", code)
	}
	if code := tvAdmin.do("PUT", fmt.Sprintf("/api/episodes/%d", epID), map[string]any{"title": "x"}, nil); code != 403 {
		t.Fatalf("tenant B admin edited tenant A episode: %d", code)
	}
	var list struct {
		Data []app.Podcast `json:"data"`
	}
	tvAdmin.must("GET", fmt.Sprintf("/api/podcasts?tenant_id=%d", tenantA.Data.ID), nil, &list, 200)
	if len(list.Data) != 0 {
		t.Fatal("tenant_id from the frontend must not widen a tenant user's scope")
	}

	// ---- §117.6 / §114 syndication without duplicating the podcast --------------------------------
	if code := root.do("PUT", fmt.Sprintf("/api/podcasts/%d/tenants", podID), map[string]any{"tenant_ids": []int64{tenantA.Data.ID, tenantB.Data.ID}}, nil); code != 400 {
		t.Fatalf("independent tenant's podcast must not be syndicated: %d", code)
	}
	root.must("PUT", fmt.Sprintf("/api/tenants/%d", tenantA.Data.ID), map[string]any{"content_mode": "SYNDICATED"}, nil, 200)
	root.must("PUT", fmt.Sprintf("/api/podcasts/%d/tenants", podID), map[string]any{"tenant_ids": []int64{tenantA.Data.ID, tenantB.Data.ID}}, nil, 200)
	siteB.must("GET", "/api/public/podcasts/"+pod.Data.Slug, nil, nil, 200)
	var count int
	a.DB.QueryRow(ctx, `SELECT count(*) FROM podcasts WHERE title LIKE 'Norton%'`).Scan(&count)
	if count != 1 {
		t.Fatalf("podcast duplicated: %d", count)
	}
	// Per-tenant override + canonical primary.
	tvAdmin.must("PUT", fmt.Sprintf("/api/podcasts/%d/tenants/%d", podID, tenantB.Data.ID), map[string]any{"seo_title": "Remodeling on TechVoice", "canonical_mode": "PRIMARY"}, nil, 200)
	var pageB struct {
		Data struct {
			Podcast      map[string]any `json:"podcast"`
			CanonicalURL string         `json:"canonical_url"`
		} `json:"data"`
	}
	siteB.must("GET", "/api/public/podcasts/"+pod.Data.Slug, nil, &pageB, 200)
	if pageB.Data.Podcast["seo_title"] != "Remodeling on TechVoice" || !strings.Contains(pageB.Data.CanonicalURL, "businessvoice.test") {
		t.Fatalf("override/canonical: %+v", pageB.Data)
	}

	// ---- §120 distribution ------------------------------------------------------------------------
	var plat struct {
		Data struct {
			ID  int64  `json:"id"`
			Key string `json:"key"`
		} `json:"data"`
	}
	root.must("POST", "/api/platforms", map[string]any{"name": "Fountain", "submit_url": "https://fountain.fm", "url_pattern": "https://fountain.fm/show/{id}", "color": "#5C3BFE"}, &plat, 201)
	var dist struct {
		Data struct {
			Platforms []app.Distribution `json:"platforms"`
			Live      int                `json:"live"`
			Total     int                `json:"total"`
			Readiness app.Readiness      `json:"readiness"`
		} `json:"data"`
	}
	bvAdmin.must("GET", fmt.Sprintf("/api/distribution/%d", podID), nil, &dist, 200)
	if dist.Data.Total != 14 || dist.Data.Live != 0 {
		t.Fatalf("distribution dashboard: live %d total %d", dist.Data.Live, dist.Data.Total)
	}
	if !dist.Data.Readiness.Ready {
		t.Fatalf("readiness should be 100%%: %+v", dist.Data.Readiness)
	}
	if code := bvAdmin.do("POST", fmt.Sprintf("/api/distribution/%d/spotify", podID), map[string]any{"status": "LIVE"}, nil); code != 400 {
		t.Fatalf("LIVE without URL must be rejected: %d", code)
	}
	bvAdmin.must("POST", fmt.Sprintf("/api/distribution/%d/spotify", podID), map[string]any{"status": "LIVE", "external_url": "https://open.spotify.com/show/abc"}, nil, 200)
	bvAdmin.must("POST", fmt.Sprintf("/api/distribution/%d/%s", podID, plat.Data.Key), map[string]any{"status": "LIVE", "external_id": "999"}, nil, 200)
	bvAdmin.must("POST", fmt.Sprintf("/api/distribution/%d/tunein", podID), map[string]any{"status": "ACTION_REQUIRED", "issue_reason": "Artwork does not meet requirements."}, nil, 200)
	bvAdmin.must("POST", fmt.Sprintf("/api/distribution/%d/amazon", podID), map[string]any{"status": "PENDING"}, nil, 200)
	bvAdmin.must("GET", fmt.Sprintf("/api/distribution/%d", podID), nil, &dist, 200)
	if dist.Data.Live != 2 {
		t.Fatalf("live count %d", dist.Data.Live)
	}
	siteA.must("GET", "/api/public/podcasts/"+pod.Data.Slug, nil, &page, 200)
	if len(page.Data.ListenOn) != 2 {
		t.Fatalf("only LIVE platforms should be public: %+v", page.Data.ListenOn)
	}
	for _, l := range page.Data.ListenOn {
		if l["platform_key"] == "fountain" && l["url"] != "https://fountain.fm/show/999" {
			t.Fatalf("url pattern not applied: %v", l)
		}
	}
	var issues struct {
		Data []app.Distribution `json:"data"`
	}
	bvAdmin.must("GET", "/api/distribution?status=ISSUES", nil, &issues, 200)
	if len(issues.Data) != 1 || issues.Data[0].IssueReason == "" {
		t.Fatalf("issues: %+v", issues.Data)
	}
	var overview struct {
		Data struct {
			Counts        map[string]int `json:"counts"`
			HealthPercent int            `json:"health_percent"`
		} `json:"data"`
	}
	bvAdmin.must("GET", "/api/distribution/overview", nil, &overview, 200)
	if overview.Data.Counts["LIVE"] != 2 || overview.Data.Counts["ACTION_REQUIRED"] != 1 || overview.Data.HealthPercent != 75 {
		t.Fatalf("overview: %+v", overview.Data)
	}

	// ---- Analytics -------------------------------------------------------------------------------
	for _, typ := range []string{"PAGE_VIEW", "PLAY", "25_PERCENT", "50_PERCENT", "75_PERCENT", "COMPLETE"} {
		code := siteA.do("POST", "/api/public/events", map[string]any{"type": typ, "episode_id": epID, "session_id": "s1", "path": "/podcast/x"}, nil)
		if code != 202 {
			t.Fatalf("event %s: %d", typ, code)
		}
	}
	// Events for content not on the site are ignored (isolation).
	other := &client{t: t, base: base, host: "techvoice.test"}
	a.DB.Exec(ctx, `DELETE FROM tenant_podcasts WHERE tenant_id=$1`, tenantB.Data.ID)
	var acc struct {
		Accepted int `json:"accepted"`
	}
	other.must("POST", "/api/public/events", map[string]any{"type": "PLAY", "episode_id": epID}, &acc, 202)
	if acc.Accepted != 0 {
		t.Fatal("event for foreign content must be rejected")
	}
	a.AggregateAnalytics(ctx, 2)
	var sum struct {
		Data app.AnalyticsSummary `json:"data"`
	}
	bvAdmin.must("GET", "/api/analytics/summary?days=7", nil, &sum, 200)
	if sum.Data.EpisodePlays != 1 || sum.Data.PageViews != 1 || sum.Data.Completions != 1 || sum.Data.UniqueVisitors != 1 {
		t.Fatalf("analytics: %+v", sum.Data)
	}
	var net struct {
		Data struct {
			Tenants []app.TenantComparison `json:"tenants"`
		} `json:"data"`
	}
	root.must("GET", "/api/analytics/network", nil, &net, 200)
	if len(net.Data.Tenants) != 2 {
		t.Fatalf("network comparison: %+v", net.Data)
	}
	if code := bvAdmin.do("GET", "/api/analytics/network", nil, nil); code != 403 {
		t.Fatalf("network analytics must be super admin only: %d", code)
	}

	// ---- Scheduling in tenant timezone --------------------------------------------------------------
	var ep3 struct {
		Data app.Episode `json:"data"`
	}
	bvAdmin.must("POST", "/api/episodes", map[string]any{"podcast_id": podID, "title": "Scheduled", "audio_url": "https://cdn.example.com/s.mp3", "audio_size": 10, "duration": 60}, &ep3, 201)
	local := time.Now().In(mustLoc("America/Chicago")).Add(48 * time.Hour).Format("2006-01-02 15:04")
	bvAdmin.must("POST", fmt.Sprintf("/api/episodes/%d/schedule", ep3.Data.ID), map[string]any{"publish_at": local}, &ep3, 200)
	want, _ := time.ParseInLocation("2006-01-02 15:04", local, mustLoc("America/Chicago"))
	var got time.Time
	a.DB.QueryRow(ctx, `SELECT scheduled_at FROM episodes WHERE id=$1`, ep3.Data.ID).Scan(&got)
	if !got.Equal(want) {
		t.Fatalf("schedule timezone: got %v want %v", got, want)
	}
	a.DB.Exec(ctx, `UPDATE episodes SET scheduled_at=now()-interval '1 minute' WHERE id=$1`, ep3.Data.ID)
	if n, _ := a.PublishDue(ctx); n != 1 {
		t.Fatalf("scheduled publish count %d", n)
	}

	// ---- Audit, API key, RSS importer (round trip of our own feed) --------------------------------
	var audit struct {
		Data []map[string]any `json:"data"`
	}
	root.must("GET", "/api/audit-logs?action=UPDATED_EPISODE", nil, &audit, 200)
	if len(audit.Data) == 0 {
		t.Fatal("audit log missing UPDATED_EPISODE")
	}
	var key struct {
		Data struct {
			Key string `json:"key"`
		} `json:"data"`
	}
	bvAdmin.must("POST", "/api/api-keys", map[string]any{"name": "ci", "permissions": []string{"read:podcasts"}}, &key, 201)
	apiClient := &client{t: t, base: base, token: key.Data.Key}
	apiClient.must("GET", "/api/podcasts", nil, nil, 200)
	if code := apiClient.do("POST", "/api/podcasts", map[string]any{"title": "x"}, nil); code != 403 {
		t.Fatalf("read-only key wrote: %d", code)
	}
	if code := apiClient.do("GET", "/api/users", nil, nil); code != 403 {
		t.Fatalf("api key reached users: %d", code)
	}
	feedSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(feed) }))
	defer feedSrv.Close()
	root.must("POST", "/api/imports/rss", map[string]any{"feed_url": feedSrv.URL + "/feed.xml", "mode": "METADATA_ONLY", "tenant_id": tenantB.Data.ID, "sync_enabled": true, "sync_interval_minutes": 60}, nil, 202)
	deadline = time.Now().Add(60 * time.Second)
	var imported int
	for time.Now().Before(deadline) {
		a.DB.QueryRow(ctx, `SELECT count(*) FROM episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE p.source_type='IMPORTED' AND p.owner_tenant_id=$1`, tenantB.Data.ID).Scan(&imported)
		if imported >= 2 {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if imported < 2 {
		var st, le string
		a.DB.QueryRow(ctx, `SELECT status, last_error FROM rss_sources ORDER BY id DESC LIMIT 1`).Scan(&st, &le)
		var jobs []string
		rows, _ := a.DB.Query(ctx, `SELECT type||':'||status||':'||error FROM job_runs WHERE type IN ('IMPORT_RSS','SYNC_RSS')`)
		for rows.Next() { var j string; rows.Scan(&j); jobs = append(jobs, j) }
		rows.Close()
		t.Fatalf("RSS import created %d episodes (source %s %q, jobs %v)", imported, st, le, jobs)
	}
}

func mustLoc(name string) *time.Location {
	l, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return l
}
