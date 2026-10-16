package app

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"podcast/api/internal/cache"
	"podcast/api/internal/util"
)

// ResolvedDomain is the cached result of hostname → tenant resolution (PRD §7).
type ResolvedDomain struct {
	TenantID      int64  `json:"tenant_id"`
	Domain        string `json:"domain"`
	IsPrimary     bool   `json:"is_primary"`
	PrimaryDomain string `json:"primary_domain"`
	RedirectTo    string `json:"redirect_to,omitempty"`
	ThemeKey      string `json:"theme_key"`
}

// ResolveHost maps a request hostname to its tenant. Returns nil when unknown or disabled.
func (a *App) ResolveHost(ctx context.Context, host string) (*ResolvedDomain, error) {
	host = util.NormalizeHost(host)
	if host == "" {
		return nil, nil
	}
	key := "domain:" + host
	var rd ResolvedDomain
	if a.Cache.GetJSON(ctx, key, &rd) {
		if rd.TenantID == 0 {
			return nil, nil
		}
		return &rd, nil
	}
	var redirect bool
	err := a.DB.QueryRow(ctx, `
		SELECT d.tenant_id, d.domain, d.is_primary, d.redirect_to_primary, th.key,
		       COALESCE((SELECT x.domain FROM domains x WHERE x.tenant_id=d.tenant_id AND x.is_primary AND x.status='ACTIVE' LIMIT 1), d.domain)
		  FROM domains d JOIN tenants t ON t.id=d.tenant_id JOIN themes th ON th.id=t.theme_id
		 WHERE d.domain=$1 AND d.status='ACTIVE' AND t.status='ACTIVE'`, host).
		Scan(&rd.TenantID, &rd.Domain, &rd.IsPrimary, &redirect, &rd.ThemeKey, &rd.PrimaryDomain)
	if err == pgx.ErrNoRows {
		a.Cache.SetJSON(ctx, key, ResolvedDomain{}, time.Minute) // negative cache
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if redirect && !rd.IsPrimary && rd.PrimaryDomain != rd.Domain {
		rd.RedirectTo = rd.PrimaryDomain
	}
	a.Cache.SetJSON(ctx, key, rd, 10*time.Minute)
	return &rd, nil
}

// Site is the public configuration a tenant website renders with.
type Site struct {
	Tenant struct {
		ID          int64  `json:"id"`
		Name        string `json:"name"`
		Slug        string `json:"slug"`
		Language    string `json:"language"`
		Timezone    string `json:"timezone"`
		ContentMode string `json:"content_mode"`
	} `json:"tenant"`
	Theme struct {
		Key    string `json:"key"`
		Number int    `json:"number"`
		Name   string `json:"name"`
	} `json:"theme"`
	ThemeConfig      map[string]any    `json:"theme_config"`
	Branding         Branding          `json:"branding"`
	SEO              SEOSettings       `json:"seo"`
	Navigation       []NavItem         `json:"navigation"`
	HomepageSections []HomepageSection `json:"homepage_sections"`
	AboutContent     string            `json:"about_content"`
	PrimaryDomain    string            `json:"primary_domain"`
	BaseURL          string            `json:"base_url"`
}

// LoadSite builds the full public site configuration for a tenant (cached).
func (a *App) LoadSite(ctx context.Context, tenantID int64) (*Site, error) {
	return cache.Remember(ctx, a.Cache, tenantPrefix(tenantID)+"site", 10*time.Minute, func() (*Site, error) {
		s := &Site{}
		var themeDefaults map[string]any
		err := a.DB.QueryRow(ctx, `SELECT t.id, t.name, t.slug, t.language, t.timezone, t.content_mode,
			th.key, th.number, th.name, th.default_config
			FROM tenants t JOIN themes th ON th.id=t.theme_id WHERE t.id=$1`, tenantID).
			Scan(&s.Tenant.ID, &s.Tenant.Name, &s.Tenant.Slug, &s.Tenant.Language, &s.Tenant.Timezone,
				&s.Tenant.ContentMode, &s.Theme.Key, &s.Theme.Number, &s.Theme.Name, &themeDefaults)
		if err != nil {
			return nil, err
		}
		st, err := a.TenantSettings(ctx, tenantID)
		if err != nil {
			return nil, err
		}
		seo, err := a.SEOSettings(ctx, tenantID)
		if err != nil {
			return nil, err
		}
		s.Branding = st.Branding
		s.SEO = *seo
		s.AboutContent = st.AboutContent
		for _, n := range st.Navigation {
			if n.Enabled {
				s.Navigation = append(s.Navigation, n)
			}
		}
		s.HomepageSections = st.HomepageSections
		s.ThemeConfig = MergeThemeConfig(themeDefaults, st.Branding, st.ThemeConfig)
		s.ThemeConfig["theme"] = s.Theme.Key
		s.PrimaryDomain = a.primaryDomain(ctx, tenantID)
		s.BaseURL = a.SiteBaseURL(ctx, tenantID)
		if s.SEO.SiteTitle == "" {
			s.SEO.SiteTitle = s.Tenant.Name
		}
		return s, nil
	})
}

func (a *App) primaryDomain(ctx context.Context, tenantID int64) string {
	var d string
	a.DB.QueryRow(ctx, `SELECT COALESCE((SELECT domain FROM domains WHERE tenant_id=$1 AND is_primary LIMIT 1),
		(SELECT domain FROM domains WHERE tenant_id=$1 ORDER BY id LIMIT 1), '')`, tenantID).Scan(&d)
	return d
}

// MergeThemeConfig layers theme defaults ← branding ← explicit tenant overrides (PRD §51, §52).
func MergeThemeConfig(defaults map[string]any, b Branding, overrides map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range defaults {
		out[k] = v
	}
	set := func(k, v string) {
		if v != "" {
			out[k] = v
		}
	}
	set("primary", b.PrimaryColor)
	set("secondary", b.SecondaryColor)
	set("accent", b.AccentColor)
	set("fontHeading", b.HeadingFont)
	set("fontBody", b.BodyFont)
	for k, v := range overrides {
		if s, ok := v.(string); ok && s == "" {
			continue
		}
		out[k] = v
	}
	return out
}

func (a *App) TenantSettings(ctx context.Context, tenantID int64) (*TenantSettings, error) {
	rows, err := a.DB.Query(ctx, `SELECT tenant_id, branding, theme_config, homepage_sections, navigation, about_content, updated_at
		FROM tenant_settings WHERE tenant_id=$1`, tenantID)
	if err != nil {
		return nil, err
	}
	st, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[TenantSettings])
	if err == pgx.ErrNoRows {
		return &TenantSettings{TenantID: tenantID, ThemeConfig: map[string]any{}}, nil
	}
	if st != nil && st.ThemeConfig == nil {
		st.ThemeConfig = map[string]any{}
	}
	return st, err
}

