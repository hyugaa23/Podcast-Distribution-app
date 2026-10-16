package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"podcast/api/internal/rss"
	"podcast/api/internal/util"
)

// PodcastByID loads a podcast with categories, hosts and tags.
func (a *App) PodcastByID(ctx context.Context, id int64) (*Podcast, error) {
	rows, err := a.DB.Query(ctx, `SELECT `+PodcastCols+` FROM podcasts p WHERE p.id=$1`, id)
	if err != nil {
		return nil, err
	}
	p, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByNameLax[Podcast])
	if err != nil {
		return nil, err
	}
	a.AttachPodcastRelations(ctx, []*Podcast{p})
	return p, nil
}

// QueryPodcasts runs a podcast query whose SELECT list is PodcastCols.
func (a *App) QueryPodcasts(ctx context.Context, sql string, args ...any) ([]*Podcast, error) {
	rows, err := a.DB.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, pgx.RowToAddrOfStructByNameLax[Podcast])
	if err != nil {
		return nil, err
	}
	a.AttachPodcastRelations(ctx, list)
	if list == nil {
		list = []*Podcast{}
	}
	return list, nil
}

// QueryEpisodes runs an episode query whose SELECT list is EpisodeCols / EpisodeColsLight.
func (a *App) QueryEpisodes(ctx context.Context, sql string, args ...any) ([]*Episode, error) {
	rows, err := a.DB.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, pgx.RowToAddrOfStructByNameLax[Episode])
	if err != nil {
		return nil, err
	}
	a.AttachEpisodeRelations(ctx, list)
	if list == nil {
		list = []*Episode{}
	}
	return list, nil
}

func (a *App) EpisodeByID(ctx context.Context, id int64) (*Episode, error) {
	list, err := a.QueryEpisodes(ctx, `SELECT `+EpisodeCols+` FROM episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE e.id=$1`, id)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, pgx.ErrNoRows
	}
	return list[0], nil
}

// AttachPodcastRelations fills Category, Subcategory, Categories, Hosts and Tags in bulk.
func (a *App) AttachPodcastRelations(ctx context.Context, list []*Podcast) {
	if len(list) == 0 {
		return
	}
	ids := make([]int64, len(list))
	byID := map[int64]*Podcast{}
	for i, p := range list {
		ids[i] = p.ID
		byID[p.ID] = p
		p.Tags = []string{}
		p.Hosts = []HostRef{}
	}
	cats := map[int64]CategoryRef{}
	if rows, err := a.DB.Query(ctx, `SELECT id, name, slug FROM categories`); err == nil {
		for rows.Next() {
			var c CategoryRef
			rows.Scan(&c.ID, &c.Name, &c.Slug)
			cats[c.ID] = c
		}
		rows.Close()
	}
	for _, p := range list {
		if p.CategoryID != nil {
			if c, ok := cats[*p.CategoryID]; ok {
				p.Category = &c
				p.Categories = append(p.Categories, c)
			}
		}
		if p.SubcategoryID != nil {
			if c, ok := cats[*p.SubcategoryID]; ok {
				p.Subcategory = &c
				p.Categories = append(p.Categories, c)
			}
		}
	}
	if rows, err := a.DB.Query(ctx, `SELECT podcast_id, category_id FROM podcast_categories WHERE podcast_id = ANY($1)`, ids); err == nil {
		for rows.Next() {
			var pid, cid int64
			rows.Scan(&pid, &cid)
			if c, ok := cats[cid]; ok {
				dup := false
				for _, x := range byID[pid].Categories {
					dup = dup || x.ID == cid
				}
				if !dup {
					byID[pid].Categories = append(byID[pid].Categories, c)
				}
			}
		}
		rows.Close()
	}
	if rows, err := a.DB.Query(ctx, `SELECT ph.podcast_id, h.id, h.name, h.slug, h.photo_url, ph.role
		FROM podcast_hosts ph JOIN hosts h ON h.id=ph.host_id WHERE ph.podcast_id = ANY($1) ORDER BY ph.sort_order, h.name`, ids); err == nil {
		for rows.Next() {
			var pid int64
			var h HostRef
			rows.Scan(&pid, &h.ID, &h.Name, &h.Slug, &h.PhotoURL, &h.Role)
			byID[pid].Hosts = append(byID[pid].Hosts, h)
		}
		rows.Close()
	}
	if rows, err := a.DB.Query(ctx, `SELECT pt.podcast_id, t.name FROM podcast_tags pt JOIN tags t ON t.id=pt.tag_id
		WHERE pt.podcast_id = ANY($1) ORDER BY t.name`, ids); err == nil {
		for rows.Next() {
			var pid int64
			var name string
			rows.Scan(&pid, &name)
			byID[pid].Tags = append(byID[pid].Tags, name)
		}
		rows.Close()
	}
}

