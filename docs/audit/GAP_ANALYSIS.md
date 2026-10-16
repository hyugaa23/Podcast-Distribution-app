# Gap Analysis: PRD v2 Requirements vs Current State

**Date:** 2026-10-14
**Legend:** EXISTS = fully implemented | PARTIAL = partially done | MISSING = not started

## 1. Distribution Manager

| Requirement | Status | Notes |
|-------------|--------|-------|
| Platform registry (CRUD) | EXISTS | platforms table + admin API + admin page |
| 10 default platforms seeded | EXISTS | 0003_distribution_v2.sql seeds all 10 |
| Per-podcast distribution tracking | EXISTS | podcast_distributions table + API |
| Distribution status workflow | EXISTS | All 12 statuses wired in backend + admin UI |
| Platform metadata fields | EXISTS | help_url, account_required, verification_required, supports_api, auto_discovery, notes added in 0003 |
| Distribution method tracking | EXISTS | method column (MANUAL/CLAIM/INDEXED/API) added in 0003 |
| Distribution events/audit trail | EXISTS | distribution_events table + API |
| Bulk distribution operations | EXISTS | POST /distribution/bulk endpoint |
| Readiness check per podcast | EXISTS | GET /distribution/{id}/readiness endpoint |
| Step-by-step submission wizard UI | EXISTS | /distribution/{id}/wizard — guided per-platform flow |
| Platform-specific instruction rendering | EXISTS | Wizard renders instructions as numbered steps + help links |
| Auto-discovery status polling | EXISTS | EnqueueAutoDiscoveryChecks in worker creates DISCOVERY_PENDING records |
| Distribution dashboard with progress bars | EXISTS | Wizard + dashboard both show progress bars |
| Verification flow (email code entry) | EXISTS | Verify mode in editor + wizard; supports EMAIL_CODE, DNS_TXT, HTTP_FILE, META_TAG, MANUAL |

## 2. RSS Feed System

| Requirement | Status | Notes |
|-------------|--------|-------|
| RSS 2.0 + iTunes namespace generation | EXISTS | internal/rss/generate.go |
| RSS feed validation | EXISTS | internal/rss/validate.go |
| RSS import with preview | EXISTS | API + admin page |
| RSS sync (scheduled) | EXISTS | Worker cron + rss_sources |
| RSS health monitoring | EXISTS | rss_health_checks + worker + admin page |
| Feed GUID stability | EXISTS | DB trigger protects episode GUID after publish |
| Per-podcast feed_guid | EXISTS | 0002 migration |
| CSV import | EXISTS | POST /imports/csv |
| Podcast Index API submission | EXISTS | podcastIndexAdd + podcastIndexLookup in distribution.go |

## 3. Multi-Tenancy

| Requirement | Status | Notes |
|-------------|--------|-------|
| Tenant CRUD | EXISTS | Full API + admin pages |
| Content modes (INDEPENDENT/SHARED/SYNDICATED) | EXISTS | DB + tenant_podcast_ids() function |
| Custom domains with DNS verification | EXISTS | domains table + CHECK_DOMAIN worker |
| Per-tenant SEO settings | EXISTS | seo_settings table + API |
| Per-tenant branding/theme config | EXISTS | tenant_settings table |
| Domain SSL via Caddy | EXISTS | Infrastructure Caddyfile |
| Tenant-scoped analytics | EXISTS | analytics_events.tenant_id |

## 4. Content Management

| Requirement | Status | Notes |
|-------------|--------|-------|
| Podcast CRUD + lifecycle | EXISTS | Full DRAFT->PUBLISHED->ARCHIVED |
| Episode CRUD + lifecycle | EXISTS | Includes PROCESSING + SCHEDULED states |
| Audio upload + processing | EXISTS | Upload flow + FFmpeg worker |
| Image upload + variants | EXISTS | images table + PROCESS_IMAGE worker |
| Transcript (manual/upload/AI) | EXISTS | Three sources supported |
| Hosts/guests management | EXISTS | hosts table + podcast_hosts + episode_hosts |
| Categories + tags | EXISTS | Full taxonomy with iTunes mapping |
| Collections/playlists | EXISTS | collections + collection_items |
| Scheduled publishing | EXISTS | Worker cron checks every 30s |
| Bulk operations | EXISTS | Bulk podcasts + bulk episodes endpoints |

## 5. Analytics

| Requirement | Status | Notes |
|-------------|--------|-------|
| Event tracking (plays, downloads, views) | EXISTS | 9 event types |
| Daily aggregation | EXISTS | analytics_daily + worker |
| Summary dashboard API | EXISTS | /analytics/summary |
| Network-wide analytics | EXISTS | /analytics/network (SUPER_ADMIN) |
| Per-episode analytics | EXISTS | /analytics/episodes endpoint + admin Episodes tab |
| Geographic/device breakdown | EXISTS | /analytics/geo + /analytics/devices endpoints + admin Geo & Devices tab |
| Real-time listener count | MISSING | No WebSocket/SSE for real-time data |

## 6. Operations

| Requirement | Status | Notes |
|-------------|--------|-------|
| System settings management | EXISTS | system_settings + admin page |
| Job monitoring | EXISTS | job_runs table + /system/jobs API |
| System logs | EXISTS | system_logs + /system/logs API |
| Backup/export | EXISTS | /system/backup endpoint |
| Webhook system | EXISTS | webhooks + webhook_deliveries |
| API key management | EXISTS | api_keys + admin page |
| Audit logging | EXISTS | audit_logs + admin page |
| Notifications | EXISTS | notifications + notification_reads |
| Rate limiting | EXISTS | Redis-backed per-IP limits |
| RBAC (5 roles) | EXISTS | DB constraint + middleware |

## 7. Missing/Incomplete Areas (Priority)

| Area | Priority | Effort |
|------|----------|--------|
| ~~Distribution wizard UI (step-by-step guide)~~ | ~~HIGH~~ | DONE — /distribution/{id}/wizard |
| ~~Auto-discovery polling worker~~ | ~~MEDIUM~~ | DONE — EnqueueAutoDiscoveryChecks |
| ~~Verification flow UI~~ | ~~HIGH~~ | DONE — verify mode in DistributionEditor |
| Platform API integrations (Podcast Index) | LOW | Medium |
| ~~Per-episode analytics breakdown API~~ | ~~MEDIUM~~ | DONE — /analytics/episodes |
| ~~Geographic analytics dashboard~~ | ~~LOW~~ | DONE — /analytics/geo + /analytics/devices |
| Real-time analytics (WebSocket) | LOW | Large |
| ~~Distribution progress dashboard (visual)~~ | ~~MEDIUM~~ | DONE — wizard has progress bar |