func (a *App) SEOSettings(ctx context.Context, tenantID int64) (*SEOSettings, error) {
	rows, err := a.DB.Query(ctx, `SELECT tenant_id, site_title, title_template, meta_description, default_og_image,
		twitter_card, twitter_handle, organization_name, organization_logo, canonical_domain, index_policy,
		robots_extra, updated_at FROM seo_settings WHERE tenant_id=$1`, tenantID)
	if err != nil {
		return nil, err
	}
	s, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[SEOSettings])
	if err == pgx.ErrNoRows {
		return &SEOSettings{TenantID: tenantID, TitleTemplate: "%s | {site_name}", TwitterCard: "summary_large_image", IndexPolicy: "index"}, nil
	}
	return s, err
}

// DefaultHomepageSections is the section configuration new tenants start with (PRD §53).
func DefaultHomepageSections() []HomepageSection {
	return []HomepageSection{
		{Type: "hero", Enabled: true, Title: ""},
		{Type: "featured", Enabled: true, Title: "Featured Podcasts", Limit: 8},
		{Type: "trending", Enabled: true, Title: "Trending", Limit: 10},
		{Type: "latest_episodes", Enabled: true, Title: "Latest Episodes", Limit: 8},
		{Type: "popular", Enabled: true, Title: "Popular Shows", Limit: 10},
		{Type: "editors_picks", Enabled: true, Title: "Editor's Picks", Limit: 6},
		{Type: "categories", Enabled: true, Title: "Categories", Limit: 12},
		{Type: "new_podcasts", Enabled: true, Title: "New Podcasts", Limit: 8},
		{Type: "collections", Enabled: false, Title: "Collections", Limit: 6},
		{Type: "newsletter", Enabled: false, Title: "Get new episodes in your inbox", ButtonLabel: "Subscribe"},
		{Type: "cta", Enabled: true, Title: "Never miss an episode", Subtitle: "Follow your favourite shows on any podcast app.", ButtonLabel: "Browse podcasts", ButtonHref: "/podcasts"},
	}
}

// DefaultNavigation is the menu new tenants start with (PRD §54).
func DefaultNavigation() []NavItem {
	return []NavItem{
		{Label: "Home", Type: "home", Href: "/", Enabled: true},
		{Label: "Podcasts", Type: "podcasts", Href: "/podcasts", Enabled: true},
		{Label: "Episodes", Type: "episodes", Href: "/episodes", Enabled: true},
		{Label: "Categories", Type: "categories", Href: "/categories", Enabled: true},
		{Label: "Hosts", Type: "hosts", Href: "/hosts", Enabled: true},
		{Label: "About", Type: "about", Href: "/about", Enabled: true},
	}
}

// CreateTenantInput describes the tenant creation wizard (PRD §9).
type CreateTenantInput struct {
	Name           string         `json:"name"`
	Slug           string         `json:"slug"`
	Domain         string         `json:"domain"`
	ThemeKey       string         `json:"theme"`
	ThemeID        int            `json:"theme_id"`
	LogoURL        string         `json:"logo_url"`
	PrimaryColor   string         `json:"primary_color"`
	SecondaryColor string         `json:"secondary_color"`
	AccentColor    string         `json:"accent_color"`
	Language       string         `json:"language"`
	Timezone       string         `json:"timezone"`
	ContentMode    string         `json:"content_mode"`
	ThemeConfig    map[string]any `json:"theme_config"`
}

