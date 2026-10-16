# Legacy System Audit

**Date:** 2026-10-14
**Scope:** Full-stack podcast distribution platform (monorepo)

## 1. Architecture Overview

| Layer | Technology | Notes |
|-------|-----------|-------|
| API | Go 1.22+, Chi v5 router | Single binary, `cmd/api` and `cmd/worker` |
| Admin | Next.js (App Router) | 28 pages, standalone build |
| Web | Next.js (App Router) | Public multi-tenant SSR site |
| Worker | Go (shared binary via `cmd/worker`) | Redis queue, 15 job types |
| Database | PostgreSQL 16 | 34 tables, 3 migrations |
| Cache/Queue | Redis 7 (db 3) | Rate limiting, caching, job queue |
| Media | FFmpeg | Audio processing, transcoding |
| Reverse Proxy | Caddy | HTTPS, auto TLS, custom domains |
| Storage | Local filesystem (CDN-ready interface) | `internal/storage/storage.go` |

## 2. Deployment

- **Host:** VPS Teak `43.156.240.174`
- **Method:** Native systemd services (no Docker in production)
- **Ports:** API 8090-8092, HTTPS via Caddy on 443
- **Constraint:** Shared VPS with teak.email -- do not disrupt

## 3. Database Tables (34 total, 3 migrations)

### Core (0001_init.sql)
| Group | Tables |
|-------|--------|
| Multi-tenancy | themes, tenants, tenant_settings, seo_settings, domains |
| Auth | users, refresh_tokens, api_keys |
| Taxonomy | categories, tags, hosts |
| Content | podcasts, podcast_categories, podcast_tags, podcast_hosts, user_podcasts, tenant_podcasts, episodes, episode_tags, episode_hosts |
| Media | uploads, audio_files, images |
| Distribution | platforms, podcast_distributions, distribution_events |
| RSS | rss_sources, rss_sync_logs, rss_health_checks |
| Analytics | analytics_events, analytics_daily |
| SEO | redirects, collections, collection_items |
| Ops | notifications, notification_reads, audit_logs, system_settings, system_logs, job_runs, webhooks, webhook_deliveries |

### 0002_guid_per_podcast.sql
- Added `feed_guid UUID` to podcasts table

### 0003_distribution_v2.sql
- Extended platform fields (help_url, account_required, verification_required, supports_api, auto_discovery, notes)
- Extended distribution fields (account_label, submitted_by, method, verification_method, next_review_at, verified_at)
- Added statuses: PENDING_REVIEW, DISCOVERY_PENDING, UNAVAILABLE, PAUSED
- Seeded 10 platforms (Spotify, Apple, YouTube, Podcast Addict, Amazon, Pocket Casts, Castbox, Podcast Index, Podchaser, Overcast)

## 4. API Routes

### Public (`/api/public`)
- Site resolution, home, podcasts, episodes, categories, hosts, tags, collections
- Search, RSS feeds (`/feeds/{slug}`), sitemaps, robots.txt, redirects
- Analytics event ingestion, episode preview

### Auth (`/api/auth`)
- Login, refresh, logout, me, change-password

### Admin (authenticated, RBAC-enforced)
- Dashboard, themes, tenants (CRUD + settings + SEO), domains (CRUD + verify)
- Users (CRUD), podcasts (CRUD + publish/unpublish + bulk + tenant assignment)
- Episodes (CRUD + publish/schedule + audio + transcript)
- Uploads (init + complete + data), categories, tags, hosts, collections
- Platforms (CRUD), distribution (list/overview/bulk/per-podcast/submit/events/readiness)
- RSS imports (preview/import/CSV), RSS sources (CRUD + sync + logs)
- Exports, analytics (summary + network), notifications, audit logs
- Redirects, API keys, webhooks, system settings/metrics/jobs/logs/backup

## 5. Worker Job Types (15)

PROCESS_AUDIO, PROCESS_IMAGE, IMPORT_RSS, SYNC_RSS, MIRROR_AUDIO,
GENERATE_TRANSCRIPT, REFRESH_DISTRIBUTION, SUBMIT_DISTRIBUTION,
GENERATE_SITEMAP, PUBLISH_SCHEDULED, AGGREGATE_ANALYTICS,
INVALIDATE_CACHE, CHECK_DOMAIN, RSS_HEALTH_CHECK, DELIVER_WEBHOOK

## 6. Admin Pages (28)

Dashboard, tenants (list/new/detail), podcasts (list/new/detail), episodes (list/new/detail),
domains, users, imports, analytics, distribution (overview/per-podcast/platforms),
categories, hosts, collections, redirects, api-keys, webhooks, audit, rss-health,
system, account, login

## 7. Themes (10)

Stream Dark, Clean Editorial, Newsroom, Minimal, Creator, Radio, Tech, Business,
Entertainment, Premium Magazine

## 8. Shared Packages

| Package | Purpose |
|---------|---------|
| packages/config | Shared configuration |
| packages/player | Audio player component |
| packages/themes | 10 theme implementations (TSX + CSS) |
| packages/types | Shared TypeScript types |
| packages/ui | Shared UI components |

## 9. Key Features Already Implemented

- Multi-tenant with custom domains and DNS verification
- Full podcast/episode lifecycle (DRAFT -> PUBLISHED with scheduling)
- RSS feed generation and import/sync with health monitoring
- Audio processing pipeline (FFmpeg) with retry
- Image processing with variants
- AI transcript generation
- Distribution Manager (80% complete -- CRUD, status tracking, events)
- Analytics (event collection + daily aggregation)
- SEO (per-tenant settings, sitemaps, canonical URLs, redirects)
- RBAC (SUPER_ADMIN, TENANT_ADMIN, EDITOR, CREATOR, VIEWER)
- Webhook system with delivery tracking
- API key authentication
- Audit logging
