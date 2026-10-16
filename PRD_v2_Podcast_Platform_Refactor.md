# PRD v2.0 — Refactor Existing Multi-Domain Podcast Platform

**Status:** Implementation-ready specification, pending codebase audit  
**Date:** 14 October 2026  
**Type:** Brownfield modernization / incremental refactor (NOT greenfield rebuild)  
**Product:** Multi-domain Podcast Publishing, RSS Hosting & Distribution Management  
**Primary stakeholders:** Product owner, Pak Nell, engineering/AI coding agent

> **Non-negotiable:** The existing application already exists. Inspect the actual repository, database, routes, services, infrastructure, and user flows before modifying anything. Preserve working functionality and production data. This PRD describes the target behavior, not an assertion about the current implementation.

---

## 1. Executive decision

The target product is **one shared podcast engine supporting multiple domains and ten distinct visual themes**. Each website/domain can host **many podcast shows**; each show can contain **many episodes** and exposes **one stable public RSS feed**. Each show can be submitted to **multiple third-party podcast directories**. Submission is *not inherently automated*: the platform tracks required steps, ownership verification, submissions, live listings, and evidence URLs. New episodes update the RSS feed automatically; external directory refresh timing is outside our control.

### Terms that must not be confused

| Term | Meaning |
|---|---|
| Website / tenant | Branded public podcast website on one or more domains |
| Podcast / show | Series containing episodes; usually one primary RSS feed |
| Episode | Individual audio publication in a show |
| RSS feed | Public XML feed read by compatible podcast directories |
| Distribution target | External directory/service (Spotify, Apple Podcasts, etc.) |
| Submission | Initial action to register/claim a show's RSS with a destination |
| Syndication | Showing or licensing a show across our own sites, subject to rights |
| Bulk distribution | Manage many show × destination workflows; does not imply mass API submission |
| Live listing | Verified external URL that resolves to the intended show |

**Explicit exclusions:** No promise of automatic one-click submission to all platforms, no fabricated live statuses, no assumption that an external platform offers a public submission API, and no automatic creation of multiple external shows from one episode.

## 2. Why this is a refactor

The legacy app is already implemented, but its actual capabilities and limitations are unknown until audited. The engineering objective is to **adapt, reuse, and migrate** rather than discard. The agent must determine which existing features are usable, which need adapters, and which require replacement. This PRD does not prescribe deleting the old database, switching frameworks, or replacing hosting before evidence supports it.

### Success definition

An admin can create or select a tenant, configure its domain/theme, create or import multiple podcast shows, add episodes, publish valid show RSS feeds, open an assisted distribution checklist for each show, track multiple free external directories, and manage bulk workflows. Existing data, working routes, and audio remain accessible through migration.

## 3. Phase 0: mandatory legacy audit and deliverables

**Do not begin schema changes or UI redesign until audit outputs are written.**

Inspect:

1. Repository layout, framework versions, package manager, dependencies, deploy method and environment configuration (never print secrets).
2. Current authentication, roles, session handling, tenancy, domain routing and theme implementation.
3. Database schema, foreign keys, indexes, migrations, row counts, orphan records and backups.
4. Podcast/show, episode, media upload, audio playback, RSS feed and search workflows.
5. Public URLs, canonical tags, RSS URLs, episode GUIDs, existing redirects, sitemaps and analytics.
6. Admin screens, distribution integrations, queues, cron jobs, storage, object URLs, logging and errors.
7. Tests, build status, production constraints and operational risks.
8. Existing tenant/domain count, shows per site, episodes per show, storage size, and any integrations actually configured.

Required files before implementation:

- `docs/audit/LEGACY_SYSTEM_AUDIT.md` — actual findings, paths, screenshots where useful, data inventory.
- `docs/audit/GAP_ANALYSIS.md` — requirement / exists / partial / missing / action / risk.
- `docs/audit/DEPENDENCY_MAP.md` — components and database dependencies.
- `docs/migration/MIGRATION_PLAN.md` — incremental steps, backfill, rollback and acceptance gates.
- `docs/migration/URL_AND_RSS_COMPATIBILITY.md` — every existing URL/feed pattern and migration rule.

