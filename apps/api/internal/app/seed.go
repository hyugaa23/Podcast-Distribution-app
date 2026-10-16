package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"podcast/api/internal/authn"
	"podcast/api/internal/util"
)

// ThemeSeed defines the 10 built-in themes (PRD §41–51).
type ThemeSeed struct {
	Key, Name, Description string
	Number                 int
	Config                 map[string]any
}

var Themes = []ThemeSeed{
	{"stream", "Stream Dark", "Modern streaming experience: dark UI, large artwork, horizontal rows, persistent bottom player.", 1,
		map[string]any{"mode": "dark", "primary": "#1ED6A0", "secondary": "#121218", "accent": "#7C5CFF", "background": "#0A0A0D", "surface": "#16161D", "text": "#F4F4F6", "muted": "#9A9AA6", "fontHeading": "Inter", "fontBody": "Inter", "radius": "10px", "playerStyle": "bar"}},
	{"editorial", "Clean Editorial", "White background, large typography, editorial layout, minimal cards for premium publishing.", 2,
		map[string]any{"mode": "light", "primary": "#C2410C", "secondary": "#1C1917", "accent": "#C2410C", "background": "#FFFFFF", "surface": "#F7F5F2", "text": "#1C1917", "muted": "#6B6460", "fontHeading": "Playfair Display", "fontBody": "Source Serif 4", "radius": "2px", "playerStyle": "inline"}},
	{"news", "Newsroom", "News-portal layout with dense information, trending, top stories and multiple columns.", 3,
		map[string]any{"mode": "light", "primary": "#B91C1C", "secondary": "#111111", "accent": "#1D4ED8", "background": "#FFFFFF", "surface": "#F3F4F6", "text": "#111111", "muted": "#5B5B5B", "fontHeading": "Roboto Condensed", "fontBody": "Roboto", "radius": "0px", "playerStyle": "ticker"}},
	{"minimal", "Minimal", "Extreme whitespace, simple typography, minimal navigation, large artwork, few distractions.", 4,
		map[string]any{"mode": "light", "primary": "#111111", "secondary": "#FAFAFA", "accent": "#111111", "background": "#FAFAFA", "surface": "#FFFFFF", "text": "#111111", "muted": "#8A8A8A", "fontHeading": "DM Sans", "fontBody": "DM Sans", "radius": "999px", "playerStyle": "minimal"}},
	{"creator", "Creator", "Host-focused personal brand layout with large creator photography, social links and featured show.", 5,
		map[string]any{"mode": "light", "primary": "#F97316", "secondary": "#1F2937", "accent": "#FB7185", "background": "#FFF8F1", "surface": "#FFFFFF", "text": "#1F2937", "muted": "#6B7280", "fontHeading": "Poppins", "fontBody": "Poppins", "radius": "24px", "playerStyle": "floating"}},
	{"radio", "Radio", "Radio-station feeling: Now Playing, large player, schedule-style sections, bold typography.", 6,
		map[string]any{"mode": "dark", "primary": "#FACC15", "secondary": "#0F172A", "accent": "#EF4444", "background": "#0B1120", "surface": "#162036", "text": "#F8FAFC", "muted": "#94A3B8", "fontHeading": "Bebas Neue", "fontBody": "Barlow", "radius": "6px", "playerStyle": "large"}},
	{"tech", "Tech", "Modern dark/light hybrid with gradient accents, technical typography and compact cards.", 7,
		map[string]any{"mode": "hybrid", "primary": "#6366F1", "secondary": "#06B6D4", "accent": "#22D3EE", "background": "#F8FAFC", "surface": "#FFFFFF", "text": "#0F172A", "muted": "#64748B", "fontHeading": "Space Grotesk", "fontBody": "Inter", "fontMono": "JetBrains Mono", "radius": "8px", "playerStyle": "dock"}},
	{"business", "Business", "Professional, clean corporate typography with blue/neutral defaults and featured industry topics.", 8,
		map[string]any{"mode": "light", "primary": "#1457FF", "secondary": "#111827", "accent": "#0EA5E9", "background": "#FFFFFF", "surface": "#F5F7FB", "text": "#111827", "muted": "#6B7280", "fontHeading": "Inter", "fontBody": "Inter", "radius": "8px", "playerStyle": "floating"}},
	{"entertainment", "Entertainment", "Bold, colourful, large imagery, trending-first with high visual energy.", 9,
		map[string]any{"mode": "dark", "primary": "#FF3D8B", "secondary": "#7C3AED", "accent": "#FFD600", "background": "#14051F", "surface": "#24103A", "text": "#FFFFFF", "muted": "#C4B5FD", "fontHeading": "Archivo Black", "fontBody": "Nunito", "radius": "20px", "playerStyle": "pill"}},
	{"magazine", "Premium Magazine", "Magazine layout, editorial typography, large hero, featured stories and curated collections.", 10,
		map[string]any{"mode": "light", "primary": "#9A7B4F", "secondary": "#1A1A1A", "accent": "#9A7B4F", "background": "#F7F3EC", "surface": "#FFFFFF", "text": "#1A1A1A", "muted": "#6F6A61", "fontHeading": "Cormorant Garamond", "fontBody": "Lora", "radius": "0px", "playerStyle": "elegant"}},
}

