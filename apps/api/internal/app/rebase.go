package app

import (
	"context"
	"fmt"
	"strings"
)

// RebaseMediaURL rewrites stored media URLs from one public base to another (e.g. moving from local
// storage to a CDN / Cloudflare R2 custom domain). Returns the number of updated rows.
func (a *App) RebaseMediaURL(ctx context.Context, from, to string) (int64, error) {
	from, to = strings.TrimRight(from, "/"), strings.TrimRight(to, "/")
	if from == "" || to == "" || from == to {
		return 0, fmt.Errorf("from and to must be different, non-empty URLs")
	}
	text := map[string][]string{
		"podcasts":        {"artwork_url", "banner_url"},
		"episodes":        {"audio_url", "artwork_url"},
		"hosts":           {"photo_url"},
		"collections":     {"cover_url"},
		"seo_settings":    {"default_og_image", "organization_logo"},
		"tenant_podcasts": {"featured_image_url"},
	}
	jsonb := map[string][]string{"images": {"variants"}, "tenant_settings": {"branding"}}
	var total int64
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	for table, cols := range text {
		for _, c := range cols {
			tag, err := tx.Exec(ctx, fmt.Sprintf(`UPDATE %s SET %s = $2 || substr(%s, length($1)+1) WHERE %s LIKE $1 || '%%'`, table, c, c, c), from, to)
			if err != nil {
				return 0, fmt.Errorf("%s.%s: %w", table, c, err)
			}
			total += tag.RowsAffected()
		}
	}
	for table, cols := range jsonb {
		for _, c := range cols {
			tag, err := tx.Exec(ctx, fmt.Sprintf(`UPDATE %s SET %s = replace(%s::text, $1, $2)::jsonb WHERE %s::text LIKE '%%' || $1 || '%%'`, table, c, c, c), from, to)
			if err != nil {
				return 0, fmt.Errorf("%s.%s: %w", table, c, err)
			}
			total += tag.RowsAffected()
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	// Cached pages, feeds and site configs embed the old URLs.
	a.Cache.DelPrefix(ctx, "t:")
	a.Cache.DelPrefix(ctx, "feed:")
	return total, nil
}
