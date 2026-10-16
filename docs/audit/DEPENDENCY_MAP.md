# Component Dependency Map

**Date:** 2026-10-14

## 1. High-Level Architecture

```
                    Internet
                       |
                     Caddy (443)
                    /      \
            apps/web      apps/admin
           (SSR:3000)     (SSR:3001)
                \          /
                 apps/api (8090)
                 /        \
          PostgreSQL 16   Redis 7
                          (db 3)
                 \
              apps/worker
           (same binary, cmd/worker)
```

## 2. Go Package Dependencies (apps/api)

```
cmd/api/main.go
  -> internal/config      (env-based configuration)
  -> internal/db           (PostgreSQL connection + migrations)
  -> internal/cache        (Redis wrapper)
  -> internal/queue        (Redis job queue)
  -> internal/storage      (file storage abstraction)
  -> internal/app          (business logic core)
  -> internal/api          (HTTP handlers + router)

cmd/worker/main.go
  -> internal/config
  -> internal/db
  -> internal/cache
  -> internal/queue
  -> internal/storage
  -> internal/app
  -> internal/worker       (job consumers + scheduler)

internal/app (business logic)
  -> internal/db
  -> internal/cache
  -> internal/queue
  -> internal/storage
  -> internal/rss          (feed generation/parsing/validation)
  -> internal/media        (FFmpeg audio processing)
  -> internal/authn        (JWT + password hashing)
  -> internal/logx         (structured logging)

internal/api (HTTP layer)
  -> internal/app          (all handlers delegate to app)
  -> internal/db           (error type checks only)

internal/worker
  -> internal/app          (all jobs call app methods)
  -> internal/queue        (job type constants)
```

## 3. Frontend Package Dependencies

```
apps/admin (Next.js)
  -> packages/types        (shared TypeScript types)
  -> packages/config       (shared configuration)
  -> packages/ui           (shared UI components)
  -> apps/api              (HTTP calls to /api/auth + /api/admin)

apps/web (Next.js SSR)
  -> packages/types
  -> packages/config
  -> packages/ui
  -> packages/themes       (10 theme components)
  -> packages/player       (audio player)
  -> apps/api              (HTTP calls to /api/public)

packages/themes
  -> packages/player       (Player component per theme)
  -> packages/ui           (shared components)

packages/player
  -> (standalone, audio playback)

packages/ui
  -> (standalone, base components)
```

## 4. Database Table Dependencies

### Core Entity Graph
```
themes
  <- tenants.theme_id

tenants
  <- tenant_settings.tenant_id
  <- seo_settings.tenant_id
  <- domains.tenant_id
  <- users.tenant_id
  <- api_keys.tenant_id
  <- podcasts.owner_tenant_id, canonical_tenant_id
  <- tenant_podcasts.tenant_id
  <- rss_sources.tenant_id
  <- analytics_events.tenant_id
  <- analytics_daily.tenant_id
  <- collections.tenant_id
  <- notifications.tenant_id
  <- audit_logs.tenant_id
  <- webhooks.tenant_id
  <- uploads.tenant_id
  <- hosts.owner_tenant_id
  <- redirects.tenant_id

podcasts
  <- episodes.podcast_id
  <- podcast_categories.podcast_id
  <- podcast_tags.podcast_id
  <- podcast_hosts.podcast_id
  <- user_podcasts.podcast_id
  <- tenant_podcasts.podcast_id
  <- podcast_distributions.podcast_id
  <- rss_sources.podcast_id
  <- rss_health_checks.podcast_id
  <- audio_files.podcast_id
  <- analytics_events.podcast_id

episodes
  <- episode_tags.episode_id
  <- episode_hosts.episode_id
  <- audio_files.episode_id
  <- analytics_events.episode_id

platforms
  <- podcast_distributions.platform_id

podcast_distributions
  <- distribution_events.distribution_id
```

## 5. External Service Dependencies

| Service | Used By | Purpose |
|---------|---------|---------|
| PostgreSQL 16 | API, Worker | Primary data store |
| Redis 7 | API, Worker | Cache, queue, rate limiting, cron locks |
| FFmpeg | Worker | Audio transcoding |
| Caddy | Reverse proxy | HTTPS termination, custom domains |
| External RSS feeds | Worker (SYNC_RSS) | Feed import/sync |
| Web app (Next.js) | API (InvalidateCache) | ISR revalidation callback |

## 6. Critical Path Dependencies

**Publishing an episode requires (in order):**
1. Podcast must exist and be PUBLISHED
2. Audio file uploaded -> PROCESS_AUDIO worker job -> audio_files.status = READY
3. Episode created with audio_file_id
4. Episode published -> RSS feed regenerated -> cache invalidated

**Distribution submission requires:**
1. Podcast PUBLISHED with at least 1 published episode
2. Valid RSS feed URL accessible externally
3. Platform record exists and is_active
4. podcast_distributions record created with proper status flow

**Custom domain activation requires:**
1. Domain record created with verification_token
2. DNS TXT record set by user
3. CHECK_DOMAIN worker verifies DNS
4. Caddy configuration updated for TLS