type catSeed struct {
	Name, ITunes string
	Subs         []string
}

var categorySeeds = []catSeed{
	{"Business", "Business", []string{"Marketing", "Investing", "Entrepreneurship", "Management", "Careers"}},
	{"Technology", "Technology", nil},
	{"News", "News", []string{"Daily News", "Politics", "Tech News", "Business News"}},
	{"Education", "Education", []string{"How To", "Language Learning", "Self-Improvement", "Courses"}},
	{"Health", "Health & Fitness", []string{"Fitness", "Nutrition", "Mental Health", "Medicine"}},
	{"Sports", "Sports", []string{"Football", "Basketball", "Soccer", "Running"}},
	{"Comedy", "Comedy", []string{"Comedy Interviews", "Improv", "Stand-Up"}},
	{"Society", "Society & Culture", []string{"Documentary", "Personal Journals", "Relationships", "Philosophy"}},
	{"Science", "Science", []string{"Physics", "Nature", "Astronomy", "Social Sciences"}},
	{"True Crime", "True Crime", nil},
	{"Arts", "Arts", []string{"Design", "Books", "Food", "Visual Arts"}},
	{"Music", "Music", []string{"Music Commentary", "Music History", "Music Interviews"}},
	{"History", "History", nil},
	{"Kids & Family", "Kids & Family", []string{"Parenting", "Education for Kids"}},
	{"Leisure", "Leisure", []string{"Games", "Hobbies", "Automotive", "Home & Garden"}},
	{"TV & Film", "TV & Film", []string{"Film Reviews", "TV Reviews"}},
	{"Religion & Spirituality", "Religion & Spirituality", nil},
	{"Fiction", "Fiction", []string{"Drama", "Science Fiction"}},
	{"Government", "Government", nil},
}

