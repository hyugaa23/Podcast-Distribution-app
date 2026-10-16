# Migration Plan: PRD v2 Distribution Manager Refactor

**Date:** 2026-10-14
**Strategy:** Incremental, zero-downtime migrations. Each milestone is independently deployable.

## Milestone Overview

| Phase | Name | Dependencies | Estimated Effort |
|-------|------|-------------|-----------------|
| M0 | Database schema (0003) | None | Done |
| M1 | API distribution enhancements | M0 | 2 days |
| M2 | Admin distribution wizard UI | M1 | 3 days |
| M3 | Auto-discovery & polling worker | M1 | 2 days |
| M4 | Platform API integrations | M1, M3 | 3 days |
| M5 | Analytics enhancements | None (parallel) | 2 days |
| M6 | Verification flow | M2 | 2 days |
| M7 | Polish & documentation | M1-M6 | 1 day |

## M0: Database Schema (COMPLETED)

Migration `0003_distribution_v2.sql` already applied:
- Extended podcast_distributions status constraint (4 new statuses)
- Added 7 columns to platforms (help_url, account_required, etc.)
- Added 6 columns to podcast_distributions (account_label, method, etc.)
- Seeded 10 default platforms with Indonesian-language instructions

**Rollback:** Each ALTER uses `ADD COLUMN IF NOT EXISTS`; seed uses `ON CONFLICT DO NOTHING`. Safe to re-run.

## M1: API Distribution Enhancements

**Goal:** Wire new DB fields into existing API handlers.

### Tasks
1. Update `internal/app/distribution.go`:
   - Include new platform fields in queries (help_url, account_required, etc.)
   - Include new distribution fields in queries (method, submitted_by, etc.)
   - Add `UpdateDistributionStatus()` to handle new status transitions
   - Validate status transitions (e.g., NOT_STARTED -> READY -> SUBMITTED -> PENDING)

2. Update `internal/api/distribution.go`:
   - Extend list/detail responses with new fields
   - Add `next_review_at` to response for PENDING_REVIEW items
   - Add method field to POST /distribution/{podcastID}/{platform}
   - Return enriched platform info (help_url, account_required, etc.)

3. Update `internal/app/models.go`:
   - Add structs/constants for new distribution method types
   - Add status transition validation map

4. Add readiness check enhancements:
   - Validate RSS feed accessibility before allowing SUBMITTED status
   - Check minimum episode count per platform requirements

**Rollback:** API changes are additive (new fields in responses). Old admin versions ignore unknown fields.

## M2: Admin Distribution Wizard UI

**Goal:** Replace basic distribution page with step-by-step submission wizard.

### Tasks
1. Create wizard component at `apps/admin/app/distribution/[podcastId]/wizard/`:
   - Step 1: Pre-flight checks (RSS valid, episodes published, artwork present)
   - Step 2: Platform selection with requirement badges
   - Step 3: Per-platform instructions with copy-paste RSS URL
   - Step 4: Status update form (external URL, external ID, account label)
   - Step 5: Confirmation + next platform suggestion

2. Update `apps/admin/app/distribution/[podcastId]/page.tsx`:
   - Add "Start Wizard" button linking to wizard
   - Show new status badges (PENDING_REVIEW, DISCOVERY_PENDING, etc.)
   - Display method column (MANUAL/CLAIM/INDEXED/API)
   - Show next_review_at countdown for PENDING_REVIEW items

3. Update `apps/admin/app/distribution/page.tsx`:
   - Add progress bar per podcast (% of platforms LIVE)
   - Filter by new statuses
   - Sort by next_review_at for items needing attention

4. Update `apps/admin/app/distribution/platforms/page.tsx`:
   - Show new platform fields (account_required, verification_required, etc.)
   - Display help_url as clickable link

**Rollback:** UI-only changes. Revert admin deploy to previous build.

## M3: Auto-Discovery & Polling Worker

**Goal:** Automatically check if podcasts appear on auto-discovery platforms.

### Tasks
1. Add worker handler for auto-discovery polling:
   - New job type `CHECK_AUTO_DISCOVERY`
   - For platforms with `auto_discovery=true`, periodically search for podcast
   - Update distribution status to LIVE when discovered
   - Log distribution_event on status change

2. Update scheduler in `internal/worker/worker.go`:
   - Add cron entry for auto-discovery checks (every 12 hours)
   - Query distributions with status DISCOVERY_PENDING on auto_discovery platforms

3. Add discovery check logic:
   - Overcast: check if Apple Podcasts listing exists (prerequisite)
   - Generic: HTTP HEAD check on expected URL pattern

**Rollback:** Remove job type from handlers map. Stale DISCOVERY_PENDING records remain valid.

## M4: Platform API Integrations

**Goal:** Integrate with platforms that support programmatic submission.

### Tasks
1. Podcast Index API integration:
   - Implement `internal/app/podcastindex.go`
   - Use Podcast Index API to submit/check RSS feeds
   - Wire into SUBMIT_DISTRIBUTION handler for podcastindex platform

2. Add API submission flow:
   - When platform.supports_api=true, offer "Submit via API" in wizard
   - Auto-set method=API on successful API submission
   - Track API response in distribution_events

**Rollback:** Feature-flagged via platform.supports_api field. Set to false to disable.

## M5: Analytics Enhancements (Parallel Track)

**Goal:** Add per-episode and geographic breakdown APIs.

### Tasks
1. Add `GET /api/analytics/episodes/{id}` for per-episode breakdown
2. Add `GET /api/analytics/geo` for geographic distribution
3. Add `GET /api/analytics/devices` for device/browser breakdown
4. Create admin analytics sub-pages for the above

**Rollback:** Additive API endpoints. Remove admin pages to revert UI.

## M6: Verification Flow

**Goal:** Guide users through platform verification (email codes, DNS, etc.).

### Tasks
1. Add verification UI in wizard Step 4:
   - Email code entry for Spotify/YouTube verification
   - Status polling while waiting for platform approval
   - Manual "Mark as Verified" with evidence upload

2. Update distribution record:
   - Set verified_at on successful verification
   - Set verification_method based on platform requirements

**Rollback:** UI-only. Falls back to manual status updates.

## M7: Polish & Documentation

### Tasks
1. Update admin help text and tooltips for new fields
2. Add platform instruction translations (English fallback)
3. Verify all status transitions render correctly
4. End-to-end test: create podcast -> publish -> submit to all 10 platforms
5. Update API documentation

## Deployment Sequence

```
M0 (done) -> M1 (deploy API) -> M2 (deploy admin) -> M3 (deploy worker)
                                                   \-> M4 (deploy API+worker)
M5 can run in parallel with M1-M4
M6 after M2
M7 after all
```

Each milestone: deploy to VPS Teak via `systemctl restart` of affected services. No Docker rebuild needed.