If a required architectural fact cannot be established, **mark it UNKNOWN and request confirmation**; do not guess. Preserve current stack unless a measured blocker warrants change.

## 4. User roles and authorization

- **Super Admin:** Manage all tenants, domains, themes, global platform registry, storage, system health, shared podcast library and distribution workflows.
- **Tenant Admin:** Manage only authorized tenant settings, podcasts, episodes, team, publication and distribution.
- **Editor:** Create/edit/publish content according to tenant permissions.
- **Distribution Operator:** Run submission checklists, enter external URLs, update evidence/status; cannot change billing/system configuration.
- **Viewer:** Read permitted dashboards.
- **Public listener:** Browse, search, play and share without login.

RBAC enforced in backend/API and jobs, not only UI. A user may belong to multiple tenants with separate roles. Every mutation must log actor, tenant, resource, action and timestamp.

## 5. Target domain model

### Core relationships

```text
Platform
 ├── Tenant A ── Domain A1, A2 ── Theme A
 │    ├── Show 1 ── Episode 1..N ── RSS 1
 │    ├── Show 2 ── Episode 1..N ── RSS 2
 │    └── Show 3 ── Episode 1..N ── RSS 3
 └── Tenant B ── Domain B ── Theme B
      ├── Show 4 ── Episode 1..N ── RSS 4
      └── Optional licensed/shared Show 1

Show 1 ── Distribution records:
  Spotify / Apple Podcasts / Amazon Music / YouTube Music /
  Pocket Casts / Podcast Index / Castbox / Podcast Addict /
  Podchaser / Overcast / additional configured targets
```

**Invariants:** A tenant may have zero to many shows; a show may have zero to many episodes; a show has a stable canonical RSS URL; each show-target pair has at most one active listing record per account/context; episodes have immutable stable GUIDs after publishing.

### Shared library / syndication

Optional `tenant_podcasts` association permits an authorized show to appear on multiple internal websites. Keep one canonical ownership and RSS source unless there is a deliberate, approved multi-feed use case. Respect ownership/licensing. Cross-domain reuse requires explicit canonical/SEO policy; do not create duplicate third-party directory submissions by default.

## 6. Functional requirements — multi-tenant and domain management

**MT-01** Create, edit, suspend, archive tenants without redeploying.  
**MT-02** Add and verify custom domain via documented DNS challenge; enforce uniqueness.  
**MT-03** Resolve hostname to tenant server-side; reject unknown hostnames safely.  
**MT-04** Per-tenant logo, favicon, language, timezone, SEO, social links, categories and theme.  
**MT-05** Support canonical domain and 301 redirect aliases, preserving feed accessibility.  
**MT-06** Prevent cross-tenant reads/writes at API, worker, cache and storage layers.  
**MT-07** Tenant create wizard must work with no code changes.  
**MT-08** If legacy app already has tenant/domain support, extend rather than duplicate it.

Acceptance: two tenants with different themes and overlapping slugs render correct isolated content, feeds, metadata and media. Tenant B cannot access Tenant A's private admin data by guessing IDs.

## 7. Functional requirements — shows and episodes

**POD-01** Create/edit/archive multiple shows per tenant; list, filter, paginate and bulk-select.  
**POD-02** Show fields: title, slug, summary, full description, author, owner name/email, category, language, artwork, explicit flag, copyright, website, publishing status.  
**POD-03** Show detail includes episodes, RSS URL, RSS validation, distribution readiness, live destinations.  
**POD-04** Episode fields: show, title, slug, description/show notes, episode type, season/episode number, audio, MIME, file length, duration, publication timestamp, GUID, transcript, artwork and status.  
**POD-05** Draft, scheduled, processing, published, archived and failed workflows with valid transitions.  
**POD-06** Upload to existing object storage where practical; validate type/size, transcode asynchronously if needed; preserve originals and legacy paths.  
**POD-07** Mobile-ready player with play/pause, seek, speed, volume, share, keyboard controls and HTTP range requests.  
**POD-08** Safe RSS import: metadata-only or explicitly authorized audio mirror; idempotent by source identity/GUID; record source URL and sync errors.  
**POD-09** Editing episode metadata does not unexpectedly change GUID or break enclosure URL.