// Default distribution platform registry (PRD §21). Stored in the database, never hard-coded in UI (PRD §115).
var platformSeeds = []Platform{
	{Key: "spotify", Name: "Spotify", WebsiteURL: "https://open.spotify.com", SubmitURL: "https://creators.spotify.com", Color: "#1DB954", URLPattern: "https://open.spotify.com/show/{id}", Instructions: "Sign in to Spotify for Creators, choose 'Add an existing podcast', paste the RSS feed URL and verify ownership via the owner email code."},
	{Key: "apple-podcasts", Name: "Apple Podcasts", WebsiteURL: "https://podcasts.apple.com", SubmitURL: "https://podcastsconnect.apple.com", Color: "#9933CC", URLPattern: "https://podcasts.apple.com/podcast/id{id}", Instructions: "In Apple Podcasts Connect, add a show with 'Add a show with an RSS feed' and submit for review. Artwork must be 1400–3000 px square."},
	{Key: "youtube-music", Name: "YouTube Music", WebsiteURL: "https://music.youtube.com", SubmitURL: "https://studio.youtube.com", Color: "#FF0000", URLPattern: "https://music.youtube.com/playlist?list={id}", Instructions: "In YouTube Studio go to Create → New podcast → Submit RSS feed."},
	{Key: "amazon-music", Name: "Amazon Music", WebsiteURL: "https://music.amazon.com/podcasts", SubmitURL: "https://podcasters.amazon.com", Color: "#25D1DA", URLPattern: "https://music.amazon.com/podcasts/{id}", Instructions: "Sign in to Amazon Music for Podcasters and add the RSS feed."},
	{Key: "pocket-casts", Name: "Pocket Casts", WebsiteURL: "https://pocketcasts.com", SubmitURL: "https://pocketcasts.com/submit/", Color: "#F43E37", URLPattern: "https://pca.st/{id}", Instructions: "Submit the RSS feed URL in the Pocket Casts submission form."},
	{Key: "podcast-index", Name: "Podcast Index", WebsiteURL: "https://podcastindex.org", SubmitURL: "https://podcastindex.org/add", Color: "#E9353B", URLPattern: "https://podcastindex.org/podcast/{id}", SubmissionType: "API", APIProvider: "podcastindex", Instructions: "Submitted automatically through the official Podcast Index API when credentials are configured; otherwise add the feed manually."},
	{Key: "iheartradio", Name: "iHeartRadio", WebsiteURL: "https://www.iheart.com/podcast/", SubmitURL: "https://www.iheart.com/content/submit-your-podcast/", Color: "#C6002B", URLPattern: "https://www.iheart.com/podcast/{id}/", Instructions: "Use the iHeartRadio podcast submission form with the RSS feed URL."},
	{Key: "tunein", Name: "TuneIn", WebsiteURL: "https://tunein.com/podcasts/", SubmitURL: "https://help.tunein.com/contact/add-podcast-S19TR3Sdf", Color: "#1C203C", URLPattern: "https://tunein.com/podcasts/{id}/", Instructions: "Submit the feed through TuneIn's 'Add a podcast' request form."},
	{Key: "castbox", Name: "Castbox", WebsiteURL: "https://castbox.fm", SubmitURL: "https://castbox.fm/creator/channels", Color: "#F55B23", URLPattern: "https://castbox.fm/channel/id{id}", Instructions: "Claim or add the show in Castbox Creator Studio using the RSS feed."},
	{Key: "player-fm", Name: "Player FM", WebsiteURL: "https://player.fm", SubmitURL: "https://player.fm/importer/feed", Color: "#C8122A", URLPattern: "https://player.fm/series/{id}", Instructions: "Paste the RSS feed into the Player FM feed importer."},
	{Key: "deezer", Name: "Deezer", WebsiteURL: "https://www.deezer.com", SubmitURL: "https://podcasters.deezer.com", Color: "#A238FF", URLPattern: "https://www.deezer.com/show/{id}", Instructions: "Add the RSS feed in Deezer for Podcasters."},
	{Key: "overcast", Name: "Overcast", WebsiteURL: "https://overcast.fm", SubmitURL: "https://overcast.fm/podcasterinfo", Color: "#FC7E0F", URLPattern: "https://overcast.fm/itunes{id}", Instructions: "Overcast lists shows from Apple Podcasts automatically; mark LIVE once the Apple listing is approved."},
	{Key: "goodpods", Name: "Goodpods", WebsiteURL: "https://goodpods.com", SubmitURL: "https://goodpods.com/podcasters", Color: "#7B4DFF", URLPattern: "https://goodpods.com/podcasts/{id}", Instructions: "Claim the podcast in Goodpods for Podcasters using the RSS feed."},
}