// AttachEpisodeRelations fills Hosts (guests) and Tags.
func (a *App) AttachEpisodeRelations(ctx context.Context, list []*Episode) {
	if len(list) == 0 {
		return
	}
	ids := make([]int64, len(list))
	byID := map[int64]*Episode{}
	for i, e := range list {
		ids[i] = e.ID
		byID[e.ID] = e
		e.Tags = []string{}
		e.Hosts = []HostRef{}
	}
	if rows, err := a.DB.Query(ctx, `SELECT eh.episode_id, h.id, h.name, h.slug, h.photo_url, eh.role
		FROM episode_hosts eh JOIN hosts h ON h.id=eh.host_id WHERE eh.episode_id = ANY($1) ORDER BY h.name`, ids); err == nil {
		for rows.Next() {
			var eid int64
			var h HostRef
			rows.Scan(&eid, &h.ID, &h.Name, &h.Slug, &h.PhotoURL, &h.Role)
			byID[eid].Hosts = append(byID[eid].Hosts, h)
		}
		rows.Close()
	}
	if rows, err := a.DB.Query(ctx, `SELECT et.episode_id, t.name FROM episode_tags et JOIN tags t ON t.id=et.tag_id
		WHERE et.episode_id = ANY($1) ORDER BY t.name`, ids); err == nil {
		for rows.Next() {
			var eid int64
			var name string
			rows.Scan(&eid, &name)
			byID[eid].Tags = append(byID[eid].Tags, name)
		}
		rows.Close()
	}
}

// SetPodcastTags replaces a podcast's tags (creating tags as needed).
func (a *App) SetPodcastTags(ctx context.Context, tx pgx.Tx, podcastID int64, tags []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM podcast_tags WHERE podcast_id=$1`, podcastID); err != nil {
		return err
	}
	for _, id := range a.upsertTags(ctx, tx, tags) {
		if _, err := tx.Exec(ctx, `INSERT INTO podcast_tags(podcast_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, podcastID, id); err != nil {
			return err
		}
	}
	return nil
}

// SetEpisodeTags replaces an episode's tags.
func (a *App) SetEpisodeTags(ctx context.Context, tx pgx.Tx, episodeID int64, tags []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM episode_tags WHERE episode_id=$1`, episodeID); err != nil {
		return err
	}
	for _, id := range a.upsertTags(ctx, tx, tags) {
		if _, err := tx.Exec(ctx, `INSERT INTO episode_tags(episode_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, episodeID, id); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) upsertTags(ctx context.Context, tx pgx.Tx, tags []string) []int64 {
	var ids []int64
	seen := map[string]bool{}
	for _, t := range tags {
		name := util.PlainText(t)
		if name == "" || len(name) > 60 {
			continue
		}
		slug := util.Slugify(name)
		if seen[slug] {
			continue
		}
		seen[slug] = true
		var id int64
		err := tx.QueryRow(ctx, `INSERT INTO tags(name, slug) VALUES ($1,$2)
			ON CONFLICT (slug) DO UPDATE SET slug=EXCLUDED.slug RETURNING id`, name, slug).Scan(&id)
		if err == nil {
			ids = append(ids, id)
		}
	}
	return ids
}

// UniquePodcastSlug returns slug or slug-N that is not yet used.
func (a *App) UniquePodcastSlug(ctx context.Context, base string, excludeID int64) string {
	return a.uniqueSlug(ctx, `SELECT EXISTS(SELECT 1 FROM podcasts WHERE slug=$1 AND id<>$2)`, base, excludeID)
}

func (a *App) UniqueHostSlug(ctx context.Context, base string, excludeID int64) string {
	return a.uniqueSlug(ctx, `SELECT EXISTS(SELECT 1 FROM hosts WHERE slug=$1 AND id<>$2)`, base, excludeID)
}

