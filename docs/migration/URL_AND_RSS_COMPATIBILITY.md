# URL and RSS Feed Compatibility Guide

**Date:** 2026-10-14
**Purpose:** Ensure zero breakage of existing RSS feeds, public URLs, and platform listings during migration.

## 1. RSS Feed URL Structure

### Current Pattern
```
https://{domain}/api/public/feeds/{podcast-slug}
```

### Rules
- **NEVER change a published feed URL.** Platforms (Spotify, Apple, etc.) store the exact URL.
- Podcast slug is immutable after first publish (enforced by application logic).
- `feed_guid` (UUID) is immutable per podcast (0002 migration).
- Episode GUID is immutable after publish (DB trigger `protect_episode_guid`).

### Feed URL Resolution
```
Request: GET /api/public/feeds/{slug}
Host header -> tenant resolution -> tenant_podcasts lookup -> RSS XML generation
```

The feed URL is tenant-independent: any domain that hosts the podcast serves the same feed content. The `<link>` element points to the canonical tenant's domain.

## 2. Episode GUID Stability

### Current Format
```xml
<guid isPermaLink="false">{episode.guid}</guid>
```

- Generated as UUID on episode creation
- Protected by DB trigger: cannot change after `published_at` is set
- `source_guid` preserved for imported episodes (maps to origin feed GUID)

### Migration Rule
- Do NOT alter episode GUID generation logic
- Do NOT modify the `protect_episode_guid()` trigger
- Imported episodes keep `source_guid` for deduplication during re-sync

## 3. Public Website URL Patterns

### Current Routes (apps/web)
```
/                                    Homepage
/podcasts                            Podcast listing
/podcasts/{slug}                     Podcast detail
/podcasts/{slug}/episodes            Episode listing
/podcasts/{slug}/episodes/{slug}     Episode detail
/categories                          Category listing
/categories/{slug}                   Category detail
/hosts                               Host listing
/hosts/{slug}                        Host detail
/tags/{slug}                         Tag page
/collections                         Collection listing
/collections/{slug}                  Collection detail
```

### Rules
- Slug-based URLs are permanent. If a slug must change, create a 301 redirect via the `redirects` table.
- The `redirects` table supports per-tenant and global redirects.
- Auto-generated redirects set `is_auto = TRUE` for cleanup tracking.

## 4. API URL Patterns

### Public API (consumed by web app SSR)
```
/api/public/resolve              Tenant resolution
/api/public/site                 Site metadata
/api/public/home                 Homepage data
/api/public/podcasts             Podcast listing
/api/public/podcasts/{slug}      Podcast detail
/api/public/feeds/{slug}         RSS feed XML
/api/public/sitemap/{segment}    Sitemap XML
/api/public/robots.txt           Robots.txt
```

### Admin API
```
/api/auth/*                      Authentication
/api/dashboard                   Dashboard
/api/tenants/*                   Tenant management
/api/podcasts/*                  Podcast management
/api/episodes/*                  Episode management
/api/distribution/*              Distribution management
/api/platforms/*                 Platform registry
/api/imports/*                   Import tools
...
```

### Migration Rules for API
- Public API routes must NOT change (web app SSR depends on them).
- Admin API: new endpoints are additive. Existing endpoints remain backward-compatible.
- New fields in responses are safe (frontend ignores unknown fields).
- New required fields in requests must have defaults during transition.

## 5. Platform External URLs

### URL Patterns Stored in Platform Registry
```
Spotify:       https://open.spotify.com/show/{id}
Apple:         https://podcasts.apple.com/podcast/id{id}
YouTube:       https://www.youtube.com/playlist?list={id}
Podcast Addict: https://podcastaddict.com/podcast/{id}
Podcast Index: https://podcastindex.org/podcast/{id}
```

### Rules
- `external_url` in podcast_distributions is the live URL on the platform
- `external_id` is the platform-specific identifier
- These are user-entered and must not be auto-modified
- URL patterns in the platforms table are templates for display/validation only

## 6. Domain and HTTPS Compatibility

### Custom Domain Flow
```
1. Admin creates domain record with verification_token
2. User adds TXT record: _podcast-verify.{domain} = {token}
3. CHECK_DOMAIN worker verifies DNS
4. Caddy auto-provisions TLS certificate
```

### Rules
- Domain records are never auto-deleted
- Changing a primary domain requires updating `<link>` in RSS feeds
- SSL certificates are managed by Caddy (auto-renewal)
- Migration must not restart Caddy unless domain config changes

## 7. Migration Compatibility Checklist

| Item | Risk | Mitigation |
|------|------|-----------|
| RSS feed URLs | HIGH | Never change /api/public/feeds/{slug} pattern |
| Episode GUIDs | HIGH | DB trigger prevents modification; do not alter |
| Feed GUID (podcast) | HIGH | UUID column immutable after creation |
| Public page URLs | MEDIUM | Use redirects table for any slug changes |
| Admin API responses | LOW | New fields are additive, never remove existing |
| Platform external URLs | LOW | User-managed, never auto-modified |
| Custom domain SSL | LOW | Caddy handles renewal; no migration action needed |
| itunes:owner email | MEDIUM | Used for Spotify/YouTube verification; must match |

## 8. RSS Feed Elements Critical for Platforms

These XML elements must remain stable across deploys:

```xml
<channel>
  <title>                    <!-- Platform display name -->
  <link>                     <!-- Canonical website URL -->
  <atom:link rel="self">     <!-- Feed URL (must match submitted URL) -->
  <podcast:guid>             <!-- Podcast GUID (feed_guid column) -->
  <itunes:owner>
    <itunes:email>           <!-- Verification email for Spotify/YouTube -->
  </itunes:owner>
  <item>
    <guid>                   <!-- Episode GUID (immutable after publish) -->
    <enclosure url="">       <!-- Audio file URL (must remain accessible) -->
  </item>
</channel>
```

### Validation
- The existing `rss_health_checks` system validates feed structure
- Worker runs health checks every 6 hours (configurable via system_settings)
- CRITICAL health status triggers notification to podcast owner