// Default system settings (PRD §99). Secrets come from the environment, never stored here.
var defaultSettings = map[string]any{
	"storage":          map[string]any{"max_audio_upload_mb": 500, "max_image_upload_mb": 10, "keep_original_audio": true, "warning_threshold_gb": 100},
	"cdn":              map[string]any{"audio_cache_ttl_seconds": 31536000, "image_cache_ttl_seconds": 31536000},
	"email":            map[string]any{"from_name": "Podcast Platform", "from_address": "", "enabled": false},
	"queue":            map[string]any{"worker_concurrency": 4, "max_attempts": 3},
	"analytics":        map[string]any{"retention_days": 395, "aggregate_interval_minutes": 5},
	"audio_processing": map[string]any{"bitrate_kbps": 128, "normalize": true, "allowed_formats": []string{"mp3", "m4a", "wav"}},
	"themes":           map[string]any{"allow_tenant_theme_switch": true},
	"domains":          map[string]any{"verification_method": "dns_txt_or_http", "auto_check_hours": 6},
	"security":         map[string]any{"public_rate_limit_per_minute": 240, "login_rate_limit_per_minute": 10, "api_rate_limit_per_minute": 600},
	"api":              map[string]any{"public_api_enabled": true},
	"cron":             map[string]any{"rss_sync_default_minutes": 60, "rss_health_hours": 6, "distribution_refresh_hours": 6, "domain_check_hours": 6},
}

// EnsureBaseData idempotently seeds themes, categories, platforms, settings and the first super admin.
func (a *App) EnsureBaseData(ctx context.Context) error {
	for _, t := range Themes {
		cfg, _ := json.Marshal(t.Config)
		if _, err := a.DB.Exec(ctx, `INSERT INTO themes(key, number, name, description, default_config) VALUES ($1,$2,$3,$4,$5)
			ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name, number=EXCLUDED.number, description=EXCLUDED.description,
			default_config=EXCLUDED.default_config`, t.Key, t.Number, t.Name, t.Description, cfg); err != nil {
			return fmt.Errorf("seed themes: %w", err)
		}
	}
	for i, c := range categorySeeds {
		var id int64
		if err := a.DB.QueryRow(ctx, `INSERT INTO categories(name, slug, itunes_name, sort_order) VALUES ($1,$2,$3,$4)
			ON CONFLICT (slug) DO UPDATE SET itunes_name=EXCLUDED.itunes_name RETURNING id`,
			c.Name, util.Slugify(c.Name), c.ITunes, i).Scan(&id); err != nil {
			return fmt.Errorf("seed categories: %w", err)
		}
		for j, s := range c.Subs {
			a.DB.Exec(ctx, `INSERT INTO categories(name, slug, itunes_name, parent_id, sort_order) VALUES ($1,$2,$1,$3,$4)
				ON CONFLICT (slug) DO NOTHING`, s, util.Slugify(s), id, j)
		}
	}
	for i, p := range platformSeeds {
		st := p.SubmissionType
		if st == "" {
			st = "MANUAL"
		}
		if _, err := a.DB.Exec(ctx, `INSERT INTO platforms(key, name, website_url, submit_url, color, url_pattern, instructions,
			submission_type, api_provider, is_default, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10)
			ON CONFLICT (key) DO NOTHING`, p.Key, p.Name, p.WebsiteURL, p.SubmitURL, p.Color, p.URLPattern, p.Instructions,
			st, p.APIProvider, i); err != nil {
			return fmt.Errorf("seed platforms: %w", err)
		}
	}
	for k, v := range defaultSettings {
		b, _ := json.Marshal(v)
		a.DB.Exec(ctx, `INSERT INTO system_settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING`, k, b)
	}

	var admins int
	a.DB.QueryRow(ctx, `SELECT count(*) FROM users WHERE role='SUPER_ADMIN'`).Scan(&admins)
	if admins == 0 {
		pw := a.Cfg.SeedAdminPassword
		if pw == "" {
			if a.Cfg.IsProduction() {
				return fmt.Errorf("SEED_ADMIN_PASSWORD must be set to create the first super admin")
			}
			pw = "ChangeMe123!"
		}
		hash, err := authn.HashPassword(pw)
		if err != nil {
			return err
		}
		if _, err := a.DB.Exec(ctx, `INSERT INTO users(email, password_hash, name, role) VALUES ($1,$2,'Super Admin','SUPER_ADMIN')`,
			strings.ToLower(strings.TrimSpace(a.Cfg.SeedAdminEmail)), hash); err != nil {
			return err
		}
		a.Log.Warn("created initial super admin — change the password after first login", "email", a.Cfg.SeedAdminEmail)
	}
	return nil
}