## 8. RSS publishing specification

Each show must expose a publicly reachable HTTPS RSS 2.0 feed containing required standard podcast metadata and per-episode enclosure. Include common podcast namespace tags as appropriate. Provide:

- Stable RSS URL; ideally preserve existing URL exactly. If impossible, use permanent redirect and documented feed migration process.
- Channel title, description, language, image, author/owner contact, category, explicit setting, self-link where applicable.
- Episode title, description, unique stable GUID, RFC 2822 publication date, enclosure `url`, `length` in bytes and valid `type`, duration, explicit and season/episode metadata as applicable.
- Audio enclosure reachable anonymously, with HTTPS, correct content type, reliable byte-range serving and stable access.
- XML escaping, encoding, safe content sanitation and deterministic output.
- RSS preview, copy link, validator result, health checks and actionable errors.
- ETag/Last-Modified or suitable caching and invalidation on publish/update.

**Critical:** A podcast show is generally the submission unit, not an individual episode. Once registered and accepted, compatible directories poll its RSS for future episodes. This does not guarantee instant propagation or platform acceptance.

## 9. Distribution Manager v2 — realistic capabilities

### 9.1 Modes

1. **Manual:** Operator opens official destination portal, registers/claims feed, completes verification, records evidence and public listing URL.
2. **Assisted:** Platform validates RSS, shows instructions, copies URL, opens official portal, generates checklist and tracks human completion. No unsupported browser automation.
3. **Integrated:** Only if an officially supported API/partnership is actually available, documented, authorized and tested. Gate behind adapter capability flags; do not simulate integration.
4. **Discovery/auto-index:** Some directories discover shows from other catalogs. Track as `DISCOVERY_PENDING` until independently verified; do not mark submitted or live automatically.

### 9.2 Initial free destination registry

| Destination | Default method | Special consideration |
|---|---|---|
| Spotify | Portal submission/claim of external RSS | Account and ownership verification may be required |
| Apple Podcasts | Podcasts Connect RSS submission | Account, ownership and review |
| Amazon Music | Podcaster portal | Portal availability/process may change |
| YouTube Music | RSS ingestion via YouTube Studio | May create static-image videos; account/channel setup required |
| Pocket Casts | Directory submission/discovery | Confirm current submission route |
| Podcast Index | Feed submission/indexing | Check catalog and public listing |
| Castbox | Claim/add podcast | Ownership verification may apply |
| Podcast Addict | RSS submission | Directory indexing time varies |
| Podchaser | Add/claim podcast | Directory-specific claim process |
| Overcast | Typically catalog discovery from Apple | Not necessarily a separate manual submission |

Registry must be editable by Super Admin. Store `platform_name`, `official_portal_url`, `help_url`, `method`, `account_required`, `verification_required`, `supports_api` (default false), `auto_discovery`, `last_verified_at`, `notes`, `enabled`. **The registry is a target list, not a promise of eligibility or successful free publication.** Verify current official terms and regional support during rollout.

### 9.3 Per-show × platform status machine

`NOT_STARTED → READY → SUBMITTED → PENDING_REVIEW → LIVE` with alternative `ACTION_REQUIRED`, `REJECTED`, `FAILED`, `DISCOVERY_PENDING`, `UNAVAILABLE`, `PAUSED`.

Rules:
- `LIVE` requires verified public external URL (manual evidence or authorized validation).
- `SUBMITTED` requires submission timestamp, actor and method.
- `PENDING_REVIEW` does not mean live.
- `FAILED` stores reason and retry/remediation notes.
- Status updates are auditable and cannot be silently overwritten by background jobs.
- A feed may be `READY` while a destination is `UNAVAILABLE` for that region/account.

### 9.4 Distribution UI