func (a *App) UniqueEpisodeSlug(ctx context.Context, podcastID int64, base string, excludeID int64) string {
	base = util.Slugify(base)
	slug := base
	for i := 2; i < 1000; i++ {
		var exists bool
		a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM episodes WHERE podcast_id=$1 AND slug=$2 AND id<>$3)`, podcastID, slug, excludeID).Scan(&exists)
		if !exists {
			return slug
		}
		slug = fmt.Sprintf("%s-%d", base, i)
	}
	return base + "-" + util.RandomHex(3)
}

func (a *App) uniqueSlug(ctx context.Context, q, base string, excludeID int64) string {
	base = util.Slugify(base)
	slug := base
	for i := 2; i < 1000; i++ {
		var exists bool
		a.DB.QueryRow(ctx, q, slug, excludeID).Scan(&exists)
		if !exists {
			return slug
		}
		slug = fmt.Sprintf("%s-%d", base, i)
	}
	return base + "-" + util.RandomHex(3)
}

// ---------------------------------------------------------------------------
// Canonical URLs & feeds

// CanonicalTenantID returns the primary tenant for a podcast: explicit canonical tenant,
// else the owner, else the first tenant it is syndicated to.
func (a *App) CanonicalTenantID(ctx context.Context, p *Podcast) int64 {
	if p.CanonicalTenantID != nil {
		return *p.CanonicalTenantID
	}
	if p.OwnerTenantID != nil {
		return *p.OwnerTenantID
	}
	var id int64
	a.DB.QueryRow(ctx, `SELECT tenant_id FROM tenant_podcasts WHERE podcast_id=$1 AND NOT hidden ORDER BY created_at LIMIT 1`, p.ID).Scan(&id)
	if id == 0 {
		a.DB.QueryRow(ctx, `SELECT id FROM tenants WHERE content_mode='SHARED' AND status='ACTIVE' ORDER BY id LIMIT 1`).Scan(&id)
	}
	return id
}

// CanonicalBase returns the base URL used for canonical links of podcast p when viewed on tenantID
// (PRD §38: Self or Primary Tenant).
func (a *App) CanonicalBase(ctx context.Context, p *Podcast, tenantID int64) string {
	mode := "SELF"
	a.DB.QueryRow(ctx, `SELECT canonical_mode FROM tenant_podcasts WHERE tenant_id=$1 AND podcast_id=$2`, tenantID, p.ID).Scan(&mode)
	if mode == "PRIMARY" {
		if ct := a.CanonicalTenantID(ctx, p); ct != 0 {
			return a.SiteBaseURL(ctx, ct)
		}
	}
	return a.SiteBaseURL(ctx, tenantID)
}

// FeedURL is the permanent public RSS URL submitted to directories.
func (a *App) FeedURL(ctx context.Context, p *Podcast) string {
	base := a.Cfg.WebInternalURL
	if t := a.CanonicalTenantID(ctx, p); t != 0 {
		base = a.SiteBaseURL(ctx, t)
	}
	return base + "/feed/" + p.Slug + ".xml"
}

// BuildFeed generates the RSS XML for a podcast (cacheable, stable, permanent GUIDs; PRD §116).
func (a *App) BuildFeed(ctx context.Context, podcastID int64) ([]byte, *Podcast, error) {
	p, err := a.PodcastByID(ctx, podcastID)
	if err != nil {
		return nil, nil, err
	}
	key := fmt.Sprintf("feed:%d:xml", podcastID)
	if b, ok := a.Cache.GetBytes(ctx, key); ok {
		return b, p, nil
	}
	base := a.Cfg.WebInternalURL
	if t := a.CanonicalTenantID(ctx, p); t != 0 {
		base = a.SiteBaseURL(ctx, t)
	}
	podcastURL := base + "/podcast/" + p.Slug
	if p.WebsiteURL != "" {
		podcastURL = p.WebsiteURL
	}

	ch := rss.Channel{
		Title:       p.Title,
		Link:        podcastURL,
		FeedURL:     base + "/feed/" + p.Slug + ".xml",
		Description: firstNonEmpty(util.StripTags(p.Description), p.ShortDescription, p.Title),
		Language:    p.Language,
		Copyright:   p.Copyright,
		Author:      firstNonEmpty(p.Author, p.OwnerName),
		OwnerName:   firstNonEmpty(p.OwnerName, p.Author),
		OwnerEmail:  p.OwnerEmail,
		ImageURL:    p.ArtworkURL,
		Explicit:    p.Explicit,
		Type:        p.PodcastType,
		GUID:        p.FeedGUID,
		LastBuild:   p.UpdatedAt,
	}
	if p.CategoryID != nil {
		var name, itunes string
		a.DB.QueryRow(ctx, `SELECT name, itunes_name FROM categories WHERE id=$1`, *p.CategoryID).Scan(&name, &itunes)
		cat := rss.Category{Name: firstNonEmpty(itunes, name)}
		if p.SubcategoryID != nil {
			a.DB.QueryRow(ctx, `SELECT COALESCE(NULLIF(itunes_name,''), name) FROM categories WHERE id=$1`, *p.SubcategoryID).Scan(&cat.Sub)
		}
		ch.Categories = append(ch.Categories, cat)
	}

	eps, err := a.QueryEpisodes(ctx, `SELECT `+EpisodeCols+` FROM episodes e JOIN podcasts p ON p.id=e.podcast_id
		WHERE e.podcast_id=$1 AND e.status='PUBLISHED' AND e.published_at<=now() AND e.audio_url<>''
		ORDER BY e.published_at DESC LIMIT 3000`, podcastID)
	if err != nil {
		return nil, nil, err
	}
	for _, e := range eps {
		if e.UpdatedAt.After(ch.LastBuild) {
			ch.LastBuild = e.UpdatedAt
		}
		desc := e.Description
		if e.ShowNotes != "" {
			desc += "\n" + e.ShowNotes
		}
		item := rss.Item{
			Title:           e.Title,
			Link:            base + "/podcast/" + p.Slug + "/" + e.Slug,
			GUID:            e.GUID,
			DescriptionHTML: firstNonEmpty(desc, e.ShortDescription, e.Title),
			Summary:         e.ShortDescription,
			EnclosureURL:    e.AudioURL,
			EnclosureLength: e.AudioSize,
			EnclosureType:   firstNonEmpty(e.AudioMime, "audio/mpeg"),
			Duration:        e.Duration,
			PubDate:         *e.PublishedAt,
			EpisodeNumber:   e.EpisodeNumber,
			SeasonNumber:    e.SeasonNumber,
			EpisodeType:     e.EpisodeType,
			Explicit:        e.Explicit,
			ImageURL:        e.ArtworkURL,
		}
		if e.TranscriptURL != "" {
			item.TranscriptURL, item.TranscriptType = e.TranscriptURL, rss.TranscriptMIME(e.TranscriptFormat)
		} else if e.Transcript != "" && e.TranscriptOK {
			f := firstNonEmpty(e.TranscriptFormat, "txt")
			item.TranscriptURL = base + "/podcast/" + p.Slug + "/" + e.Slug + "/transcript." + f
			item.TranscriptType = rss.TranscriptMIME(f)
		}
		ch.Items = append(ch.Items, item)
	}
	out := rss.Generate(ch)
	a.Cache.SetBytes(ctx, key, out, 30*time.Minute)
	return out, p, nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// PodcastVisibleOnTenant reports whether podcastID is published and visible on tenantID.
func (a *App) PodcastVisibleOnTenant(ctx context.Context, tenantID, podcastID int64) bool {
	var ok bool
	a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM podcasts p WHERE p.id=$2 AND p.status='PUBLISHED'
		AND p.id IN (SELECT podcast_id FROM tenant_podcast_ids($1)))`, tenantID, podcastID).Scan(&ok)
	return ok
}

// PodcastVisibleOnTenantAnyStatus reports whether the podcast is linked to the tenant regardless of status.
func (a *App) PodcastVisibleOnTenantAnyStatus(ctx context.Context, tenantID, podcastID int64) bool {
	var ok bool
	a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tenant_podcast_ids($1) WHERE podcast_id=$2)
		OR EXISTS(SELECT 1 FROM tenant_podcasts WHERE tenant_id=$1 AND podcast_id=$2)`, tenantID, podcastID).Scan(&ok)
	return ok
}
