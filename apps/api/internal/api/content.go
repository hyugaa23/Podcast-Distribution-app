package api

import (
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"podcast/api/internal/app"
	"podcast/api/internal/util"
)

// ---------------------------------------------------------------------------
// Categories (PRD §30)

func (s *Server) listCategories(w http.ResponseWriter, r *http.Request) {
	rows, err := s.App.DB.Query(r.Context(), `SELECT c.id, c.name, c.slug, c.parent_id, c.description, c.itunes_name, c.sort_order,
		(SELECT count(*) FROM podcasts p WHERE c.id IN (p.category_id, p.subcategory_id))::int AS podcast_count
		FROM categories c ORDER BY COALESCE(c.parent_id, c.id), c.parent_id NULLS FIRST, c.sort_order, c.name`)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[app.Category])
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeData(w, list)
}

type categoryInput struct {
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	ParentID    *int64 `json:"parent_id"`
	Description string `json:"description"`
	ITunesName  string `json:"itunes_name"`
	SortOrder   int    `json:"sort_order"`
}

func (s *Server) createCategory(w http.ResponseWriter, r *http.Request) {
	var in categoryInput
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	in.Name = util.PlainText(in.Name)
	if in.Name == "" {
		badRequest(w, "Name is required")
		return
	}
	if len(in.Name) > 200 { badRequest(w, "name must be under 200 characters"); return }
	if len(in.Description) > 10000 { badRequest(w, "description must be under 10000 characters"); return }
	if in.Slug == "" {
		in.Slug = in.Name
	}
	var id int64
	err := s.App.DB.QueryRow(r.Context(), `INSERT INTO categories(name, slug, parent_id, description, itunes_name, sort_order)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, in.Name, util.Slugify(in.Slug), nilIfZeroPtr(in.ParentID),
		util.PlainText(in.Description), util.PlainText(in.ITunesName), in.SortOrder).Scan(&id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	s.App.Cache.DelPrefix(r.Context(), "t:")
	s.audit(r, "CREATED_CATEGORY", "category", id, nil, in)
	writeJSON(w, http.StatusCreated, map[string]any{"data": map[string]any{"id": id}})
}

func (s *Server) updateCategory(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	var in categoryInput
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	in.Name = util.PlainText(in.Name)
	if in.Name == "" {
		badRequest(w, "Name is required")
		return
	}
	if len(in.Name) > 200 { badRequest(w, "name must be under 200 characters"); return }
	if len(in.Description) > 10000 { badRequest(w, "description must be under 10000 characters"); return }
	if in.ParentID != nil && *in.ParentID == id {
		badRequest(w, "A category cannot be its own parent")
		return
	}
	var oldSlug string
	s.App.DB.QueryRow(r.Context(), `SELECT slug FROM categories WHERE id=$1`, id).Scan(&oldSlug)
	newSlug := oldSlug
	if in.Slug != "" {
		newSlug = util.Slugify(in.Slug)
	}
	_, err := s.App.DB.Exec(r.Context(), `UPDATE categories SET name=$2, slug=$3, parent_id=$4, description=$5, itunes_name=$6, sort_order=$7 WHERE id=$1`,
		id, in.Name, newSlug, nilIfZeroPtr(in.ParentID), util.PlainText(in.Description), util.PlainText(in.ITunesName), in.SortOrder)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if oldSlug != "" && oldSlug != newSlug {
		s.App.DB.Exec(r.Context(), `INSERT INTO redirects(tenant_id, from_path, to_path, is_auto) VALUES (NULL,$1,$2,true)
			ON CONFLICT (COALESCE(tenant_id,0), from_path) DO UPDATE SET to_path=EXCLUDED.to_path`, "/category/"+oldSlug, "/category/"+newSlug)
	}
	s.App.Cache.DelPrefix(r.Context(), "t:")
	s.audit(r, "UPDATED_CATEGORY", "category", id, nil, in)
	writeData(w, map[string]bool{"ok": true})
}

func (s *Server) deleteCategory(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	tag, err := s.App.DB.Exec(r.Context(), `DELETE FROM categories WHERE id=$1`, id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 { notFound(w); return }
	s.App.Cache.DelPrefix(r.Context(), "t:")
	s.audit(r, "DELETED_CATEGORY", "category", id, nil, nil)
	writeData(w, map[string]bool{"ok": true})
}

func (s *Server) listTags(w http.ResponseWriter, r *http.Request) {
	q := "%" + strings.TrimSpace(r.URL.Query().Get("q")) + "%"
	rows, err := s.App.DB.Query(r.Context(), `SELECT t.id, t.name, t.slug,
		(SELECT count(*) FROM podcast_tags WHERE tag_id=t.id) + (SELECT count(*) FROM episode_tags WHERE tag_id=t.id)
		FROM tags t WHERE t.name ILIKE $1 ORDER BY 4 DESC, t.name LIMIT 100`, q)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer rows.Close()
	type tag struct {
		ID    int64  `json:"id"`
		Name  string `json:"name"`
		Slug  string `json:"slug"`
		Count int    `json:"count"`
	}
	out := []tag{}
	for rows.Next() {
		var t tag
		rows.Scan(&t.ID, &t.Name, &t.Slug, &t.Count)
		out = append(out, t)
	}
	writeData(w, out)
}

// ---------------------------------------------------------------------------
// Hosts (PRD §31)

const hostSelect = `SELECT h.id, h.owner_tenant_id, h.name, h.slug, h.photo_url, h.bio, h.website_url, h.email, h.social_links, h.created_at,
	(SELECT count(*) FROM podcast_hosts WHERE host_id=h.id)::int AS podcast_count FROM hosts h`

func (s *Server) listHosts(w http.ResponseWriter, r *http.Request) {
	q := hostSelect + ` WHERE TRUE`
	var args []any
	if tid := scopeTenant(r); tid != 0 {
		args = append(args, tid)
		q += ` AND (h.owner_tenant_id=$1 OR h.id IN (SELECT host_id FROM podcast_hosts WHERE podcast_id IN (SELECT podcast_id FROM tenant_podcast_ids($1))))`
	}
	if search := strings.TrimSpace(r.URL.Query().Get("q")); search != "" {
		args = append(args, "%"+search+"%")
		q += ` AND h.name ILIKE $` + itoa(len(args))
	}
	rows, err := s.App.DB.Query(r.Context(), q+` ORDER BY h.name LIMIT 500`, args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[app.Host])
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if list == nil {
		list = []app.Host{}
	}
	writeData(w, list)
}

func (s *Server) getHost(w http.ResponseWriter, r *http.Request) {
	rows, err := s.App.DB.Query(r.Context(), hostSelect+` WHERE h.id=$1`, idParam(r, "id"))
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	h, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[app.Host])
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	p := principal(r)
	if !p.IsSuper() && (h.OwnerTenantID == nil || *h.OwnerTenantID != p.Tenant()) {
		var linked bool
		s.App.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM podcast_hosts WHERE host_id=$1 AND podcast_id IN (SELECT podcast_id FROM tenant_podcast_ids($2)))`,
			h.ID, p.Tenant()).Scan(&linked)
		if !linked {
			forbidden(w)
			return
		}
	}
	writeData(w, h)
}

