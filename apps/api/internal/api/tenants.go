package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"podcast/api/internal/app"
	"podcast/api/internal/authn"
	"podcast/api/internal/queue"
	"podcast/api/internal/util"
)

func (s *Server) listThemes(w http.ResponseWriter, r *http.Request) {
	rows, err := s.App.DB.Query(r.Context(), `SELECT id, key, number, name, description, default_config, is_active FROM themes ORDER BY number`)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[app.Theme])
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeData(w, list)
}

func (s *Server) loadTenant(ctx context.Context, id int64) (*app.Tenant, error) {
	rows, err := s.App.DB.Query(ctx, app.TenantSelect+` WHERE t.id=$1`, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[app.Tenant])
}

func (s *Server) listTenants(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	q := app.TenantSelect
	var args []any
	if !p.IsSuper() {
		q += ` WHERE t.id=$1`
		args = append(args, p.Tenant())
	} else if search := strings.TrimSpace(r.URL.Query().Get("q")); search != "" {
		q += ` WHERE t.name ILIKE $1 OR t.slug ILIKE $1 OR EXISTS (SELECT 1 FROM domains d WHERE d.tenant_id=t.id AND d.domain ILIKE $1)`
		args = append(args, "%"+search+"%")
	}
	rows, err := s.App.DB.Query(r.Context(), q+` ORDER BY t.name`, args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[app.Tenant])
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if list == nil {
		list = []app.Tenant{}
	}
	writeData(w, list)
}

func validateTenantInput(in *app.CreateTenantInput) string {
	in.Name = util.PlainText(in.Name)
	if in.Name == "" {
		return "Site name is required"
	}
	if in.ContentMode != "" && in.ContentMode != app.ModeIndependent && in.ContentMode != app.ModeShared && in.ContentMode != app.ModeSyndicated {
		return "content_mode must be INDEPENDENT, SHARED or SYNDICATED"
	}
	for _, c := range []string{in.PrimaryColor, in.SecondaryColor, in.AccentColor} {
		if c != "" && !util.ValidColor(c) {
			return "Colors must be hex values like #1457FF"
		}
	}
	if in.Domain != "" && !util.ValidDomain(util.NormalizeHost(in.Domain)) {
		return "Invalid domain"
	}
	return ""
}

func (s *Server) createTenant(w http.ResponseWriter, r *http.Request) {
	var in app.CreateTenantInput
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if msg := validateTenantInput(&in); msg != "" {
		badRequest(w, msg)
		return
	}
	if in.Slug != "" {
		in.Slug = util.Slugify(in.Slug)
	}
	id, err := s.App.CreateTenant(r.Context(), in)
	if err != nil {
		if strings.Contains(err.Error(), "unknown theme") || strings.Contains(err.Error(), "invalid") {
			badRequest(w, err.Error())
			return
		}
		s.serverError(w, r, err)
		return
	}
	s.audit(r, "CREATED_TENANT", "tenant", id, &id, in)
	t, _ := s.loadTenant(r.Context(), id)
	writeJSON(w, http.StatusCreated, map[string]any{"data": t})
}

