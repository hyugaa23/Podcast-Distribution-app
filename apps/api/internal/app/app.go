// Package app contains the shared business logic used by both the HTTP API and
// background workers: tenant resolution, publishing, feeds, distribution,
// notifications, auditing and cache invalidation.
package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"podcast/api/internal/authn"
	"podcast/api/internal/cache"
	"podcast/api/internal/config"
	"podcast/api/internal/db"
	"podcast/api/internal/media"
	"podcast/api/internal/queue"
	"podcast/api/internal/storage"
	"podcast/api/internal/util"
)

type App struct {
	Cfg     *config.Config
	DB      *pgxpool.Pool
	Redis   *redis.Client
	Cache   *cache.Cache
	Queue   *queue.Queue
	Storage storage.Storage
	Media   media.Tool
	Signer  *authn.Signer
	Log     *slog.Logger
	HTTP    *http.Client // SSRF-safe client for user-supplied URLs
}

// New wires all infrastructure dependencies.
func New(ctx context.Context, cfg *config.Config, log *slog.Logger) (*App, error) {
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("database: %w", err)
	}
	if err := db.Migrate(ctx, pool); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}

	opt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return nil, fmt.Errorf("REDIS_URL: %w", err)
	}
	rdb := redis.NewClient(opt)
	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis: %w", err)
	}

	st, err := storage.New(ctx, storage.Config{
		Driver: cfg.StorageDriver, LocalDir: cfg.StorageLocalDir, Endpoint: cfg.S3Endpoint, Bucket: cfg.S3Bucket,
		AccessKey: cfg.S3AccessKey, SecretKey: cfg.S3SecretKey, Region: cfg.S3Region, UseSSL: cfg.S3UseSSL,
		PathStyle: cfg.S3PathStyle, CDNURL: cfg.CDNURL,
	})
	if err != nil {
		return nil, fmt.Errorf("storage: %w", err)
	}

	return &App{
		Cfg:     cfg,
		DB:      pool,
		Redis:   rdb,
		Cache:   cache.New(rdb),
		Queue:   queue.New(rdb),
		Storage: st,
		Media:   media.Tool{FFmpeg: cfg.FFmpegPath, FFprobe: cfg.FFprobePath},
		Signer:  authn.NewSigner(cfg.JWTSecret, cfg.AccessTokenTTL),
		Log:     log,
		HTTP:    util.SafeHTTPClient(60*time.Second, cfg.AllowPrivateFetch),
	}, nil
}

func (a *App) Close() {
	a.DB.Close()
	a.Redis.Close()
}

// ---------------------------------------------------------------------------
// Jobs

// Enqueue pushes a job to the Redis queue and records it in job_runs for observability.
func (a *App) Enqueue(ctx context.Context, typ string, payload any, opt queue.Options) (string, error) {
	job, err := a.Queue.Enqueue(ctx, typ, payload, opt)
	if errors.Is(err, queue.ErrDuplicate) {
		return "", nil
	}
	if err != nil {
		a.SysLog(ctx, "error", "queue", "Failed to enqueue "+typ, err.Error(), nil)
		return "", err
	}
	var tid *int64
	if opt.TenantID != 0 {
		tid = &opt.TenantID
	}
	a.DB.Exec(ctx, `INSERT INTO job_runs(id, type, payload, status, tenant_id) VALUES ($1,$2,$3,'QUEUED',$4)`,
		job.ID, typ, job.Payload, tid)
	return job.ID, nil
}

// ---------------------------------------------------------------------------
// Notifications (PRD §98) and webhooks (PRD §105)

func (a *App) Notify(ctx context.Context, tenantID *int64, typ, severity, title, message, link string) {
	_, err := a.DB.Exec(ctx, `INSERT INTO notifications(tenant_id, type, severity, title, message, link)
		VALUES ($1,$2,$3,$4,$5,$6)`, tenantID, typ, severity, title, message, link)
	if err != nil {
		a.Log.Error("notify failed", "err", err)
	}
}

