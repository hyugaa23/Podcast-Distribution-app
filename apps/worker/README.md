# Worker

The worker binary is built from the shared Go module in `apps/api` (`go run ./cmd/worker`), so all
business logic is shared with the API.

It consumes the Redis queue:
`PROCESS_AUDIO`, `PROCESS_IMAGE`, `IMPORT_RSS`, `SYNC_RSS`, `MIRROR_AUDIO`, `GENERATE_TRANSCRIPT`,
`REFRESH_DISTRIBUTION`, `GENERATE_SITEMAP`, `PUBLISH_SCHEDULED`, `AGGREGATE_ANALYTICS`, `INVALIDATE_CACHE`,
`CHECK_DOMAIN`, `RSS_HEALTH_CHECK`, `DELIVER_WEBHOOK`.

It also runs the scheduler (cron): scheduled publishing (tenant timezone), automatic RSS sync, analytics
aggregation, RSS health checks, distribution status refresh, domain DNS/SSL checks, sitemap regeneration,
storage warnings and data retention cleanup. Cron tasks take a Redis lock, so several worker replicas can run.

Docker: `docker build -f apps/worker/Dockerfile .` (from the repo root).