- Global overview: total shows, ready shows, submissions, live verified listings, failed/action required, coverage by platform and tenant.
- Show detail: readiness checklist, RSS link, official portal link, operator instructions, submission notes, account owner (no passwords), date, listing URL, proof and status timeline.
- Platform detail: all shows targeted at that directory, searchable by tenant/status.
- Bulk selection: choose many shows and targets; generate **individual work items** and checklists; optionally export CSV; do not falsely claim mass external submission.
- Deduplicate identical show/platform tasks and ensure idempotent retries.
- Account ownership/verification responsibility must be explicit for each platform.
- Add `last_verified_at`, `next_review_at` and `verification_method` to listing record.

### 9.5 Bulk distribution example

30 shows × 10 destinations = 300 **possible listing tasks**, not 300 accounts, guaranteed submissions or verified listings. A directory that auto-indexes from Apple may need only a verification task. Some platforms may limit eligibility or reject duplicates.

### 9.6 Out of scope for MVP

No fake API integration, no CAPTCHA bypass, no account creation bots, no mass uploads that violate platform terms, no automated verification-email interception, no guaranteed search/LLM ranking, no bulk cloning of identical episodes into many unrelated external shows.

## 10. Ten-theme system (one codebase)

All themes consume shared typed content contracts, player state, search, routes, analytics and SEO components. Theme differences must include layout/composition, navigation, hero, card treatment, typography and player presentation—not color alone.

| ID | Theme | Distinct composition |
|---|---|---|
| T01 | Stream Dark | Sidebar, horizontal shelves, sticky bottom player |
| T02 | Clean Editorial | Spacious editorial hero, curated grids, light UI |
| T03 | Newsroom | Dense headlines, multi-column sections, breaking/latest rail |
| T04 | Minimal | Sparse navigation, list-first layout, oversized type |
| T05 | Creator | Host profile hero, social links, show-led landing |
| T06 | Radio | Station-style player, schedule-like sections, live-inspired styling (no live audio promise) |
| T07 | Tech | Modular cards, modern grid, strong accent treatments |
| T08 | Business | Professional editorial hierarchy, topic hubs |
| T09 | Entertainment | High-energy artwork, bold cards, trending rails |
| T10 | Premium Magazine | Cover-story hero, long-form editorial blocks |

Requirements:
- Central theme registry, tokens and per-tenant config.
- Shared public routes: `/`, `/podcasts`, `/podcast/:slug`, `/episode/:slug` (adapt to legacy route map), `/categories`, `/search`, optional `/hosts`.
- Responsive desktop/tablet/mobile; WCAG-conscious controls.
- One fully working reference theme first, then other nine using stable contracts.
- Visual regression snapshots for each theme and major page type.
- Theme switching must not change podcast IDs, GUIDs, RSS URLs or database ownership.

## 11. Public SEO and discoverability

- Per-tenant title/meta/Open Graph, XML sitemaps and robots policy.
- Podcast and episode structured data only where accurate and valid; do not assume special rich-result eligibility.
- Transcript and show notes optional but encouraged, with rights review.
- Slug-change redirects and preservation of indexed legacy URLs.
- Canonical policy for internal syndication; avoid duplicated thin pages across many domains.
- Public site should not claim external platform presence before verified.
- Publishing to many directories does not guarantee backlinks, rankings, indexing or LLM citations.

## 12. Analytics and observability

MVP: plays, page views, top shows/episodes, tenant-level reporting, basic referrers and distribution funnel. Distinguish first-party player analytics from **external listening data**, which may not be available without separate platform access/API. Track events with privacy-conscious retention and deduplication. Include API errors, feed generation failures, audio processing, queue health, storage errors, submission task aging and failed validations.

## 13. Target schema — logical model, not a forced migration

The agent must map these concepts onto the **existing** schema first:

- `tenants`, `domains`, `tenant_memberships`, `tenant_settings`
- `themes` or static theme registry + tenant theme configuration
- `podcasts` / `shows`, `episodes`, `media_assets`, `hosts`, `categories`
- `tenant_podcasts` (only if shared-library syndication is needed)
- `rss_sources`, `rss_sync_runs`, `rss_health_checks`
- `distribution_platforms`, `distribution_listings`, `distribution_tasks`, `distribution_events`
- `analytics_events` or aggregate tables
- `audit_logs`, `redirects`

