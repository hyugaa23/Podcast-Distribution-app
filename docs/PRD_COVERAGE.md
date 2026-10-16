# PRD coverage

Map from PRD sections to the implementation. Paths are relative to the repo root.

| PRD | Requirement | Implementation |
|---|---|---|
| §6–7, §113 | Tenant resolution by hostname; all queries tenant-scoped | `apps/web/proxy.ts` → `GET /api/public/resolve`; `app.ResolveHost` (Redis-cached); public API middleware `tenantFromHost`; admin scoping `scopeTenant`, `podcastAccessFor` (`apps/api/internal/api/auth.go`). Tenant ids from the frontend never widen a tenant user's scope. |
| §8 | Domains: add, verify, assign, SSL/DNS status, primary/redirect, active/disabled; apex, www, subdomains | `domains` table, `/api/domains*`, `app.CheckDomain` (TXT `_podcast-verify.<domain>` or `/.well-known/podcast-verify.txt`, DNS target, TLS check), worker re-checks every 6h, admin `/domains`. www → primary 301 in `proxy.ts`. |
| §9–10 | Tenant creation wizard; content modes Independent / Shared / Syndicated | `app.CreateTenant`, admin `/tenants/new`; visibility rules in SQL function `tenant_podcast_ids()`; syndication guards in `setPodcastTenants`. |
| §11–13 | Podcast library & episode fields/statuses, episode types | `podcasts`, `episodes` tables (`0001_init.sql`), `/api/podcasts*`, `/api/episodes*`, admin podcast wizard + episode editor. |
| §14–15 | Audio upload pipeline (MP3/M4A/WAV → storage → queue → FFmpeg probe/normalize → MP3 128–192 kbps → duration → ready), S3-compatible storage & key layout, CDN | `api/uploads.go` (signed upload, MIME sniffing, size limits), `app.ProcessAudio`, `internal/media`, `internal/storage` (local + S3/R2/B2/MinIO, keys `audio/{podcast}/{episode}/`, `images/{tenant}/`, `podcasts/{id}/`, `episodes/{id}/`), `CDN_URL`. Originals kept. |
| §16 | Global player: play/pause/seek/time/duration/volume/speed 0.75–2x/skip/info/artwork; persistent across client navigation | `packages/player` (single `<audio>` in root layout, Media Session), `ClientNavigation` in `apps/web/app/providers.tsx`; 10 theme presentations. Verified in a browser on all 10 themes. |
| §17, §116, §119 | RSS feed `/feed/{slug}.xml` and `/podcast/{slug}/feed.xml`, iTunes + Podcasting 2.0 tags, permanent GUIDs, public audio URLs, cacheable | `internal/rss/generate.go`, `app.BuildFeed` (Redis-cached, ETag), DB trigger blocks GUID changes after publish, unique GUID per feed; validator `internal/rss/validate.go` (project feed validator, unit-tested). |
| §18–19 | RSS importer (metadata only / mirror audio), artwork import, automatic sync (15m…daily) comparing GUIDs | `app.CreateRSSSource`, `app.SyncRSSSource` (conditional GET, SSRF-safe client), `MIRROR_AUDIO` job, scheduler `EnqueueDueRSSSyncs`, admin `/imports`. |
| §20–27, §95, §97, §115, §120 | Distribution manager, DB platform registry (13 defaults, extensible), 8 statuses, records, dashboard with progress, manual + API submission (Podcast Index official API), readiness checklist, public "Listen On" LIVE only, health, issues (resolve / note / mark submitted) | `platforms`, `podcast_distributions`, `distribution_events`; `app.UpsertDistribution`, `DistributionReadiness`, `SubmitViaAPI`, `RefreshDistribution`; admin `/distribution`, `/distribution/[id]`, `/distribution/platforms`. |
| §28 | Search podcasts, episodes, hosts, categories, tags (PostgreSQL FTS) | generated `tsvector` columns + GIN, prefix queries, `pg_trgm`; `/search`. |
| §29–31, §92–93 | Discovery sections, categories `/category/{slug}`, host pages `/host/{slug}`, collections `/collection/{slug}`, internal linking | public API `/home`, `/categories`, `/hosts`, `/collections`; web routes; related podcasts by category/tags. |
| §32, §39 | Transcripts (manual / upload TXT,SRT,VTT / AI), AEO: summary, topics, FAQ, citations, host info | episode fields `transcript*`, `key_topics`, `faq`, `citations`; shared `Transcript` (clickable timestamps), `KeyTopics`, `FAQ`, `Citations`; AI via OpenAI-compatible `TRANSCRIPTION_API_*` (needs review before public display). |
| §33–38 | Per-tenant SEO settings, title formats, JSON-LD (PodcastSeries, PodcastEpisode, Person, Organization, BreadcrumbList, WebSite+SearchAction, FAQPage, ItemList), sitemap index + segments, robots.txt, canonical Self/Primary | `apps/web/lib/seo.ts`, `packages/ui/src/structured.ts`, `app.Sitemap`, `publicRobots`, `tenant_podcasts.canonical_mode`. |
| §40–51, §68, §112, §121 | Theme engine + 10 structurally different themes, theme config | `packages/themes` (contract + `theme-stream` … `theme-magazine`), `themes` table defaults merged with branding/overrides (`app.MergeThemeConfig`). |
| §52–54 | Branding, homepage section builder (enable/disable/reorder), navigation manager | `tenant_settings`, admin `/tenants/[id]` tabs. |
| §55–59 | Master & tenant dashboards, analytics (plays, quartiles, visitors, page views, top lists, referrers, countries, devices, browsers, domains), cross-domain comparison | `/api/dashboard`, `app.Summary`, `app.NetworkComparison`, `analytics_events` + `analytics_daily` rollups, admin `/analytics`. |
| §60–64 | Core tables & relationships, distribution unique (podcast, platform) | `apps/api/internal/db/migrations/*.sql`. |
| §65–67, §69 | Go backend, Next.js + TS frontend, monorepo layout, API endpoints | see README; `docs/API.md`. |
| §70–71 | Email+password, JWT access + rotating refresh token (httpOnly cookie), RBAC enforced in backend | `internal/authn`, `api/auth.go` (`requireRoles`, per-podcast access), roles SUPER_ADMIN/TENANT_ADMIN/EDITOR/CREATOR/VIEWER. |
| §72–74 | Background workers, Redis queue (PROCESS_AUDIO, SYNC_RSS, GENERATE_TRANSCRIPT, REFRESH_DISTRIBUTION, GENERATE_SITEMAP …), Redis caching | `internal/queue` (reliable lists + delayed set + retries), `internal/worker` (handlers + cron with Redis locks), `internal/cache`. |
| §75–76 | CDN delivery; image variants thumbnail/small/medium/large/original (WebP) | `CDN_URL`, S3 public-read policy for media prefixes, `app.ProcessImage`; public API returns `image_variants` and the shared `<Artwork>` serves a WebP `srcset` on every theme (RSS keeps the original JPEG/PNG for directories). |
| §77 | Tenant isolation, rate limiting, secure cookies, CSRF, XSS sanitization, SQL-injection safety, signed uploads, MIME validation, size limits, audit log, password hashing, auth middleware | parameterized SQL (pgx), bluemonday sanitization, Redis rate limits, HMAC-signed uploads + magic-byte sniffing, bcrypt, SameSite=Strict refresh cookie + `X-Requested-With`, SSRF-safe fetcher. Covered by `TestE2E`. |
| §78–80 | Audit log, observability (structured logs, API/queue/storage metrics, job runs, system logs, Prometheus `/metrics`), user-friendly errors with Retry | `audit_logs`, `system_logs`, `job_runs`; admin `/audit`, `/system`; audio failure reason + Retry in episode editor. |
| §81–83 | Performance, accessibility, responsive | Measured locally: cached public API 1–20 ms, admin API 2–80 ms, SSR 10–25 ms. Skip links, focus styles, ARIA player controls, alt text, status badges with text. No horizontal scroll at 375 px (tested on all themes). |
| §84–87 | Admin podcast workflow, publishing workflow (draft → audio → processing → metadata → SEO → preview → publish → RSS/sitemap/cache), scheduling in tenant timezone, bulk operations | admin wizard/editor, `app.PublishEpisode`, `PublishDue`, preview tokens, `/api/*/bulk`, cache purge → `POST /api/revalidate` on the web app. |
| §88–89 | CSV import; exports (podcasts, episodes, distribution, analytics as CSV/JSON); redirect manager with automatic 301s on slug change | `/api/imports/csv`, `/api/exports/*`, `redirects` table (prefix redirects for nested paths), admin `/redirects`. |
| §90–91, §114 | Network syndication across sites; per-tenant overrides without duplicating podcasts | `tenant_podcasts`, `/api/podcasts/:id/tenants`. |
| §96 | RSS health monitor (reachable, XML, artwork, audio, fields, GUID, SSL → Healthy/Warning/Critical) | `app.CheckRSSHealth`, scheduled every 6h, admin `/rss-health`. |
| §98–99 | Internal notifications; system settings (storage, CDN, email, queue, analytics, audio processing, themes, domains, security, API, cron) | `notifications` + bell in admin; `system_settings` + admin `/system`. |
| §100–103 | Env variables, deployment architecture, Docker (web, admin, api, worker, postgres, redis), backups | `.env.example`, `.env.production.example`, `docker-compose.yml` (single VPS: media on the VPS disk, served directly by Caddy, never through the API; daily DB backup service), `infrastructure/`, `/api/system/backup`. S3/R2 remains available via `STORAGE_DRIVER=s3`. |
| §104–105 | API keys (`pk_…`, scoped permissions), webhooks (episode.published, podcast.created, distribution.live/failed, rss.synced) | `api_keys`, `webhooks` (HMAC-SHA256 signed deliveries with retries). |

## Not implemented (marked "Future" / Phase 3 in the PRD)
Google login / passkeys / 2FA, Meilisearch/Typesense/OpenSearch, JSON/OPML import, email/Telegram/Slack
notifications, newsletter delivery (the Newsletter homepage section renders a follow/social CTA), AI show notes /
chapters / clips, monetization/ads, native apps.

## Notes / constraints
* Automated submission is only implemented where an official API allows it (Podcast Index). Other platforms are
  tracked manually, as the PRD requires respecting each platform's Terms of Service.
* AI transcription and Podcast Index submission need credentials (`TRANSCRIPTION_API_*`, `PODCASTINDEX_API_*`).
* On-demand TLS for tenant domains is delegated to Caddy (`infrastructure/caddy/Caddyfile`).