// EmitWebhook queues delivery of event to every active webhook subscribed by the tenant (or global hooks).
func (a *App) EmitWebhook(ctx context.Context, tenantID *int64, event string, data any) {
	rows, err := a.DB.Query(ctx, `SELECT id FROM webhooks WHERE is_active AND $1 = ANY(events)
		AND (tenant_id IS NULL OR ($2::bigint IS NOT NULL AND tenant_id = $2))`, event, tenantID)
	if err != nil {
		return
	}
	ids, _ := pgx.CollectRows(rows, pgx.RowTo[int64])
	for _, id := range ids {
		a.Enqueue(ctx, queue.DeliverWebhook, map[string]any{
			"webhook_id": id, "event": event, "data": data, "occurred_at": time.Now().UTC(),
		}, queue.Options{MaxAttempts: 5})
	}
}

// ---------------------------------------------------------------------------
// Audit log (PRD §78)

type AuditEntry struct {
	UserID       *int64
	UserEmail    string
	Action       string
	ResourceType string
	ResourceID   any
	TenantID     *int64
	IP           string
	UserAgent    string
	Changes      any
}

func (a *App) Audit(ctx context.Context, e AuditEntry) {
	changes, _ := json.Marshal(e.Changes)
	if e.Changes == nil {
		changes = []byte("{}")
	}
	_, err := a.DB.Exec(ctx, `INSERT INTO audit_logs(user_id,user_email,action,resource_type,resource_id,tenant_id,ip,user_agent,changes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		e.UserID, e.UserEmail, e.Action, e.ResourceType, fmt.Sprint(e.ResourceID), e.TenantID, e.IP, e.UserAgent, changes)
	if err != nil {
		a.Log.Error("audit failed", "err", err)
	}
}

// SysLog records an internal technical event for observability (PRD §79, §80).
func (a *App) SysLog(ctx context.Context, level, source, message, detail string, tenantID *int64) {
	switch level {
	case "error", "critical":
		a.Log.Error(message, "source", source, "detail", detail)
	case "warning":
		a.Log.Warn(message, "source", source, "detail", detail)
	default:
		a.Log.Info(message, "source", source)
	}
	a.DB.Exec(context.WithoutCancel(ctx), `INSERT INTO system_logs(level, source, message, detail, tenant_id) VALUES ($1,$2,$3,$4,$5)`,
		level, source, message, util.Truncate(detail, 8000), tenantID)
}

// ---------------------------------------------------------------------------
// Cache invalidation (PRD §85: RSS updated → sitemap updated → cache purged)

func tenantPrefix(id int64) string { return fmt.Sprintf("t:%d:", id) }

// InvalidateTenant purges every cached public payload for a tenant and asks the web app to revalidate.
func (a *App) InvalidateTenant(ctx context.Context, tenantID int64) {
	a.Cache.DelPrefix(ctx, tenantPrefix(tenantID))
	a.Enqueue(ctx, queue.InvalidateCache, map[string]any{"tenant_id": tenantID},
		queue.Options{UniqueKey: fmt.Sprintf("inv:%d", tenantID), UniqueTTL: 5 * time.Second, Delay: time.Second})
}

// InvalidateDomains drops cached domain resolutions for a tenant.
func (a *App) InvalidateDomains(ctx context.Context, tenantID int64) {
	rows, err := a.DB.Query(ctx, `SELECT domain FROM domains WHERE tenant_id=$1`, tenantID)
	if err == nil {
		names, _ := pgx.CollectRows(rows, pgx.RowTo[string])
		for _, n := range names {
			a.Cache.Del(ctx, "domain:"+n)
		}
	}
	a.InvalidateTenant(ctx, tenantID)
}

// TenantsShowingPodcast returns every tenant on which the podcast can appear.
func (a *App) TenantsShowingPodcast(ctx context.Context, podcastID int64) []int64 {
	rows, err := a.DB.Query(ctx, `
		SELECT tenant_id FROM tenant_podcasts WHERE podcast_id=$1
		UNION SELECT owner_tenant_id FROM podcasts WHERE id=$1 AND owner_tenant_id IS NOT NULL
		UNION SELECT t.id FROM tenants t, podcasts p WHERE p.id=$1 AND p.owner_tenant_id IS NULL AND t.content_mode='SHARED'`, podcastID)
	if err != nil {
		return nil
	}
	ids, _ := pgx.CollectRows(rows, pgx.RowTo[int64])
	return ids
}

// InvalidatePodcast purges caches (homepage, feed, pages) of every tenant showing the podcast,
// and schedules sitemap regeneration.
func (a *App) InvalidatePodcast(ctx context.Context, podcastID int64) {
	for _, tid := range a.TenantsShowingPodcast(ctx, podcastID) {
		a.InvalidateTenant(ctx, tid)
		a.Enqueue(ctx, queue.GenerateSitemap, map[string]any{"tenant_id": tid},
			queue.Options{UniqueKey: fmt.Sprintf("sitemap:%d", tid), UniqueTTL: 30 * time.Second, Delay: 2 * time.Second})
	}
	a.Cache.DelPrefix(ctx, fmt.Sprintf("feed:%d:", podcastID))
}

// ---------------------------------------------------------------------------
// Settings

// SystemSetting loads a JSON system setting into dst; returns false if not set.
func (a *App) SystemSetting(ctx context.Context, key string, dst any) bool {
	var raw []byte
	if err := a.DB.QueryRow(ctx, `SELECT value FROM system_settings WHERE key=$1`, key).Scan(&raw); err != nil {
		return false
	}
	return json.Unmarshal(raw, dst) == nil
}

// TenantLocation returns the tenant's time.Location (fallback UTC).
func (a *App) TenantLocation(ctx context.Context, tenantID *int64) *time.Location {
	if tenantID == nil {
		return time.UTC
	}
	var tz string
	if err := a.DB.QueryRow(ctx, `SELECT timezone FROM tenants WHERE id=$1`, *tenantID).Scan(&tz); err != nil {
		return time.UTC
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return time.UTC
	}
	return loc
}

// SiteBaseURL returns the https base URL for a tenant's primary domain.
func (a *App) SiteBaseURL(ctx context.Context, tenantID int64) string {
	var domain, canonical string
	a.DB.QueryRow(ctx, `SELECT COALESCE((SELECT domain FROM domains WHERE tenant_id=$1 AND is_primary LIMIT 1),
		(SELECT domain FROM domains WHERE tenant_id=$1 ORDER BY id LIMIT 1), ''),
		COALESCE((SELECT canonical_domain FROM seo_settings WHERE tenant_id=$1), '')`, tenantID).Scan(&domain, &canonical)
	if canonical != "" {
		domain = canonical
	}
	return a.BaseURLForHost(domain)
}

// BaseURLForHost builds a site URL; local development hosts use http.
func (a *App) BaseURLForHost(host string) string {
	host = strings.TrimSpace(host)
	if host == "" {
		return a.Cfg.WebInternalURL
	}
	if strings.HasPrefix(host, "http://") || strings.HasPrefix(host, "https://") {
		return strings.TrimRight(host, "/")
	}
	if IsLocalHost(host) {
		port := ""
		if i := strings.LastIndex(a.Cfg.WebInternalURL, ":"); i > 6 {
			port = a.Cfg.WebInternalURL[i:]
		}
		return "http://" + host + port
	}
	port := ""
	if a.Cfg.PublicSitePort != "" {
		port = ":" + a.Cfg.PublicSitePort
	}
	return a.Cfg.PublicSiteScheme + "://" + host + port
}

// IsLocalHost reports whether host is a development-only hostname.
func IsLocalHost(host string) bool {
	h := util.NormalizeHost(host)
	return h == "localhost" || strings.HasSuffix(h, ".localhost") || strings.HasSuffix(h, ".test") ||
		strings.HasSuffix(h, ".local") || h == "127.0.0.1"
}
