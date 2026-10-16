# Podcast Platform Engine

Multi-domain podcast publishing, streaming and distribution engine. **One codebase, one backend, one admin**
runs any number of podcast websites, each with its own domain, brand, SEO and one of **10 themes**
(PRD: `PRD — Multi-Domain Podcast Distribution Platform.md`).

```
apps/
  api/        Go API + worker + migrations (chi, pgx, go-redis, FFmpeg)   → cmd/api, cmd/worker, cmd/migrate
  worker/     Dockerfile/README for the worker binary (built from apps/api)
  web/        Next.js 16 public multi-tenant site (tenant resolver = proxy.ts, theme engine)
  admin/      Next.js 16 Master Admin / Tenant Admin
packages/
  types/      shared TypeScript types (public API contract)
  config/     theme registry metadata, playback speeds, CSS-variable helpers
  ui/         shared components used by every theme (artwork, listen-on, share, transcript, JSON-LD, …)
  player/     global persistent audio player (state + accessible controls + analytics events)
  themes/     theme engine: contract + theme-stream … theme-magazine (10 themes)
infrastructure/  docker (api/next), caddy (on-demand TLS for tenant domains), backup.sh
docs/            API.md, THEME_AUTHORING.md, ADMIN_AUTHORING.md, PRD_COVERAGE.md
docker-compose.yml  single VPS: web, admin, api, worker, postgres, redis, migrate, proxy (Caddy), backup
```

## Production: one VPS (Docker)

Everything runs on one server: websites, admin, API, worker, database, queue and the media files
(audio/images on the VPS disk, served by Caddy with Range support). Requires Docker with the compose plugin.

```bash
cp .env.production.example .env   # ADMIN_DOMAIN, API_DOMAIN, POSTGRES_PASSWORD, JWT_SECRET, REVALIDATE_SECRET, SEED_ADMIN_*
docker compose up -d --build
docker compose run --rm migrate migrate -demo   # optional: 10 demo websites, one per theme
```

- DNS: point `ADMIN_DOMAIN`, `API_DOMAIN` and every tenant domain (A record) at the VPS IP. Caddy issues TLS
  certificates automatically, for tenant domains only when they exist in the platform (**Admin → Domains**).
- Restart policy `unless-stopped`: every service comes back after a reboot. Container logs are capped (3×10 MB).
- Backups: the `backup` service writes a daily database dump to `./backups` (last 14 kept). Media files live in
  the `media` volume; include it in the VPS provider's snapshot/backup.
- Update: `git pull && docker compose up -d --build`.

## Local development (no Docker)

Requirements: Go 1.26+, Node 20.9+, PostgreSQL 15+, Redis 5+, FFmpeg (with libmp3lame + libwebp).

```bash
cp .env.example .env            # defaults work for a local Postgres/Redis; set SEED_ADMIN_PASSWORD
npm install
npm run seed:demo               # migrations + base data + demo tenants (*.localhost domains)
npm run api                     # http://localhost:8080
npm run worker                  # queue consumer + scheduler
npm run dev:web                 # http://<tenant>.localhost:3000  (e.g. http://podcastbusiness.localhost:3000)
npm run dev:admin               # http://localhost:3001
```

`apps/web/.env.local` and `apps/admin/.env.local` need `API_INTERNAL_URL=http://localhost:8080` (web also
`REVALIDATE_SECRET`, same value as the API).

Demo logins (password `ChangeMe123!` — change it): `admin@example.com` (Super Admin),
`admin@podcastbusiness.localhost` (Tenant Admin), `editor@podcastbusiness.localhost` (Editor),
`viewer@podcastbusiness.localhost` (Viewer), `mia@creatorvoice.localhost` (Creator).

Demo websites (one per theme): `streamhub` (01 Stream Dark), `editorialaudio` (02 Editorial), `dailycast`
(03 Newsroom), `quietshows` (04 Minimal), `creatorvoice` (05 Creator), `radiowave` (06 Radio), `techvoice`
(07 Tech), `podcastbusiness` (08 Business), `funcast` (09 Entertainment), `premiumtalk` (10 Magazine) —
all at `http://<name>.localhost:3000`.

## Tests

```bash
cd apps/api
go test ./...                                   # unit tests (RSS generator/validator/parser)
TEST_DATABASE_URL=postgres://postgres@localhost:5432/podcast_test?sslmode=disable \
TEST_REDIS_URL=redis://localhost:6379/1 go test ./internal/api -run TestE2E -v
```

`TestE2E` runs the PRD Definition of Done end to end against real Postgres/Redis/FFmpeg with the worker
in-process: create tenant → connect domain (www redirect) → theme → branding → podcast + artwork upload →
episode + audio upload (FFmpeg processing, MIME sniffing, size limits) → publish → valid RSS with permanent
GUIDs → website pages/search/sitemap → tenant isolation & RBAC → syndication without duplication +
per-tenant overrides + canonical → distribution (custom platform, LIVE/PENDING/ACTION_REQUIRED, public
"Listen On", health) → analytics → timezone scheduling → audit log → API keys → RSS import.

Typecheck/build: `npm run typecheck`, `npm run build`.

## Key flows

* **New website without code changes**: Admin → Websites → *Create website* (name, domain, theme, colours,
  language, timezone, content mode) → the domain resolves immediately (`apps/web/proxy.ts` →
  `GET /api/public/resolve`).
* **Publishing**: Episode editor → upload MP3/M4A/WAV (signed upload) → worker: FFmpeg probe/normalize/MP3
  128–192 kbps → Publish / Schedule (tenant timezone) / Preview → RSS + sitemap + caches refresh.
* **Distribution**: Distribution → podcast → readiness checklist → per platform: Submit (Podcast Index via
  official API when `PODCASTINDEX_API_*` is set; others open the platform's submission page) → track status,
  external URL, notes, history. Only LIVE platforms appear on the public page.
* **Syndication**: Podcast → Sites → "Distribution across sites" + per-site SEO/category/featured overrides and
  canonical (Self / Primary tenant). One podcast record, many websites.

See `docs/PRD_COVERAGE.md` for a section-by-section map of the PRD to the implementation and `docs/API.md`
for the API reference.
