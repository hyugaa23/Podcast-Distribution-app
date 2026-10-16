package app

import (
	"context"
	"fmt"
	"math/rand"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"podcast/api/internal/authn"
	"podcast/api/internal/media"
	"podcast/api/internal/storage"
	"podcast/api/internal/util"
)

type demoTenant struct {
	Name, Slug, Theme, Mode, Tagline string
	Primary                          string
	Podcasts                         []demoPodcast
}

type demoPodcast struct {
	Title, Category, Sub, Host, Description string
	Explicit                                bool
	Colors                                  [2]string
}

var demoTenants = []demoTenant{
	{"Podcast Business", "podcastbusiness", "business", ModeSyndicated, "Insights for builders, operators and investors.", "#1457FF", []demoPodcast{
		{"My Business Podcast", "Business", "Entrepreneurship", "Sarah Mitchell", "Weekly conversations with founders about building durable companies, from first customer to scale.", false, [2]string{"0x1457FF", "0x0B1F4D"}},
		{"Marketing Mondays", "Business", "Marketing", "David Chen", "Practical growth marketing playbooks for B2B teams, every Monday.", false, [2]string{"0x0EA5E9", "0x111827"}},
		{"Norton Remodeling Podcast", "Business", "Management", "Mark Norton", "Home renovation business insights from the team at Norton Remodeling in New Braunfels, Texas.", false, [2]string{"0x334155", "0x1457FF"}},
	}},
	{"TechVoice", "techvoice", "tech", ModeSyndicated, "Engineering, AI and the future of software.", "#6366F1", []demoPodcast{
		{"Shipping Code", "Technology", "", "Priya Raman", "Deep dives into how great engineering teams design, build and ship software.", false, [2]string{"0x6366F1", "0x06B6D4"}},
		{"AI Weekly Brief", "Technology", "", "Leo Park", "The most important developments in artificial intelligence, explained in 20 minutes.", false, [2]string{"0x22D3EE", "0x312E81"}},
	}},
	{"DailyCast", "dailycast", "news", ModeSyndicated, "The news you need, every morning.", "#B91C1C", []demoPodcast{
		{"The Morning Report", "News", "Daily News", "Anna Lopez", "Top stories of the day in fifteen minutes, every weekday morning.", false, [2]string{"0xB91C1C", "0x111111"}},
		{"Policy Room", "News", "Politics", "James Whitfield", "Analysis of the policy debates shaping current affairs.", false, [2]string{"0x1D4ED8", "0x7F1D1D"}},
	}},
	{"CreatorVoice", "creatorvoice", "creator", ModeIndependent, "Stories from the creator economy.", "#F97316", []demoPodcast{
		{"Creative Hours with Mia", "Arts", "Design", "Mia Torres", "Mia talks with designers, illustrators and makers about creative careers and the business of art.", false, [2]string{"0xF97316", "0xFB7185"}},
	}},
	{"PremiumTalk", "premiumtalk", "magazine", ModeSyndicated, "Curated conversations for curious minds.", "#9A7B4F", []demoPodcast{
		{"The Long Read", "Society", "Documentary", "Eleanor Grey", "Narrative documentaries about the people and ideas behind remarkable stories.", false, [2]string{"0x9A7B4F", "0x1A1A1A"}},
		{"Taste & Table", "Arts", "Food", "Marco Bellini", "Chefs, farmers and food writers on the culture of eating well.", false, [2]string{"0xB45309", "0x3F2A14"}},
	}},
	{"StreamHub", "streamhub", "stream", ModeShared, "Discover the best shows in one place.", "#1ED6A0", []demoPodcast{
		{"Night Owls Comedy", "Comedy", "Improv", "Jake & Riley", "Two friends improvise ridiculous stories after midnight.", true, [2]string{"0x1ED6A0", "0x7C5CFF"}},
	}},
	{"Editorial Audio", "editorialaudio", "editorial", ModeSyndicated, "Audio journalism, carefully edited.", "#C2410C", []demoPodcast{
		{"Ideas in Print", "Arts", "Books", "Helen Ward", "Authors discuss the books that changed how they see the world.", false, [2]string{"0xC2410C", "0x1C1917"}},
	}},
	{"Quiet Shows", "quietshows", "minimal", ModeIndependent, "Less noise. More listening.", "#111111", []demoPodcast{
		{"Slow Mornings", "Health", "Mental Health", "Noah Kim", "Calm, reflective conversations about rest, attention and living deliberately.", false, [2]string{"0x111111", "0x8A8A8A"}},
	}},
	{"RadioWave", "radiowave", "radio", ModeSyndicated, "Always on. Always live.", "#FACC15", []demoPodcast{
		{"Matchday Live", "Sports", "Soccer", "Chris Adeyemi", "Pre-match predictions and post-match reactions from the terraces.", false, [2]string{"0xFACC15", "0xEF4444"}},
		{"Late Night Sessions", "Music", "Music Interviews", "DJ Sol", "Artists talk about their latest records and the songs that shaped them.", false, [2]string{"0xEF4444", "0x0B1120"}},
	}},
	{"FunCast", "funcast", "entertainment", ModeSyndicated, "Pop culture, unfiltered.", "#FF3D8B", []demoPodcast{
		{"Screen Time", "TV & Film", "Film Reviews", "Zoe Martin", "Spoiler-friendly reviews of this week's biggest releases.", false, [2]string{"0xFF3D8B", "0x7C3AED"}},
		{"True Crime Tuesday", "True Crime", "", "Sam Rivers", "Carefully researched retellings of unsolved cases.", true, [2]string{"0x7C3AED", "0x14051F"}},
	}},
}