type hostInput struct {
	Name        string            `json:"name"`
	Slug        string            `json:"slug"`
	PhotoURL    string            `json:"photo_url"`
	Bio         string            `json:"bio"`
	WebsiteURL  string            `json:"website_url"`
	Email       string            `json:"email"`
	SocialLinks map[string]string `json:"social_links"`
}

func (in *hostInput) normalize() string {
	in.Name = util.PlainText(in.Name)
	in.Bio = util.SanitizeHTML(in.Bio)
	if in.Name == "" {
		return "Name is required"
	}
	if len(in.Name) > 200 { return "name must be under 200 characters" }
	if len(in.Bio) > 10000 { return "bio must be under 10000 characters" }
	if _, ok := cleanURL(&in.PhotoURL); !ok {
		return "photo_url must be a URL"
	}
	if _, ok := cleanURL(&in.WebsiteURL); !ok {
		return "website_url must be a URL"
	}
	if in.Email != "" && !util.ValidEmail(in.Email) {
		return "Invalid email"
	}
	clean := map[string]string{}
	for k, v := range in.SocialLinks {
		if v == "" {
			continue
		}
		if _, err := util.ValidateFetchURL(v); err != nil {
			return "Social links must be URLs"
		}
		clean[util.PlainText(k)] = v
	}
	in.SocialLinks = clean
	return ""
}