func (s *Server) getTenant(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	if !canAccessTenant(principal(r), id) {
		forbidden(w)
		return
	}
	t, err := s.loadTenant(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	var stats struct {
		Podcasts int `json:"podcasts"`
		Episodes int `json:"episodes"`
		Domains  int `json:"domains"`
		Users    int `json:"users"`
	}
	s.App.DB.QueryRow(r.Context(), `SELECT
		(SELECT count(*) FROM tenant_podcast_ids($1)),
		(SELECT count(*) FROM episodes WHERE podcast_id IN (SELECT podcast_id FROM tenant_podcast_ids($1))),
		(SELECT count(*) FROM domains WHERE tenant_id=$1),
		(SELECT count(*) FROM users WHERE tenant_id=$1)`, id).Scan(&stats.Podcasts, &stats.Episodes, &stats.Domains, &stats.Users)
	writeData(w, map[string]any{"tenant": t, "stats": stats})
}

func (s *Server) updateTenant(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	p := principal(r)
	if !canManageTenant(p, id) {
		forbidden(w)
		return
	}
	var in struct {
		Name        *string `json:"name"`
		ThemeKey    *string `json:"theme"`
		ThemeID     *int    `json:"theme_id"`
		ContentMode *string `json:"content_mode"`
		Language    *string `json:"language"`
		Timezone    *string `json:"timezone"`
		Status      *string `json:"status"`
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	// Tenant admins may change branding/theme but not status or content mode (system configuration).
	if !p.IsSuper() && (in.Status != nil || in.ContentMode != nil) {
		forbidden(w)
		return
	}
	if in.ThemeKey != nil && in.ThemeID == nil {
		var tid int
		if err := s.App.DB.QueryRow(r.Context(), `SELECT id FROM themes WHERE key=$1 OR number::text=$1`, *in.ThemeKey).Scan(&tid); err != nil {
			badRequest(w, "Unknown theme")
			return
		}
		in.ThemeID = &tid
	}
	if in.ContentMode != nil && *in.ContentMode != app.ModeIndependent && *in.ContentMode != app.ModeShared && *in.ContentMode != app.ModeSyndicated {
		badRequest(w, "Invalid content_mode")
		return
	}
	if in.Status != nil && *in.Status != "ACTIVE" && *in.Status != "DISABLED" {
		badRequest(w, "Invalid status")
		return
	}
	if in.Timezone != nil {
		if _, err := time.LoadLocation(*in.Timezone); err != nil {
			badRequest(w, "Invalid timezone")
			return
		}
	}
	if in.Name != nil {
		n := util.PlainText(*in.Name)
		if n == "" {
			badRequest(w, "Name is required")
			return
		}
		in.Name = &n
	}
	_, err := s.App.DB.Exec(r.Context(), `UPDATE tenants SET name=COALESCE($2,name), theme_id=COALESCE($3,theme_id),
		content_mode=COALESCE($4,content_mode), language=COALESCE($5,language), timezone=COALESCE($6,timezone),
		status=COALESCE($7,status), updated_at=now() WHERE id=$1`, id, in.Name, in.ThemeID, in.ContentMode, in.Language, in.Timezone, in.Status)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	s.App.InvalidateDomains(r.Context(), id)
	s.audit(r, "UPDATED_TENANT", "tenant", id, &id, in)
	t, _ := s.loadTenant(r.Context(), id)
	writeData(w, t)
}

func (s *Server) deleteTenant(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	s.App.InvalidateDomains(r.Context(), id)
	tag, err := s.App.DB.Exec(r.Context(), `DELETE FROM tenants WHERE id=$1`, id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 {
		notFound(w)
		return
	}
	s.audit(r, "DELETED_TENANT", "tenant", id, nil, nil)
	writeData(w, map[string]bool{"ok": true})
}

func (s *Server) getTenantSettings(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	if !canAccessTenant(principal(r), id) {
		forbidden(w)
		return
	}
	st, err := s.App.TenantSettings(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeData(w, st)
}

var sectionTypes = map[string]bool{"hero": true, "featured": true, "trending": true, "latest_episodes": true, "popular": true,
	"categories": true, "editors_picks": true, "new_podcasts": true, "collections": true, "newsletter": true, "cta": true}
var navTypes = map[string]bool{"home": true, "podcasts": true, "episodes": true, "categories": true, "hosts": true,
	"collections": true, "about": true, "search": true, "custom": true}

// updateTenantSettings saves branding, theme config, homepage sections and navigation (PRD §51–54).
func (s *Server) updateTenantSettings(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	if !canManageTenant(principal(r), id) {
		forbidden(w)
		return
	}
	var in struct {
		Branding         *app.Branding          `json:"branding"`
		ThemeConfig      map[string]any         `json:"theme_config"`
		HomepageSections *[]app.HomepageSection `json:"homepage_sections"`
		Navigation       *[]app.NavItem         `json:"navigation"`
		AboutContent     *string                `json:"about_content"`
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	cur, err := s.App.TenantSettings(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if in.Branding != nil {
		b := *in.Branding
		for _, c := range []string{b.PrimaryColor, b.SecondaryColor, b.AccentColor} {
			if c != "" && !util.ValidColor(c) {
				badRequest(w, "Colors must be hex values like #1457FF")
				return
			}
		}
		for _, u := range []string{b.LogoURL, b.FaviconURL, b.DefaultCoverURL} {
			if u != "" && !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") && !strings.HasPrefix(u, "/") {
				badRequest(w, "Image URLs must be absolute")
				return
			}
		}
		b.FooterText = util.PlainText(b.FooterText)
		b.Tagline = util.PlainText(b.Tagline)
		b.HeadingFont = util.PlainText(b.HeadingFont)
		b.BodyFont = util.PlainText(b.BodyFont)
		clean := map[string]string{}
		for k, v := range b.SocialLinks {
			if v == "" {
				continue
			}
			if _, err := util.ValidateFetchURL(v); err != nil {
				badRequest(w, "Social link for "+k+" must be a URL")
				return
			}
			clean[util.PlainText(k)] = v
		}
		b.SocialLinks = clean
		cur.Branding = b
	}
	if in.ThemeConfig != nil {
		clean := map[string]any{}
		for k, v := range in.ThemeConfig {
			if str, ok := v.(string); ok {
				clean[k] = util.PlainText(str)
			} else {
				clean[k] = v
			}
		}
		cur.ThemeConfig = clean
	}
	if in.HomepageSections != nil {
		seen := map[string]bool{}
		for i, sec := range *in.HomepageSections {
			if !sectionTypes[sec.Type] {
				badRequest(w, "Unknown homepage section "+sec.Type)
				return
			}
			key := sec.Type
			if sec.Type == "collections" && sec.CollectionID > 0 {
				key += itoa(int(sec.CollectionID))
			}
			if seen[key] {
				badRequest(w, "Duplicate homepage section "+sec.Type)
				return
			}
			seen[key] = true
			(*in.HomepageSections)[i].Title = util.PlainText(sec.Title)
			(*in.HomepageSections)[i].Subtitle = util.PlainText(sec.Subtitle)
		}
		cur.HomepageSections = *in.HomepageSections
	}
	if in.Navigation != nil {
		for i, n := range *in.Navigation {
			if !navTypes[n.Type] {
				badRequest(w, "Unknown navigation type "+n.Type)
				return
			}
			if strings.TrimSpace(n.Label) == "" || n.Href == "" {
				badRequest(w, "Navigation items need a label and link")
				return
			}
			if strings.HasPrefix(strings.ToLower(strings.TrimSpace(n.Href)), "javascript:") {
				badRequest(w, "Invalid navigation link")
				return
			}
			(*in.Navigation)[i].Label = util.PlainText(n.Label)
			(*in.Navigation)[i].External = strings.HasPrefix(n.Href, "http")
		}
		cur.Navigation = *in.Navigation
	}
	if in.AboutContent != nil {
		cur.AboutContent = util.SanitizeHTML(*in.AboutContent)
	}
	bj, _ := json.Marshal(cur.Branding)
	tj, _ := json.Marshal(cur.ThemeConfig)
	sj, _ := json.Marshal(cur.HomepageSections)
	nj, _ := json.Marshal(cur.Navigation)
	_, err = s.App.DB.Exec(r.Context(), `INSERT INTO tenant_settings(tenant_id, branding, theme_config, homepage_sections, navigation, about_content)
		VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id) DO UPDATE SET branding=$2, theme_config=$3, homepage_sections=$4,
		navigation=$5, about_content=$6, updated_at=now()`, id, bj, tj, sj, nj, cur.AboutContent)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	s.App.InvalidateTenant(r.Context(), id)
	s.audit(r, "UPDATED_TENANT_SETTINGS", "tenant", id, &id, in)
	st, _ := s.App.TenantSettings(r.Context(), id)
	writeData(w, st)
}

func (s *Server) getSEO(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	if !canAccessTenant(principal(r), id) {
		forbidden(w)
		return
	}
	seo, err := s.App.SEOSettings(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeData(w, seo)
}

// updateSEO saves tenant SEO configuration (PRD §33, §37).
func (s *Server) updateSEO(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	if !canManageTenant(principal(r), id) {
		forbidden(w)
		return
	}
	var in app.SEOSettings
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if in.IndexPolicy == "" {
		in.IndexPolicy = "index"
	}
	if in.IndexPolicy != "index" && in.IndexPolicy != "noindex" {
		badRequest(w, "index_policy must be index or noindex")
		return
	}
	if in.TwitterCard == "" {
		in.TwitterCard = "summary_large_image"
	}
	if in.TwitterCard != "summary" && in.TwitterCard != "summary_large_image" {
		badRequest(w, "twitter_card must be summary or summary_large_image")
		return
	}
	if in.TitleTemplate == "" {
		in.TitleTemplate = "%s | {site_name}"
	}
	if !strings.Contains(in.TitleTemplate, "%s") {
		badRequest(w, "Title template must contain %s for the page title")
		return
	}
	in.CanonicalDomain = util.NormalizeHost(strings.TrimPrefix(strings.TrimPrefix(in.CanonicalDomain, "https://"), "http://"))
	if in.CanonicalDomain != "" && !util.ValidDomain(in.CanonicalDomain) {
		badRequest(w, "Invalid canonical domain")
		return
	}
	// Robots extras are plain directives; strip anything that is not a recognised robots line.
	var robots []string
	for _, line := range strings.Split(in.RobotsExtra, "\n") {
		l := strings.TrimSpace(line)
		low := strings.ToLower(l)
		if l == "" || strings.HasPrefix(low, "user-agent:") || strings.HasPrefix(low, "disallow:") || strings.HasPrefix(low, "allow:") ||
			strings.HasPrefix(low, "crawl-delay:") || strings.HasPrefix(low, "sitemap:") || strings.HasPrefix(low, "#") {
			robots = append(robots, l)
		}
	}
	_, err := s.App.DB.Exec(r.Context(), `INSERT INTO seo_settings(tenant_id, site_title, title_template, meta_description, default_og_image,
		twitter_card, twitter_handle, organization_name, organization_logo, canonical_domain, index_policy, robots_extra)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (tenant_id) DO UPDATE SET site_title=$2, title_template=$3, meta_description=$4, default_og_image=$5,
		twitter_card=$6, twitter_handle=$7, organization_name=$8, organization_logo=$9, canonical_domain=$10, index_policy=$11,
		robots_extra=$12, updated_at=now()`,
		id, util.PlainText(in.SiteTitle), util.PlainText(in.TitleTemplate), util.PlainText(in.MetaDescription), in.DefaultOGImage,
		in.TwitterCard, util.PlainText(in.TwitterHandle), util.PlainText(in.OrganizationName), in.OrganizationLogo,
		in.CanonicalDomain, in.IndexPolicy, strings.Join(robots, "\n"))
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	s.App.InvalidateTenant(r.Context(), id)
	s.App.Enqueue(r.Context(), queue.GenerateSitemap, map[string]any{"tenant_id": id}, queue.Options{})
	s.audit(r, "UPDATED_SEO", "tenant", id, &id, in)
	seo, _ := s.App.SEOSettings(r.Context(), id)
	writeData(w, seo)
}

// tenantPodcasts lists podcasts visible on a tenant with per-tenant overrides.
func (s *Server) tenantPodcasts(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	if !canAccessTenant(principal(r), id) {
		forbidden(w)
		return
	}
	rows, err := s.App.DB.Query(r.Context(), `SELECT p.id, p.title, p.slug, p.status, p.artwork_url, p.owner_tenant_id,
		COALESCE(tp.is_featured,false), COALESCE(tp.is_editors_pick,false), COALESCE(tp.hidden,false),
		COALESCE(tp.seo_title,''), COALESCE(tp.meta_description,''), COALESCE(tp.featured_image_url,''),
		tp.category_id, COALESCE(tp.canonical_mode,'SELF'), COALESCE(tp.sort_order,0), tp.podcast_id IS NOT NULL
		FROM podcasts p LEFT JOIN tenant_podcasts tp ON tp.podcast_id=p.id AND tp.tenant_id=$1
		WHERE p.id IN (SELECT podcast_id FROM tenant_podcast_ids($1)) OR tp.podcast_id IS NOT NULL
		ORDER BY COALESCE(tp.sort_order,0), p.title`, id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer rows.Close()
	type item struct {
		PodcastID        int64  `json:"podcast_id"`
		Title            string `json:"title"`
		Slug             string `json:"slug"`
		Status           string `json:"status"`
		ArtworkURL       string `json:"artwork_url"`
		OwnerTenantID    *int64 `json:"owner_tenant_id"`
		IsFeatured       bool   `json:"is_featured"`
		IsEditorsPick    bool   `json:"is_editors_pick"`
		Hidden           bool   `json:"hidden"`
		SEOTitle         string `json:"seo_title"`
		MetaDescription  string `json:"meta_description"`
		FeaturedImageURL string `json:"featured_image_url"`
		CategoryID       *int64 `json:"category_id"`
		CanonicalMode    string `json:"canonical_mode"`
		SortOrder        int    `json:"sort_order"`
		Linked           bool   `json:"linked"`
	}
	out := []item{}
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.PodcastID, &it.Title, &it.Slug, &it.Status, &it.ArtworkURL, &it.OwnerTenantID, &it.IsFeatured,
			&it.IsEditorsPick, &it.Hidden, &it.SEOTitle, &it.MetaDescription, &it.FeaturedImageURL, &it.CategoryID,
			&it.CanonicalMode, &it.SortOrder, &it.Linked); err != nil {
			s.serverError(w, r, err)
			return
		}
		out = append(out, it)
	}
	writeData(w, out)
}

// ---------------------------------------------------------------------------
// Domains (PRD §8)

func (s *Server) listDomains(w http.ResponseWriter, r *http.Request) {
	q := app.DomainSelect
	var args []any
	if tid := scopeTenant(r); tid != 0 {
		q += ` WHERE d.tenant_id=$1`
		args = append(args, tid)
	}
	rows, err := s.App.DB.Query(r.Context(), q+` ORDER BY t.name, d.is_primary DESC, d.domain`, args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[app.Domain])
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if list == nil {
		list = []app.Domain{}
	}
	writeData(w, list)
}

func (s *Server) loadDomain(ctx context.Context, id int64) (*app.Domain, error) {
	rows, err := s.App.DB.Query(ctx, app.DomainSelect+` WHERE d.id=$1`, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[app.Domain])
}

func (s *Server) createDomain(w http.ResponseWriter, r *http.Request) {
	var in struct {
		TenantID          int64  `json:"tenant_id"`
		Domain            string `json:"domain"`
		IsPrimary         bool   `json:"is_primary"`
		RedirectToPrimary bool   `json:"redirect_to_primary"`
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	d := util.NormalizeHost(strings.TrimPrefix(strings.TrimPrefix(in.Domain, "https://"), "http://"))
	if !util.ValidDomain(d) {
		badRequest(w, "Invalid domain. Use formats like podcast.com, www.podcast.com or sub.example.com")
		return
	}
	if _, err := s.loadTenant(r.Context(), in.TenantID); err != nil {
		badRequest(w, "Unknown tenant")
		return
	}
	id, err := s.App.AddDomain(r.Context(), in.TenantID, d, in.IsPrimary, in.RedirectToPrimary)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !app.IsLocalHost(d) {
		s.App.Enqueue(r.Context(), queue.CheckDomain, map[string]any{"domain_id": id}, queue.Options{Delay: 5 * time.Second})
	}
	s.App.Cache.Del(r.Context(), "domain:"+d)
	s.audit(r, "ADDED_DOMAIN", "domain", id, &in.TenantID, map[string]any{"domain": d})
	dom, _ := s.loadDomain(r.Context(), id)
	writeJSON(w, http.StatusCreated, map[string]any{"data": dom})
}

func (s *Server) updateDomain(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	dom, err := s.loadDomain(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	var in struct {
		TenantID           *int64  `json:"tenant_id"`
		IsPrimary          *bool   `json:"is_primary"`
		RedirectToPrimary  *bool   `json:"redirect_to_primary"`
		Status             *string `json:"status"`
		VerificationStatus *string `json:"verification_status"` // manual override by super admin
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if in.Status != nil && *in.Status != "ACTIVE" && *in.Status != "DISABLED" {
		badRequest(w, "Invalid status")
		return
	}
	if in.VerificationStatus != nil && *in.VerificationStatus != "VERIFIED" && *in.VerificationStatus != "PENDING" && *in.VerificationStatus != "FAILED" {
		badRequest(w, "Invalid verification status")
		return
	}
	tx, err := s.App.DB.Begin(r.Context())
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	tenantID := dom.TenantID
	if in.TenantID != nil && *in.TenantID != dom.TenantID {
		tenantID = *in.TenantID
		tx.Exec(r.Context(), `UPDATE domains SET tenant_id=$2, is_primary=false WHERE id=$1`, id, tenantID)
	}
	if in.IsPrimary != nil && *in.IsPrimary {
		tx.Exec(r.Context(), `UPDATE domains SET is_primary=false WHERE tenant_id=$1`, tenantID)
	}
	_, err = tx.Exec(r.Context(), `UPDATE domains SET is_primary=COALESCE($2,is_primary), redirect_to_primary=COALESCE($3,redirect_to_primary),
		status=COALESCE($4,status), verification_status=COALESCE($5,verification_status),
		verified_at=CASE WHEN $5='VERIFIED' THEN COALESCE(verified_at, now()) ELSE verified_at END, updated_at=now() WHERE id=$1`,
		id, in.IsPrimary, in.RedirectToPrimary, in.Status, in.VerificationStatus)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.serverError(w, r, err)
		return
	}
	s.App.Cache.Del(r.Context(), "domain:"+dom.Domain)
	s.App.InvalidateDomains(r.Context(), dom.TenantID)
	if tenantID != dom.TenantID {
		s.App.InvalidateDomains(r.Context(), tenantID)
	}
	s.audit(r, "UPDATED_DOMAIN", "domain", id, &tenantID, in)
	dom, _ = s.loadDomain(r.Context(), id)
	writeData(w, dom)
}

func (s *Server) deleteDomain(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	dom, err := s.loadDomain(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	s.App.DB.Exec(r.Context(), `DELETE FROM domains WHERE id=$1`, id)
	if dom.IsPrimary {
		s.App.DB.Exec(r.Context(), `UPDATE domains SET is_primary=true WHERE id=(SELECT id FROM domains WHERE tenant_id=$1 ORDER BY id LIMIT 1)`, dom.TenantID)
	}
	s.App.Cache.Del(r.Context(), "domain:"+dom.Domain)
	s.App.InvalidateDomains(r.Context(), dom.TenantID)
	s.audit(r, "DELETED_DOMAIN", "domain", id, &dom.TenantID, map[string]string{"domain": dom.Domain})
	writeData(w, map[string]bool{"ok": true})
}

func (s *Server) verifyDomain(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	dom, err := s.loadDomain(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !canManageTenant(principal(r), dom.TenantID) {
		forbidden(w)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	if err := s.App.CheckDomain(ctx, id); err != nil {
		s.serverError(w, r, err)
		return
	}
	dom, _ = s.loadDomain(r.Context(), id)
	writeData(w, dom)
}

// ---------------------------------------------------------------------------
// Users (PRD §5, §71)

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	if p.Role != roleSuper && p.Role != roleTenantAdmin {
		forbidden(w)
		return
	}
	q := app.UserSelect
	var args []any
	if tid := scopeTenant(r); tid != 0 {
		q += ` WHERE u.tenant_id=$1`
		args = append(args, tid)
	}
	rows, err := s.App.DB.Query(r.Context(), q+` ORDER BY u.role, u.email`, args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[app.User])
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if list == nil {
		list = []app.User{}
	}
	writeData(w, list)
}

type userInput struct {
	Email      *string  `json:"email"`
	Name       *string  `json:"name"`
	Password   *string  `json:"password"`
	Role       *string  `json:"role"`
	TenantID   *int64   `json:"tenant_id"`
	Status     *string  `json:"status"`
	PodcastIDs *[]int64 `json:"podcast_ids"`
}

func (s *Server) checkUserInput(r *http.Request, in *userInput) string {
	p := principal(r)
	if in.Role != nil && !authn.ValidRoles[*in.Role] {
		return "Invalid role"
	}
	if !p.IsSuper() {
		if in.Role != nil && *in.Role == roleSuper {
			return "Only super admins can grant SUPER_ADMIN"
		}
		t := p.Tenant()
		in.TenantID = &t // tenant admins can only manage their own tenant
	}
	if in.Role != nil && *in.Role == roleSuper {
		in.TenantID = nil
	} else if in.Role != nil && in.TenantID == nil {
		return "tenant_id is required for tenant roles"
	}
	if in.Status != nil && *in.Status != "ACTIVE" && *in.Status != "DISABLED" {
		return "Invalid status"
	}
	return ""
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var in userInput
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if in.Email == nil || !util.ValidEmail(*in.Email) || in.Password == nil || in.Role == nil {
		badRequest(w, "email, password and role are required")
		return
	}
	if msg := s.checkUserInput(r, &in); msg != "" {
		badRequest(w, msg)
		return
	}
	hash, err := authn.HashPassword(*in.Password)
	if err != nil {
		badRequest(w, err.Error())
		return
	}
	name := ""
	if in.Name != nil {
		name = util.PlainText(*in.Name)
	}
	var id int64
	err = s.App.DB.QueryRow(r.Context(), `INSERT INTO users(email, password_hash, name, role, tenant_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
		strings.ToLower(strings.TrimSpace(*in.Email)), hash, name, *in.Role, in.TenantID).Scan(&id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if in.PodcastIDs != nil {
		s.setUserPodcasts(r.Context(), id, in.TenantID, *in.PodcastIDs)
	}
	in.Password = nil
	s.audit(r, "CREATED_USER", "user", id, in.TenantID, in)
	s.writeUser(w, r, id, http.StatusCreated)
}

func (s *Server) setUserPodcasts(ctx context.Context, userID int64, tenantID *int64, ids []int64) {
	s.App.DB.Exec(ctx, `DELETE FROM user_podcasts WHERE user_id=$1`, userID)
	for _, pid := range ids {
		// Only podcasts owned by the user's tenant may be assigned.
		s.App.DB.Exec(ctx, `INSERT INTO user_podcasts(user_id, podcast_id) SELECT $1, id FROM podcasts
			WHERE id=$2 AND ($3::bigint IS NULL OR owner_tenant_id=$3) ON CONFLICT DO NOTHING`, userID, pid, tenantID)
	}
}

func (s *Server) writeUser(w http.ResponseWriter, r *http.Request, id int64, status int) {
	rows, err := s.App.DB.Query(r.Context(), app.UserSelect+` WHERE u.id=$1`, id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	u, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[app.User])
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, status, map[string]any{"data": u})
}

func (s *Server) userTenant(ctx context.Context, id int64) (*int64, string, error) {
	var tid *int64
	var role string
	err := s.App.DB.QueryRow(ctx, `SELECT tenant_id, role FROM users WHERE id=$1`, id).Scan(&tid, &role)
	return tid, role, err
}

func (s *Server) updateUser(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	p := principal(r)
	tid, role, err := s.userTenant(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !p.IsSuper() && (tid == nil || *tid != p.Tenant() || role == roleSuper) {
		forbidden(w)
		return
	}
	var in userInput
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if in.Role == nil {
		in.Role = &role
		if !p.IsSuper() || in.TenantID == nil {
			in.TenantID = tid
		}
	}
	if msg := s.checkUserInput(r, &in); msg != "" {
		badRequest(w, msg)
		return
	}
	if id == p.UserID && in.Status != nil && *in.Status == "DISABLED" {
		badRequest(w, "You cannot disable your own account")
		return
	}
	var hash *string
	if in.Password != nil && *in.Password != "" {
		h, err := authn.HashPassword(*in.Password)
		if err != nil {
			badRequest(w, err.Error())
			return
		}
		hash = &h
	}
	if in.Email != nil && !util.ValidEmail(*in.Email) {
		badRequest(w, "Invalid email")
		return
	}
	var email *string
	if in.Email != nil {
		e := strings.ToLower(strings.TrimSpace(*in.Email))
		email = &e
	}
	_, err = s.App.DB.Exec(r.Context(), `UPDATE users SET email=COALESCE($2,email), name=COALESCE($3,name), password_hash=COALESCE($4,password_hash),
		role=$5, tenant_id=$6, status=COALESCE($7,status), updated_at=now() WHERE id=$1`,
		id, email, in.Name, hash, *in.Role, in.TenantID, in.Status)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if hash != nil || (in.Status != nil && *in.Status == "DISABLED") {
		s.App.DB.Exec(r.Context(), `UPDATE refresh_tokens SET revoked_at=now() - interval '1 minute' WHERE user_id=$1 AND revoked_at IS NULL`, id)
	}
	if in.PodcastIDs != nil {
		s.setUserPodcasts(r.Context(), id, in.TenantID, *in.PodcastIDs)
	}
	in.Password = nil
	s.audit(r, "UPDATED_USER", "user", id, in.TenantID, in)
	s.writeUser(w, r, id, http.StatusOK)
}

func (s *Server) deleteUser(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	p := principal(r)
	if id == p.UserID {
		badRequest(w, "You cannot delete your own account")
		return
	}
	tid, role, err := s.userTenant(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if !p.IsSuper() && (tid == nil || *tid != p.Tenant() || role == roleSuper) {
		forbidden(w)
		return
	}
	s.App.DB.Exec(r.Context(), `DELETE FROM users WHERE id=$1`, id)
	s.audit(r, "DELETED_USER", "user", id, tid, nil)
	writeData(w, map[string]bool{"ok": true})
}