Suggested distribution listing fields:

```text
id, tenant_id, podcast_id, platform_id, status, method,
external_url, external_id, account_label, submitted_by,
submitted_at, reviewed_at, verified_at, verification_method,
notes, error_code, error_message, created_at, updated_at
```

Unique constraint on `(podcast_id, platform_id, account_context)` or a documented equivalent. Do not assume `tenant_id` is the ownership key if the show is globally shared; document whether listing belongs to canonical show or tenant-specific feed.

## 14. API contracts — adapt to existing routes

The exact path scheme may change after audit. Required capabilities:

```text
GET/POST        tenants
GET/PATCH       tenants/{id}
POST            domains/verify
GET/POST        podcasts
GET/PATCH       podcasts/{id}
GET/POST        podcasts/{id}/episodes
POST            episodes/{id}/publish
GET             podcasts/{id}/rss/health
GET             podcasts/{id}/distribution
POST            podcasts/{id}/distribution/tasks
PATCH           distribution/listings/{id}
POST            distribution/bulk-tasks
GET             distribution/platforms
GET             analytics/overview
```

Use existing auth, pagination and error conventions if sound. All write APIs enforce RBAC, tenant authorization, validation, idempotency where needed, and audit events. No secret credentials in browser-visible payloads.

## 15. Data migration and backward compatibility

### Golden rules

1. Snapshot database and media inventory; test restore **before** changing schema.
2. Prefer additive schema changes and feature flags; avoid destructive migrations.
3. Preserve legacy primary keys where feasible; otherwise maintain a durable mapping table.
4. Preserve published episode GUIDs, RSS URLs and media enclosure URLs.
5. Preserve existing external directory listings and account ownership data.
6. Never overwrite manual distribution status with guessed auto-discovery results.
7. Preserve user accounts, passwords/hashes, sessions where possible, roles, site settings and SEO redirects.
8. Use repeatable/idempotent backfill scripts with dry-run and reconciliation reports.
9. Plan rollback before each cutover; verify actual rollback in staging.
10. Do not remove old routes or tables until traffic/data compatibility is proven and signed off.

### Migration stages

**M0 Inventory:** Baseline counts, backups, route/feed mapping, tests.  
**M1 Additive schema:** Add missing associations and registry tables without breaking legacy reads.  
**M2 Backfill:** Map existing websites/shows/episodes and distribution records; produce row-count and checksum reconciliation.  
**M3 Compatibility adapters:** Preserve old APIs/URLs while introducing new contracts.  
**M4 Feature-flagged rollout:** Enable new admin/distribution flows for internal test tenant.  
**M5 Theme rollout:** One reference theme, then remaining nine; preserve existing theme until validated.  
**M6 Cutover:** Gradual tenant-by-tenant switch with monitoring and rollback window.  
**M7 Cleanup:** Remove deprecated code only after evidence and explicit approval.

### Rollback triggers

Broken existing RSS feeds, changed GUIDs, audio 404s, unauthorized tenant access, elevated error rates, failed backfill reconciliation, or major regression in production routes. Immediately disable feature flag/restore routing and follow documented database rollback strategy (avoid destructive down-migrations if new writes exist).

## 16. QA test matrix and acceptance gates

### Critical end-to-end scenarios

1. Existing site, existing show, existing episode and old RSS continue to work after deploy.
2. New tenant/domain resolves correctly and is isolated from other tenants.
3. One tenant creates 30 shows, each with unique stable feed and multiple episodes.
4. Create new episode: RSS updates; GUID remains stable; audio streams on desktop/mobile.
5. Submit one show to a manual target: `READY → SUBMITTED → PENDING_REVIEW → LIVE` only after verified URL.
6. Bulk select 30 shows × 10 destinations: generate 300 or fewer deduplicated work items; no false external submissions.
7. Auto-index target stays pending until evidence of external listing.
8. Switch theme without modifying RSS, public audio URLs or show identity.
9. Tenant A cannot view or modify Tenant B data via UI, API, worker or guessed IDs.
10. Legacy URL changes redirect correctly; sitemap/canonical remains accurate.
11. Queue retry does not duplicate episodes, submissions or analytics.
12. Production restore rehearsal recovers podcast metadata, user permissions and media references.