func (s *Server) createHost(w http.ResponseWriter, r *http.Request) {
	var in hostInput
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if msg := in.normalize(); msg != "" {
		badRequest(w, msg)
		return
	}
	p := principal(r)
	owner := p.TenantID
	if p.IsSuper() {
		if t := queryInt64(r, "tenant_id"); t != 0 {
			owner = &t
		}
	}
	base := in.Slug
	if base == "" {
		base = in.Name
	}
	slug := s.App.UniqueHostSlug(r.Context(), base, 0)
	var id int64
	err := s.App.DB.QueryRow(r.Context(), `INSERT INTO hosts(owner_tenant_id, name, slug, photo_url, bio, website_url, email, social_links)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, owner, in.Name, slug, in.PhotoURL, in.Bio, in.WebsiteURL, in.Email, in.SocialLinks).Scan(&id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	s.audit(r, "CREATED_HOST", "host", id, owner, in)
	rows, _ := s.App.DB.Query(r.Context(), hostSelect+` WHERE h.id=$1`, id)
	h, _ := pgx.CollectOneRow(rows, pgx.RowToStructByName[app.Host])
	writeJSON(w, http.StatusCreated, map[string]any{"data": h})
}

func (s *Server) hostWritable(r *http.Request, id int64) (bool, *int64) {
	var owner *int64
	if err := s.App.DB.QueryRow(r.Context(), `SELECT owner_tenant_id FROM hosts WHERE id=$1`, id).Scan(&owner); err != nil {
		return false, nil
	}
	p := principal(r)
	return p.IsSuper() || (owner != nil && *owner == p.Tenant()), owner
}

func (s *Server) updateHost(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	ok, owner := s.hostWritable(r, id)
	if !ok {
		forbidden(w)
		return
	}
	var in hostInput
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	if msg := in.normalize(); msg != "" {
		badRequest(w, msg)
		return
	}
	var oldSlug string
	s.App.DB.QueryRow(r.Context(), `SELECT slug FROM hosts WHERE id=$1`, id).Scan(&oldSlug)
	newSlug := oldSlug
	if in.Slug != "" && util.Slugify(in.Slug) != oldSlug {
		newSlug = s.App.UniqueHostSlug(r.Context(), in.Slug, id)
	}
	_, err := s.App.DB.Exec(r.Context(), `UPDATE hosts SET name=$2, slug=$3, photo_url=$4, bio=$5, website_url=$6, email=$7, social_links=$8,
		updated_at=now() WHERE id=$1`, id, in.Name, newSlug, in.PhotoURL, in.Bio, in.WebsiteURL, in.Email, in.SocialLinks)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if newSlug != oldSlug {
		s.App.DB.Exec(r.Context(), `INSERT INTO redirects(tenant_id, from_path, to_path, is_auto) VALUES (NULL,$1,$2,true)
			ON CONFLICT (COALESCE(tenant_id,0), from_path) DO UPDATE SET to_path=EXCLUDED.to_path`, "/host/"+oldSlug, "/host/"+newSlug)
	}
	s.invalidateHost(r, id)
	s.audit(r, "UPDATED_HOST", "host", id, owner, in)
	writeData(w, map[string]bool{"ok": true})
}

func (s *Server) invalidateHost(r *http.Request, hostID int64) {
	rows, err := s.App.DB.Query(r.Context(), `SELECT podcast_id FROM podcast_hosts WHERE host_id=$1`, hostID)
	if err != nil {
		return
	}
	ids, _ := pgx.CollectRows(rows, pgx.RowTo[int64])
	for _, id := range ids {
		s.App.InvalidatePodcast(r.Context(), id)
	}
}

func (s *Server) deleteHost(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	ok, owner := s.hostWritable(r, id)
	if !ok {
		forbidden(w)
		return
	}
	s.invalidateHost(r, id)
	tag, err := s.App.DB.Exec(r.Context(), `DELETE FROM hosts WHERE id=$1`, id)
	if err != nil { s.serverError(w, r, err); return }
	if tag.RowsAffected() == 0 { notFound(w); return }
	s.audit(r, "DELETED_HOST", "host", id, owner, nil)
	writeData(w, map[string]bool{"ok": true})
}

// ---------------------------------------------------------------------------
// Collections (PRD §92)

func (s *Server) listCollections(w http.ResponseWriter, r *http.Request) {
	q := `SELECT c.id, c.tenant_id, c.title, c.slug, c.description, c.cover_url, c.is_published, c.sort_order, c.created_at,
		COALESCE((SELECT array_agg(podcast_id ORDER BY sort_order) FROM collection_items WHERE collection_id=c.id), '{}') AS podcast_ids
		FROM collections c`
	var args []any
	if tid := scopeTenant(r); tid != 0 {
		q += ` WHERE c.tenant_id=$1`
		args = append(args, tid)
	}
	rows, err := s.App.DB.Query(r.Context(), q+` ORDER BY c.tenant_id, c.sort_order, c.title`, args...)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[app.Collection])
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if list == nil {
		list = []app.Collection{}
	}
	writeData(w, list)
}

type collectionInput struct {
	TenantID    int64   `json:"tenant_id"`
	Title       string  `json:"title"`
	Slug        string  `json:"slug"`
	Description string  `json:"description"`
	CoverURL    string  `json:"cover_url"`
	IsPublished *bool   `json:"is_published"`
	SortOrder   int     `json:"sort_order"`
	PodcastIDs  []int64 `json:"podcast_ids"`
}

func (s *Server) saveCollectionItems(r *http.Request, collectionID, tenantID int64, ids []int64) {
	s.App.DB.Exec(r.Context(), `DELETE FROM collection_items WHERE collection_id=$1`, collectionID)
	for i, pid := range ids {
		if s.App.PodcastVisibleOnTenantAnyStatus(r.Context(), tenantID, pid) {
			s.App.DB.Exec(r.Context(), `INSERT INTO collection_items(collection_id, podcast_id, sort_order) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
				collectionID, pid, i)
		}
	}
}