// CreateTenant creates a tenant with settings, SEO defaults and (optionally) its first domain.
func (a *App) CreateTenant(ctx context.Context, in CreateTenantInput) (int64, error) {
	if in.Slug == "" {
		in.Slug = util.Slugify(in.Name)
	}
	if in.Language == "" {
		in.Language = "en"
	}
	if in.Timezone == "" {
		in.Timezone = "UTC"
	}
	if _, err := time.LoadLocation(in.Timezone); err != nil {
		return 0, fmt.Errorf("invalid timezone %q", in.Timezone)
	}
	if in.ContentMode == "" {
		in.ContentMode = ModeIndependent
	}
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	themeID := in.ThemeID
	if themeID == 0 {
		key := in.ThemeKey
		if key == "" {
			key = "stream"
		}
		if err := tx.QueryRow(ctx, `SELECT id FROM themes WHERE key=$1 OR name=$1 OR number::text=$1`, key).Scan(&themeID); err != nil {
			return 0, fmt.Errorf("unknown theme %q", key)
		}
	}
	var id int64
	if err := tx.QueryRow(ctx, `INSERT INTO tenants(name, slug, theme_id, content_mode, language, timezone)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, in.Name, in.Slug, themeID, in.ContentMode, in.Language, in.Timezone).Scan(&id); err != nil {
		return 0, err
	}
	branding := Branding{LogoURL: in.LogoURL, PrimaryColor: in.PrimaryColor, SecondaryColor: in.SecondaryColor,
		AccentColor: in.AccentColor, SocialLinks: map[string]string{},
		FooterText: fmt.Sprintf("© %d %s. All rights reserved.", time.Now().Year(), in.Name)}
	bj, _ := json.Marshal(branding)
	tc := in.ThemeConfig
	if tc == nil {
		tc = map[string]any{}
	}
	tcj, _ := json.Marshal(tc)
	sj, _ := json.Marshal(DefaultHomepageSections())
	nj, _ := json.Marshal(DefaultNavigation())
	if _, err := tx.Exec(ctx, `INSERT INTO tenant_settings(tenant_id, branding, theme_config, homepage_sections, navigation, about_content)
		VALUES ($1,$2,$3,$4,$5,$6)`, id, bj, tcj, sj, nj, fmt.Sprintf("%s is a podcast network.", in.Name)); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO seo_settings(tenant_id, site_title, title_template, meta_description, organization_name, organization_logo)
		VALUES ($1,$2,$3,$4,$5,$6)`, id, in.Name, "%s | "+in.Name, "Listen to the best podcasts on "+in.Name+".", in.Name, in.LogoURL); err != nil {
		return 0, err
	}
	if in.Domain != "" {
		if err := a.insertDomain(ctx, tx, id, in.Domain, true); err != nil {
			return 0, err
		}
	}
	return id, tx.Commit(ctx)
}

func (a *App) insertDomain(ctx context.Context, tx pgx.Tx, tenantID int64, domain string, primary bool) error {
	d := util.NormalizeHost(domain)
	if !util.ValidDomain(d) {
		return fmt.Errorf("invalid domain %q", domain)
	}
	verification, ssl, dns := "PENDING", "PENDING", "PENDING"
	var verifiedAt *time.Time
	if a.Cfg.DevAutoVerifyLocalHosts && IsLocalHost(d) {
		now := time.Now()
		verification, ssl, dns, verifiedAt = "VERIFIED", "NONE", "OK", &now
	}
	_, err := tx.Exec(ctx, `INSERT INTO domains(tenant_id, domain, is_primary, verification_token, verification_status, ssl_status, dns_status, verified_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, tenantID, d, primary, "pv-"+util.RandomHex(16), verification, ssl, dns, verifiedAt)
	return err
}

// AddDomain attaches a domain to a tenant (PRD §8).
func (a *App) AddDomain(ctx context.Context, tenantID int64, domain string, primary, redirect bool) (int64, error) {
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	var count int
	tx.QueryRow(ctx, `SELECT count(*) FROM domains WHERE tenant_id=$1`, tenantID).Scan(&count)
	if count == 0 {
		primary = true
	}
	if primary {
		if _, err := tx.Exec(ctx, `UPDATE domains SET is_primary=false WHERE tenant_id=$1`, tenantID); err != nil {
			return 0, err
		}
	}
	if err := a.insertDomain(ctx, tx, tenantID, domain, primary); err != nil {
		return 0, err
	}
	var id int64
	tx.QueryRow(ctx, `SELECT id FROM domains WHERE domain=$1`, util.NormalizeHost(domain)).Scan(&id)
	if redirect {
		tx.Exec(ctx, `UPDATE domains SET redirect_to_primary=true WHERE id=$1`, id)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	a.InvalidateDomains(ctx, tenantID)
	return id, nil
}