### Definition of done

- Phase 0 audit and migration artifacts exist and match actual code.
- No unresolved P0/P1 defects or tenant isolation violations.
- Core show/episode/feed and admin flows pass automated tests.
- All ten themes pass route, responsiveness and visual checks.
- RSS validated against selected destination requirements with a real test show.
- Distribution dashboard truthfully distinguishes tasks, submitted, pending and verified live.
- Legacy compatibility report and data reconciliation signed off.
- Deployment runbook, backup/restore procedure, monitoring and rollback documented.

## 17. Implementation priority

| Priority | Workstream | Outcome |
|---|---|---|
| P0 | Audit + backup + compatibility map | Know what exists; no blind rewrite |
| P0 | Tenant/show/episode relationship correction | Many shows per website |
| P0 | RSS stability and validator | Real usable feeds |
| P0 | Distribution registry + manual/assisted workflow | Accurate free-platform submission process |
| P0 | Existing data migration and regression tests | No lost content or broken links |
| P1 | Bulk task management | Efficient many-show operations |
| P1 | One reference theme + 9 themes | Multi-domain branding |
| P1 | RSS importer and sync | Bring external feeds safely |
| P1 | Analytics and health checks | Operability |
| P2 | Approved API integrations, if available | Selective automation |
| P2 | AI transcripts/metadata | Optional productivity enhancements |

## 18. Agent operating instructions

1. **Read the existing codebase first.** Never assume it is empty or uses Next.js/Go/PostgreSQL.
2. Write Phase 0 deliverables, then propose exact file/schema changes with risk ratings.
3. Ask for approval before destructive schema changes, production cutovers or replacement of core infrastructure.
4. Implement in small, reviewable phases with migrations, tests and rollback notes.
5. Reuse functioning modules and existing design assets wherever possible.
6. Do not hardcode platform statuses or fake external submission success.
7. Do not store external platform passwords; support operator notes and secure account references instead.
8. Respect official submission workflows and platform terms; never bypass verification/CAPTCHA.
9. Test real RSS feeds, public audio URLs, and external listing URLs where authorized.
10. At every milestone, report **existing behavior preserved / new behavior delivered / outstanding blockers / tests / rollback**.

### Initial agent prompt

> You are refactoring an existing podcast platform, not creating a new app. Read `PRD_v2_Podcast_Platform_Refactor.md` and inspect the entire repository, database migrations, route map and deployment configuration. First produce `LEGACY_SYSTEM_AUDIT.md`, `GAP_ANALYSIS.md`, `DEPENDENCY_MAP.md`, `MIGRATION_PLAN.md`, and `URL_AND_RSS_COMPATIBILITY.md`. Do not implement or delete anything until these are complete. Prioritize preserving current data and working functionality. Then propose the smallest safe sequence to support many shows per tenant, stable per-show RSS, a truthful manual/assisted Distribution Manager, bulk distribution work items, and ten distinct themes within one codebase. Explicitly identify unknowns and request approval for destructive changes.

## 19. Product decisions requiring owner confirmation

- Are domains exclusively owned/operated internally, or will clients administer their own tenants?
- Does each domain host distinct shows, shared licensed shows, or both?
- Is the main workflow **one show → many directories**, **many shows → many directories**, or **one audio item → many shows**? The latter is a separate content replication requirement and is not assumed.
- Who owns and verifies external directory accounts (central team or each client)?
- Which existing app features are non-negotiable to preserve?
- What are the existing repository URL, stack, database and deployment environment?
- What are the initial 10 free targets after live validation of eligibility in the operating region?

Until answered, implement the flexible data model and assisted workflows without inventing external automation.

---

**Final principle:** *Preserve what works. One engine, many websites, many shows per website, one stable feed per show, many external directory targets, and truthful distribution tracking.*