func (s *Server) createCollection(w http.ResponseWriter, r *http.Request) {
	var in collectionInput
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	p := principal(r)
	if !p.IsSuper() {
		in.TenantID = p.Tenant()
	}
	in.Title = util.PlainText(in.Title)
	if in.Title == "" || in.TenantID == 0 {
		badRequest(w, "title and tenant_id are required")
		return
	}
	if len(in.Title) > 200 { badRequest(w, "title must be under 200 characters"); return }
	if len(in.Description) > 10000 { badRequest(w, "description must be under 10000 characters"); return }
	if _, ok := cleanURL(&in.CoverURL); !ok {
		badRequest(w, "cover_url must be a URL")
		return
	}
	if in.Slug == "" {
		in.Slug = in.Title
	}
	pub := in.IsPublished == nil || *in.IsPublished
	var id int64
	err := s.App.DB.QueryRow(r.Context(), `INSERT INTO collections(tenant_id, title, slug, description, cover_url, is_published, sort_order)
		VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, in.TenantID, in.Title, util.Slugify(in.Slug), util.PlainText(in.Description),
		in.CoverURL, pub, in.SortOrder).Scan(&id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	s.saveCollectionItems(r, id, in.TenantID, in.PodcastIDs)
	s.App.InvalidateTenant(r.Context(), in.TenantID)
	s.audit(r, "CREATED_COLLECTION", "collection", id, &in.TenantID, in)
	writeJSON(w, http.StatusCreated, map[string]any{"data": map[string]any{"id": id}})
}

func (s *Server) updateCollection(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	var tid int64
	if err := s.App.DB.QueryRow(r.Context(), `SELECT tenant_id FROM collections WHERE id=$1`, id).Scan(&tid); err != nil {
		notFound(w)
		return
	}
	if !canManageTenant(principal(r), tid) {
		forbidden(w)
		return
	}
	var in collectionInput
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	in.Title = util.PlainText(in.Title)
	if in.Title == "" {
		badRequest(w, "title is required")
		return
	}
	if len(in.Title) > 200 { badRequest(w, "title must be under 200 characters"); return }
	if len(in.Description) > 10000 { badRequest(w, "description must be under 10000 characters"); return }
	if _, ok := cleanURL(&in.CoverURL); !ok {
		badRequest(w, "cover_url must be a URL")
		return
	}
	var oldSlug string
	s.App.DB.QueryRow(r.Context(), `SELECT slug FROM collections WHERE id=$1`, id).Scan(&oldSlug)
	slug := oldSlug
	if in.Slug != "" {
		slug = util.Slugify(in.Slug)
	}
	pub := in.IsPublished == nil || *in.IsPublished
	_, err := s.App.DB.Exec(r.Context(), `UPDATE collections SET title=$2, slug=$3, description=$4, cover_url=$5, is_published=$6, sort_order=$7,
		updated_at=now() WHERE id=$1`, id, in.Title, slug, util.PlainText(in.Description), in.CoverURL, pub, in.SortOrder)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if slug != oldSlug {
		s.App.DB.Exec(r.Context(), `INSERT INTO redirects(tenant_id, from_path, to_path, is_auto) VALUES ($1,$2,$3,true)
			ON CONFLICT (COALESCE(tenant_id,0), from_path) DO UPDATE SET to_path=EXCLUDED.to_path`, tid, "/collection/"+oldSlug, "/collection/"+slug)
	}
	if in.PodcastIDs != nil {
		s.saveCollectionItems(r, id, tid, in.PodcastIDs)
	}
	s.App.InvalidateTenant(r.Context(), tid)
	s.audit(r, "UPDATED_COLLECTION", "collection", id, &tid, in)
	writeData(w, map[string]bool{"ok": true})
}

func (s *Server) deleteCollection(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	var tid int64
	if err := s.App.DB.QueryRow(r.Context(), `SELECT tenant_id FROM collections WHERE id=$1`, id).Scan(&tid); err != nil {
		notFound(w)
		return
	}
	if !canManageTenant(principal(r), tid) {
		forbidden(w)
		return
	}
	tag, err := s.App.DB.Exec(r.Context(), `DELETE FROM collections WHERE id=$1`, id)
	if err != nil { s.serverError(w, r, err); return }
	if tag.RowsAffected() == 0 { notFound(w); return }
	s.App.InvalidateTenant(r.Context(), tid)
	s.audit(r, "DELETED_COLLECTION", "collection", id, &tid, nil)
	writeData(w, map[string]bool{"ok": true})
}