var library = []demoPodcast{
	{"Science Unplugged", "Science", "Astronomy", "Dr. Amara Okafor", "Big questions about the universe, answered by working scientists.", false, [2]string{"0x0EA5E9", "0x0F172A"}},
	{"History Hour", "History", "", "Thomas Reed", "Forgotten moments that changed history, told in an hour.", false, [2]string{"0xA16207", "0x292524"}},
}

var episodeTitles = []string{
	"Getting Started: Why This Show Exists",
	"Lessons From the First Year",
	"The Big Interview",
	"Mistakes Worth Making",
	"What Comes Next",
}

// SeedDemo creates demo tenants (one per theme), podcasts, playable episodes, distribution records and analytics.
func (a *App) SeedDemo(ctx context.Context) error {
	var exists bool
	a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tenants WHERE slug='podcastbusiness')`).Scan(&exists)
	if exists {
		a.Log.Info("demo data already present")
		return nil
	}
	tmp, err := os.MkdirTemp("", "pe-demo")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	rnd := rand.New(rand.NewSource(42))

	pw, _ := authn.HashPassword("ChangeMe123!")
	var allPodcasts []int64
	tenantIDs := map[string]int64{}
	for ti, dt := range demoTenants {
		id, err := a.CreateTenant(ctx, CreateTenantInput{Name: dt.Name, Slug: dt.Slug, Domain: dt.Slug + ".localhost", ThemeKey: dt.Theme,
			PrimaryColor: dt.Primary, Language: "en", Timezone: []string{"America/Chicago", "America/New_York", "Europe/London", "Asia/Jakarta"}[ti%4],
			ContentMode: dt.Mode})
		if err != nil {
			return fmt.Errorf("tenant %s: %w", dt.Slug, err)
		}
		tenantIDs[dt.Slug] = id
		a.DB.Exec(ctx, `UPDATE tenant_settings SET branding = branding || jsonb_build_object('tagline', $2::text,
			'social_links', jsonb_build_object('x','https://x.com/'||$3::text,'instagram','https://instagram.com/'||$3::text)) WHERE tenant_id=$1`,
			id, dt.Tagline, dt.Slug)
		a.DB.Exec(ctx, `UPDATE tenant_settings SET about_content=$2 WHERE tenant_id=$1`, id,
			fmt.Sprintf("<p>%s is part of a multi-domain podcast network. %s</p>", dt.Name, dt.Tagline))
		// www alias redirects to the primary domain.
		a.AddDomain(ctx, id, "www."+dt.Slug+".localhost", false, true)
		if dt.Slug == "podcastbusiness" {
			a.DB.Exec(ctx, `INSERT INTO users(email, password_hash, name, role, tenant_id) VALUES
				('admin@podcastbusiness.localhost',$1,'Business Admin','TENANT_ADMIN',$2),
				('editor@podcastbusiness.localhost',$1,'Business Editor','EDITOR',$2),
				('viewer@podcastbusiness.localhost',$1,'Business Viewer','VIEWER',$2) ON CONFLICT DO NOTHING`, pw, id)
		}
		if dt.Slug == "techvoice" {
			a.DB.Exec(ctx, `INSERT INTO users(email, password_hash, name, role, tenant_id) VALUES
				('admin@techvoice.localhost',$1,'Tech Admin','TENANT_ADMIN',$2) ON CONFLICT DO NOTHING`, pw, id)
		}
		for pi, dp := range dt.Podcasts {
			pid, err := a.demoPodcast(ctx, tmp, rnd, &id, dp, pi)
			if err != nil {
				return err
			}
			allPodcasts = append(allPodcasts, pid)
			if dt.Slug == "creatorvoice" {
				a.DB.Exec(ctx, `INSERT INTO users(email, password_hash, name, role, tenant_id) VALUES
					('mia@creatorvoice.localhost',$1,'Mia Torres','CREATOR',$2) ON CONFLICT DO NOTHING`, pw, id)
				a.DB.Exec(ctx, `INSERT INTO user_podcasts(user_id, podcast_id) SELECT id, $1 FROM users WHERE email='mia@creatorvoice.localhost'`, pid)
			}
		}
	}
	// Central library podcasts (shown on SHARED tenants, syndicated to others).
	for i, dp := range library {
		pid, err := a.demoPodcast(ctx, tmp, rnd, nil, dp, i)
		if err != nil {
			return err
		}
		allPodcasts = append(allPodcasts, pid)
		for _, slug := range []string{"premiumtalk", "editorialaudio", "techvoice"} {
			a.DB.Exec(ctx, `INSERT INTO tenant_podcasts(tenant_id, podcast_id, canonical_mode) VALUES ($1,$2,'PRIMARY') ON CONFLICT DO NOTHING`, tenantIDs[slug], pid)
		}
		a.DB.Exec(ctx, `UPDATE podcasts SET canonical_tenant_id=$2 WHERE id=$1`, pid, tenantIDs["streamhub"])
	}
	// Syndication: business shows also appear on PremiumTalk and DailyCast (one podcast, many sites).
	var bizID, aiID int64
	a.DB.QueryRow(ctx, `SELECT id FROM podcasts WHERE slug='my-business-podcast'`).Scan(&bizID)
	a.DB.QueryRow(ctx, `SELECT id FROM podcasts WHERE slug='ai-weekly-brief'`).Scan(&aiID)
	for _, slug := range []string{"premiumtalk", "dailycast"} {
		a.DB.Exec(ctx, `INSERT INTO tenant_podcasts(tenant_id, podcast_id, canonical_mode, seo_title) VALUES ($1,$2,'PRIMARY',$3) ON CONFLICT DO NOTHING`,
			tenantIDs[slug], bizID, "My Business Podcast — founder interviews")
	}
	a.DB.Exec(ctx, `INSERT INTO tenant_podcasts(tenant_id, podcast_id, canonical_mode) VALUES ($1,$2,'PRIMARY') ON CONFLICT DO NOTHING`, tenantIDs["dailycast"], aiID)

	// Featured / editor's picks per tenant.
	a.DB.Exec(ctx, `UPDATE tenant_podcasts tp SET is_featured=true FROM (
		SELECT DISTINCT ON (tenant_id) tenant_id, podcast_id FROM tenant_podcasts ORDER BY tenant_id, podcast_id) f
		WHERE tp.tenant_id=f.tenant_id AND tp.podcast_id=f.podcast_id`)
	a.DB.Exec(ctx, `UPDATE tenant_podcasts SET is_editors_pick=true WHERE (tenant_id + podcast_id) % 2 = 0`)

	// Collections on the magazine tenant (PRD §92).
	var colID int64
	if a.DB.QueryRow(ctx, `INSERT INTO collections(tenant_id, title, slug, description) VALUES ($1,'Editor''s Picks','editors-picks',
		'Hand-picked shows from our editors.') RETURNING id`, tenantIDs["premiumtalk"]).Scan(&colID) == nil {
		a.DB.Exec(ctx, `INSERT INTO collection_items(collection_id, podcast_id, sort_order)
			SELECT $1, podcast_id, row_number() OVER () FROM tenant_podcast_ids($2)`, colID, tenantIDs["premiumtalk"])
	}
	a.DB.Exec(ctx, `INSERT INTO collections(tenant_id, title, slug, description) VALUES ($1,'Best Marketing Podcasts','best-marketing-podcasts',
		'Our favourite shows on growth and marketing.') ON CONFLICT DO NOTHING`, tenantIDs["podcastbusiness"])
	a.DB.Exec(ctx, `INSERT INTO collection_items(collection_id, podcast_id) SELECT c.id, p.id FROM collections c, podcasts p
		WHERE c.slug='best-marketing-podcasts' AND p.slug IN ('marketing-mondays','my-business-podcast') ON CONFLICT DO NOTHING`)
	a.DB.Exec(ctx, `UPDATE tenant_settings SET homepage_sections = (SELECT jsonb_agg(CASE WHEN s->>'type'='collections'
		THEN jsonb_set(s, '{enabled}', 'true') ELSE s END) FROM jsonb_array_elements(homepage_sections) s) WHERE tenant_id=$1`, tenantIDs["premiumtalk"])

	a.demoDistribution(ctx, rnd, allPodcasts)
	a.demoAnalytics(ctx, rnd)
	a.AggregateAnalytics(ctx, 40)
	a.Log.Info("demo data created", "tenants", len(demoTenants), "podcasts", len(allPodcasts))
	return nil
}

func (a *App) demoPodcast(ctx context.Context, tmp string, rnd *rand.Rand, owner *int64, dp demoPodcast, idx int) (int64, error) {
	slug := a.UniquePodcastSlug(ctx, dp.Title, 0)
	catID := a.categoryByName(ctx, dp.Category)
	var subID *int64
	if dp.Sub != "" {
		subID = a.categoryByName(ctx, dp.Sub)
	}
	var id int64
	err := a.DB.QueryRow(ctx, `INSERT INTO podcasts(owner_tenant_id, title, slug, description, short_description, author, owner_name,
		owner_email, language, explicit, copyright, category_id, subcategory_id, status, published_at)
		VALUES ($1,$2,$3,$4,$5,$6,$6,$7,'en',$8,$9,$10,$11,'PUBLISHED', now() - interval '120 days') RETURNING id`,
		owner, dp.Title, slug, "<p>"+dp.Description+"</p><p>New episodes every week. Subscribe so you never miss one.</p>", dp.Description,
		dp.Host, "hello@"+slug+".example.com", dp.Explicit, fmt.Sprintf("© %d %s", time.Now().Year(), dp.Host), catID, subID).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("podcast %s: %w", dp.Title, err)
	}
	if owner != nil {
		a.DB.Exec(ctx, `INSERT INTO tenant_podcasts(tenant_id, podcast_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, *owner, id)
	}
	// Artwork: 1400x1400 gradient JPEG (directory compliant) + WebP variants.
	art := filepath.Join(tmp, slug+".jpg")
	artDir, _ := os.MkdirTemp(tmp, "art")
	if err := a.renderCover(ctx, artDir, art, coverSpec{Title: dp.Title, Kicker: dp.Category + " podcast", Byline: "with " + dp.Host,
		C0: dp.Colors[0], C1: dp.Colors[1], Style: idx + len(dp.Title)}); err == nil {
		key := storage.PodcastKey(id, "artwork-"+uuid.NewString()[:8]+".jpg")
		if size, err := a.putFile(ctx, key, art, "image/jpeg"); err == nil {
			a.DB.Exec(ctx, `UPDATE podcasts SET artwork_url=$2 WHERE id=$1`, id, a.Storage.URL(key))
			var imgID int64
			a.DB.QueryRow(ctx, `INSERT INTO images(tenant_id, owner_type, owner_id, original_key, mime, size) VALUES ($1,'podcast',$2,$3,'image/jpeg',$4) RETURNING id`,
				owner, id, key, size).Scan(&imgID)
			a.ProcessImage(ctx, imgID)
		}
	}
	if bn := filepath.Join(artDir, "banner.jpg"); a.renderBanner(ctx, artDir, bn, dp.Colors[0], dp.Colors[1]) == nil {
		if bu, err := a.storeDemoImage(ctx, bn, storage.PodcastKey(id, "banner-"+uuid.NewString()[:8]+".jpg"), "podcast_banner", id, owner); err == nil {
			a.DB.Exec(ctx, `UPDATE podcasts SET banner_url=$2 WHERE id=$1`, id, bu)
		}
	}
	// Host with photo.
	hslug := a.UniqueHostSlug(ctx, dp.Host, 0)
	var hostID int64
	a.DB.QueryRow(ctx, `INSERT INTO hosts(owner_tenant_id, name, slug, bio, website_url, social_links) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		owner, dp.Host, hslug, fmt.Sprintf("<p>%s hosts %s. %s</p>", dp.Host, dp.Title, dp.Description),
		"https://example.com/"+hslug, map[string]string{"x": "https://x.com/" + strings.ReplaceAll(hslug, "-", ""), "linkedin": "https://linkedin.com/in/" + hslug}).Scan(&hostID)
	photo := filepath.Join(tmp, hslug+".jpg")
	avDir, _ := os.MkdirTemp(tmp, "av")
	if a.renderAvatar(ctx, avDir, photo, dp.Host, dp.Colors[1], dp.Colors[0]) == nil {
		key := storage.TenantImageKey(deref(owner), "host-"+uuid.NewString()[:8]+".jpg")
		if size, err := a.putFile(ctx, key, photo, "image/jpeg"); err == nil {
			a.DB.Exec(ctx, `UPDATE hosts SET photo_url=$2 WHERE id=$1`, hostID, a.Storage.URL(key))
			var imgID int64
			a.DB.QueryRow(ctx, `INSERT INTO images(tenant_id, owner_type, owner_id, original_key, mime, size) VALUES ($1,'host',$2,$3,'image/jpeg',$4) RETURNING id`,
				owner, hostID, key, size).Scan(&imgID)
			a.ProcessImage(ctx, imgID)
		}
	}
	a.DB.Exec(ctx, `INSERT INTO podcast_hosts(podcast_id, host_id, role) VALUES ($1,$2,'host')`, id, hostID)
	tx, _ := a.DB.Begin(ctx)
	a.SetPodcastTags(ctx, tx, id, []string{dp.Category, strings.Split(dp.Title, " ")[0], "interviews"})
	tx.Commit(ctx)

	// Episodes with real, playable audio generated by FFmpeg.
	n := 3 + idx%3
	for i := 0; i < n; i++ {
		title := episodeTitles[i%len(episodeTitles)]
		if dp.Title == "Norton Remodeling Podcast" && i == n-1 {
			title = "Best Remodeling Company in New Braunfels"
		}
		freq := 220 + rnd.Intn(440)
		src := filepath.Join(tmp, fmt.Sprintf("%s-%d.mp3", slug, i))
		if err := exec.CommandContext(ctx, a.Cfg.FFmpegPath, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
			fmt.Sprintf("sine=frequency=%d:duration=%d", freq, 45+rnd.Intn(60)), "-af", "volume=0.15",
			"-c:a", "libmp3lame", "-b:a", "128k", src).Run(); err != nil {
			return 0, fmt.Errorf("ffmpeg audio: %w (is ffmpeg installed?)", err)
		}
		info, err := a.Media.ProbeAudio(ctx, src)
		if err != nil {
			return 0, err
		}
		pub := time.Now().Add(-time.Duration((n-i)*7*24) * time.Hour)
		epSlug := a.UniqueEpisodeSlug(ctx, id, title, 0)
		var eid int64
		err = a.DB.QueryRow(ctx, `INSERT INTO episodes(podcast_id, title, slug, description, short_description, show_notes, episode_number,
			season_number, episode_type, explicit, status, published_at, guid, transcript, transcript_format, transcript_source, key_topics, faq)
			VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,'PUBLISHED',$10,$11,$12,'txt','manual',$13,$14) RETURNING id`,
			id, title, epSlug,
			fmt.Sprintf("<p>In this episode of %s, %s explores <strong>%s</strong>.</p>", dp.Title, dp.Host, strings.ToLower(title)),
			fmt.Sprintf("%s discusses %s.", dp.Host, strings.ToLower(title)),
			"<ul><li>Introduction</li><li>Main discussion</li><li>Key takeaways</li></ul>",
			i+1, map[bool]string{true: "trailer", false: "full"}[i == 0 && idx == 0], dp.Explicit, pub, uuid.NewString(),
			fmt.Sprintf("%s: Welcome to %s. Today we talk about %s.\nGuest: Thanks for having me.\n%s: Let's get started.", dp.Host, dp.Title, strings.ToLower(title), dp.Host),
			fmt.Sprintf(`["%s", "%s", "%s"]`, dp.Category, strings.ToLower(title), "interviews"),
			fmt.Sprintf(`[{"question":"What is this episode about?","answer":"%s discusses %s."}]`, dp.Host, strings.ToLower(title)),
		).Scan(&eid)
		if err != nil {
			return 0, fmt.Errorf("episode: %w", err)
		}
		key := storage.AudioKey(id, eid, uuid.NewString()[:8]+".mp3")
		size, err := a.putFile(ctx, key, src, "audio/mpeg")
		if err != nil {
			return 0, err
		}
		var afID int64
		a.DB.QueryRow(ctx, `INSERT INTO audio_files(tenant_id, podcast_id, episode_id, original_key, original_name, original_mime, original_size,
			processed_key, processed_size, codec, bitrate, sample_rate, channels, duration, status)
			VALUES ($1,$2,$3,$4,$5,'audio/mpeg',$6,$4,$6,$7,$8,$9,$10,$11,'READY') RETURNING id`,
			owner, id, eid, key, filepath.Base(src), size, info.Codec, info.Bitrate, info.SampleRate, info.Channels,
			media.SecondsRounded(info.Duration)).Scan(&afID)
		a.DB.Exec(ctx, `UPDATE episodes SET audio_file_id=$2, audio_url=$3, audio_size=$4, audio_mime='audio/mpeg', duration=$5 WHERE id=$1`,
			eid, afID, a.Storage.URL(key), size, media.SecondsRounded(info.Duration))
	}
	return id, nil
}

func (a *App) demoDistribution(ctx context.Context, rnd *rand.Rand, podcasts []int64) {
	type pl struct {
		id      int64
		key     string
		pattern string
	}
	rows, err := a.DB.Query(ctx, `SELECT id, key, url_pattern FROM platforms ORDER BY sort_order`)
	if err != nil {
		return
	}
	var pls []pl
	for rows.Next() {
		var p pl
		rows.Scan(&p.id, &p.key, &p.pattern)
		pls = append(pls, p)
	}
	rows.Close()
	for _, pid := range podcasts {
		for i, p := range pls {
			status := "LIVE"
			switch {
			case i >= 9:
				status = []string{"NOT_STARTED", "READY", "SUBMITTED"}[rnd.Intn(3)]
			case p.key == "amazon-music":
				status = "PENDING"
			case p.key == "tunein" && pid%3 == 0:
				status = "ACTION_REQUIRED"
			case p.key == "deezer" && pid%4 == 0:
				status = "FAILED"
			case p.key == "podcast-index":
				status = "SUBMITTED"
			}
			if status == "NOT_STARTED" {
				continue
			}
			extID := util.RandomHex(6)
			url := ""
			if status == "LIVE" {
				url = strings.ReplaceAll(p.pattern, "{id}", extID)
			}
			reason := ""
			if status == "ACTION_REQUIRED" {
				reason = "Artwork does not meet requirements."
			} else if status == "FAILED" {
				reason = "Feed could not be fetched by the platform."
			}
			a.DB.Exec(ctx, `INSERT INTO podcast_distributions(podcast_id, platform_id, status, external_id, external_url, submitted_at,
				approved_at, last_checked_at, issue_reason, notes) VALUES ($1,$2,$3,$4,$5, now() - interval '30 days',
				CASE WHEN $3='LIVE' THEN now() - interval '20 days' END, now(), $6, '') ON CONFLICT DO NOTHING`,
				pid, p.id, status, map[bool]string{true: extID, false: ""}[status == "LIVE"], url, reason)
		}
	}
}

func (a *App) demoAnalytics(ctx context.Context, rnd *rand.Rand) {
	rows, err := a.DB.Query(ctx, `SELECT t.id, d.domain, e.id, e.podcast_id, p.slug, e.slug FROM tenants t
		JOIN domains d ON d.tenant_id=t.id AND d.is_primary
		JOIN tenant_podcast_ids(t.id) v ON true JOIN episodes e ON e.podcast_id=v.podcast_id JOIN podcasts p ON p.id=e.podcast_id`)
	if err != nil {
		return
	}
	type row struct {
		tid, eid, pid      int64
		domain, ps, es     string
	}
	var list []row
	for rows.Next() {
		var x row
		rows.Scan(&x.tid, &x.domain, &x.eid, &x.pid, &x.ps, &x.es)
		list = append(list, x)
	}
	rows.Close()
	countries := []string{"US", "US", "US", "GB", "ID", "DE", "CA", "AU", "IN", "BR"}
	devices := []string{"Mobile", "Mobile", "Desktop", "Tablet"}
	browsers := []string{"Chrome", "Safari", "Firefox", "Edge"}
	refs := []string{"", "", "google.com", "x.com", "linkedin.com", "facebook.com"}
	batch := 0
	for _, x := range list {
		n := 5 + rnd.Intn(40)
		for i := 0; i < n; i++ {
			at := time.Now().Add(-time.Duration(rnd.Intn(30*24)) * time.Hour)
			visitor := util.RandomHex(16)
			sess := util.RandomHex(8)
			c, d, b, ref := countries[rnd.Intn(len(countries))], devices[rnd.Intn(len(devices))], browsers[rnd.Intn(len(browsers))], refs[rnd.Intn(len(refs))]
			events := []string{"PAGE_VIEW", "PLAY"}
			for _, q := range []string{"25_PERCENT", "50_PERCENT", "75_PERCENT", "COMPLETE"} {
				if rnd.Float64() < 0.7 {
					events = append(events, q)
				} else {
					break
				}
			}
			for _, ev := range events {
				a.DB.Exec(ctx, `INSERT INTO analytics_events(tenant_id, domain, event_type, podcast_id, episode_id, path, referrer_host, country,
					device, browser, os, visitor_hash, session_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Other',$11,$12,$13)`,
					x.tid, x.domain, ev, x.pid, x.eid, "/podcast/"+x.ps+"/"+x.es, ref, c, d, b, visitor, sess, at)
				batch++
			}
		}
	}
	a.Log.Info("demo analytics generated", "events", batch)
}
