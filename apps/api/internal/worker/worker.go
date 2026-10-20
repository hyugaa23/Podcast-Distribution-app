// Package worker runs background jobs (PRD §72): audio processing, RSS import/sync,
// distribution status, image processing, analytics aggregation, sitemap generation
// and cache invalidation, plus the cron scheduler.
package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"podcast/api/internal/app"
	"podcast/api/internal/queue"
)

type Worker struct {
	App         *app.App
	ID          string
	Concurrency int
}

type handler func(ctx context.Context, a *app.App, job *queue.Job) error

func payload[T any](job *queue.Job) (T, error) {
	var v T
	err := json.Unmarshal(job.Payload, &v)
	return v, err
}

var handlers = map[string]handler{
	queue.ProcessAudio: func(ctx context.Context, a *app.App, j *queue.Job) error {
		p, err := payload[struct {
			AudioFileID int64 `json:"audio_file_id"`
		}](j)
		if err != nil {
			return err
		}
		return a.ProcessAudio(ctx, p.AudioFileID)
	},
	queue.ProcessImage: func(ctx context.Context, a *app.App, j *queue.Job) error {
		p, err := payload[struct {
			ImageID int64 `json:"image_id"`
		}](j)
		if err != nil {
			return err
		}
		return a.ProcessImage(ctx, p.ImageID)
	},
	queue.ImportRSS: syncRSS,
	queue.SyncRSS:   syncRSS,
	queue.MirrorAudio: func(ctx context.Context, a *app.App, j *queue.Job) error {
		p, err := payload[struct {
			EpisodeID int64  `json:"episode_id"`
			URL       string `json:"url"`
		}](j)
		if err != nil {
			return err
		}
		return a.MirrorEpisodeAudio(ctx, p.EpisodeID, p.URL)
	},
	queue.GenerateTranscript: func(ctx context.Context, a *app.App, j *queue.Job) error {
		p, err := payload[struct {
			EpisodeID int64 `json:"episode_id"`
		}](j)
		if err != nil {
			return err
		}
		return a.GenerateTranscript(ctx, p.EpisodeID)
	},
	queue.RefreshDistribution: func(ctx context.Context, a *app.App, j *queue.Job) error {
		p, err := payload[struct {
			DistributionID int64 `json:"distribution_id"`
		}](j)
		if err != nil {
			return err
		}
		return a.RefreshDistribution(ctx, p.DistributionID)
	},
	queue.SubmitDistribution: func(ctx context.Context, a *app.App, j *queue.Job) error {
		p, err := payload[struct {
			PodcastID  int64 `json:"podcast_id"`
			PlatformID int64 `json:"platform_id"`
		}](j)
		if err != nil {
			return err
		}
		return a.SubmitDistribution(ctx, p.PodcastID, p.PlatformID)
	},
	queue.GenerateSitemap: func(ctx context.Context, a *app.App, j *queue.Job) error {
		p, err := payload[struct {
			TenantID int64 `json:"tenant_id"`
		}](j)
		if err != nil {
			return err
		}
		return a.GenerateSitemaps(ctx, p.TenantID)
	},
	queue.PublishScheduled: func(ctx context.Context, a *app.App, j *queue.Job) error {
		_, err := a.PublishDue(ctx)
		return err
	},
	queue.AggregateAnalytics: func(ctx context.Context, a *app.App, j *queue.Job) error {
		return a.AggregateAnalytics(ctx, 2)
	},
	queue.InvalidateCache: func(ctx context.Context, a *app.App, j *queue.Job) error {
		p, err := payload[struct {
			TenantID int64 `json:"tenant_id"`
		}](j)
		if err != nil {
			return err
		}
		if err := a.RevalidateWeb(ctx, p.TenantID); err != nil {
			a.Log.Warn("web revalidation failed (web app may be offline)", "tenant", p.TenantID, "err", err)
		}
		return nil
	},
	queue.CheckDomain: func(ctx context.Context, a *app.App, j *queue.Job) error {
		p, err := payload[struct {
			DomainID int64 `json:"domain_id"`
		}](j)
		if err != nil {
			return err
		}
		return a.CheckDomain(ctx, p.DomainID)
	},
	queue.RSSHealthCheck: func(ctx context.Context, a *app.App, j *queue.Job) error {
		p, err := payload[struct {
			PodcastID int64 `json:"podcast_id"`
		}](j)
		if err != nil {
			return err
		}
		h, err := a.CheckRSSHealth(ctx, p.PodcastID)
		if err == nil && h.Status == "CRITICAL" {
			var owner *int64
			a.DB.QueryRow(ctx, `SELECT owner_tenant_id FROM podcasts WHERE id=$1`, p.PodcastID).Scan(&owner)
			a.Notify(ctx, owner, "rss.error", "error", "RSS error", fmt.Sprintf("Feed health is CRITICAL for podcast #%d", p.PodcastID),
				fmt.Sprintf("/podcasts/%d/rss", p.PodcastID))
		}
		return err
	},
	queue.DeliverWebhook: func(ctx context.Context, a *app.App, j *queue.Job) error {
		p, err := payload[struct {
			WebhookID  int64     `json:"webhook_id"`
			Event      string    `json:"event"`
			Data       any       `json:"data"`
			OccurredAt time.Time `json:"occurred_at"`
		}](j)
		if err != nil {
			return err
		}
		return a.DeliverWebhook(ctx, p.WebhookID, p.Event, p.Data, p.OccurredAt)
	},
}

func syncRSS(ctx context.Context, a *app.App, j *queue.Job) error {
	p, err := payload[struct {
		SourceID int64 `json:"rss_source_id"`
	}](j)
	if err != nil {
		return err
	}
	_, err = a.SyncRSSSource(ctx, p.SourceID)
	return err
}

// Run starts consumers and the scheduler until ctx is cancelled.
func (w *Worker) Run(ctx context.Context) error {
	if w.ID == "" {
		host, _ := os.Hostname()
		w.ID = host
	}
	if n, err := w.App.Queue.Recover(ctx, w.ID); err == nil && n > 0 {
		w.App.Log.Info("recovered in-flight jobs", "count", n)
	}
	var wg sync.WaitGroup
	for i := 0; i < max(w.Concurrency, 1); i++ {
		wg.Add(1)
		go func(slot int) {
			defer wg.Done()
			w.consume(ctx, fmt.Sprintf("%s-%d", w.ID, slot))
		}(i)
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		w.schedule(ctx)
	}()
	w.App.Log.Info("worker started", "id", w.ID, "concurrency", w.Concurrency)
	wg.Wait()
	return nil
}

func (w *Worker) consume(ctx context.Context, slotID string) {
	w.App.Queue.Recover(ctx, slotID)
	for ctx.Err() == nil {
		job, raw, err := w.App.Queue.Reserve(ctx, slotID, 2*time.Second)
		if err != nil {
			if ctx.Err() == nil {
				w.App.Log.Error("queue reserve failed", "err", err)
				time.Sleep(2 * time.Second)
			}
			continue
		}
		if job == nil {
			continue
		}
		w.execute(ctx, slotID, job, raw)
	}
}

func (w *Worker) execute(ctx context.Context, slotID string, job *queue.Job, raw []byte) {
	a := w.App
	h, ok := handlers[job.Type]
	if !ok {
		a.SysLog(ctx, "error", "worker", "Unknown job type "+job.Type, string(job.Payload), nil)
		a.Queue.Ack(ctx, slotID, job, raw)
		return
	}
	a.DB.Exec(ctx, `INSERT INTO job_runs(id, type, payload, status, attempts, started_at) VALUES ($1,$2,$3,'RUNNING',$4,now())
		ON CONFLICT (id) DO UPDATE SET status='RUNNING', attempts=$4, started_at=now()`, job.ID, job.Type, job.Payload, job.Attempts+1)
	start := time.Now()
	jctx, cancel := context.WithTimeout(ctx, 2*time.Hour)
	err := func() (err error) {
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("panic: %v", r)
			}
		}()
		return h(jctx, a, job)
	}()
	cancel()
	if err == nil {
		a.Queue.Ack(ctx, slotID, job, raw)
		a.DB.Exec(ctx, `UPDATE job_runs SET status='SUCCEEDED', error='', finished_at=now() WHERE id=$1`, job.ID)
		a.Log.Info("job done", "type", job.Type, "id", job.ID, "ms", time.Since(start).Milliseconds())
		return
	}
	retrying := a.Queue.Retry(ctx, slotID, job, raw)
	status := "FAILED"
	if retrying {
		status = "RETRYING"
	}
	a.DB.Exec(ctx, `UPDATE job_runs SET status=$2, error=$3, finished_at=now() WHERE id=$1`, job.ID, status, err.Error())
	level := "warning"
	if !retrying {
		level = "error"
	}
	var tid *int64
	if job.TenantID != 0 {
		tid = &job.TenantID
	}
	a.SysLog(ctx, level, "worker", fmt.Sprintf("Job %s failed (attempt %d/%d)", job.Type, job.Attempts, job.MaxAttempts), err.Error(), tid)
}

// schedule is the cron component: scheduled publishing, RSS sync, analytics, health checks.
func (w *Worker) schedule(ctx context.Context) {
	a := w.App
	type cronCfg struct {
		RSSHealthHours  int `json:"rss_health_hours"`
		DistRefreshHrs  int `json:"distribution_refresh_hours"`
		DomainCheckHrs  int `json:"domain_check_hours"`
		AnalyticsMinute int `json:"aggregate_interval_minutes"`
	}
	tick := time.NewTicker(5 * time.Second)
	defer tick.Stop()
	// Heavy periodic tasks first run one interval after start-up, not immediately.
	now := time.Now()
	last := map[string]time.Time{"rss-health": now, "distribution": now, "domains": now, "cleanup": now, "storage": now}
	due := func(name string, every time.Duration) bool {
		if time.Since(last[name]) >= every {
			last[name] = time.Now()
			return true
		}
		return false
	}
	// lock ensures only one worker instance runs a cron task per period.
	lock := func(name string, ttl time.Duration) bool {
		ok, _ := a.Redis.SetNX(ctx, "cron:"+name, w.ID, ttl).Result()
		return ok
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		a.Queue.PromoteDue(ctx)

		var cfg cronCfg
		a.SystemSetting(ctx, "cron", &cfg)
		var an struct {
			Minutes   int `json:"aggregate_interval_minutes"`
			Retention int `json:"retention_days"`
		}
		a.SystemSetting(ctx, "analytics", &an)
		hours := func(v, def int) time.Duration {
			if v <= 0 {
				v = def
			}
			return time.Duration(v) * time.Hour
		}

		if due("publish", 30*time.Second) && lock("publish", 25*time.Second) {
			if n, err := a.PublishDue(ctx); err == nil && n > 0 {
				a.Log.Info("scheduled publish", "count", n)
			}
		}
		if due("rss-sync", time.Minute) && lock("rss-sync", 55*time.Second) {
			a.EnqueueDueRSSSyncs(ctx)
		}
		aggEvery := time.Duration(max(an.Minutes, 1)) * time.Minute
		if due("analytics", aggEvery) && lock("analytics", aggEvery-time.Second) {
			if err := a.AggregateAnalytics(ctx, 2); err != nil {
				a.SysLog(ctx, "error", "analytics", "Analytics aggregation failed", err.Error(), nil)
			} else {
				a.Cache.DelPrefix(ctx, "analytics:")
			}
		}
		if due("rss-health", hours(cfg.RSSHealthHours, 6)) && lock("rss-health", hours(cfg.RSSHealthHours, 6)-time.Minute) {
			rows, err := a.DB.Query(ctx, `SELECT id FROM podcasts WHERE status='PUBLISHED'`)
			if err == nil {
				var ids []int64
				for rows.Next() {
					var id int64
					rows.Scan(&id)
					ids = append(ids, id)
				}
				rows.Close()
				for _, id := range ids {
					a.Enqueue(ctx, queue.RSSHealthCheck, map[string]any{"podcast_id": id},
						queue.Options{UniqueKey: fmt.Sprintf("health:%d", id), UniqueTTL: time.Hour, MaxAttempts: 1})
				}
			}
		}
		if due("distribution", hours(cfg.DistRefreshHrs, 6)) && lock("distribution", hours(cfg.DistRefreshHrs, 6)-time.Minute) {
			a.EnqueueAutoDiscoveryChecks(ctx)
			rows, err := a.DB.Query(ctx, `SELECT d.id FROM podcast_distributions d JOIN platforms pl ON pl.id=d.platform_id
				WHERE (pl.submission_type='API' AND d.status IN ('SUBMITTED','PENDING','PENDING_REVIEW'))
				   OR (d.status='LIVE' AND d.external_url<>'')
				   OR (d.status='DISCOVERY_PENDING')`)
			if err == nil {
				var ids []int64
				for rows.Next() {
					var id int64
					rows.Scan(&id)
					ids = append(ids, id)
				}
				rows.Close()
				for _, id := range ids {
					a.Enqueue(ctx, queue.RefreshDistribution, map[string]any{"distribution_id": id},
						queue.Options{UniqueKey: fmt.Sprintf("dist:%d", id), UniqueTTL: time.Hour, MaxAttempts: 1})
				}
			}
		}
		if due("domains", hours(cfg.DomainCheckHrs, 6)) && lock("domains", hours(cfg.DomainCheckHrs, 6)-time.Minute) {
			rows, err := a.DB.Query(ctx, `SELECT id FROM domains WHERE status='ACTIVE'`)
			if err == nil {
				var ids []int64
				for rows.Next() {
					var id int64
					rows.Scan(&id)
					ids = append(ids, id)
				}
				rows.Close()
				for _, id := range ids {
					a.Enqueue(ctx, queue.CheckDomain, map[string]any{"domain_id": id},
						queue.Options{UniqueKey: fmt.Sprintf("domain:%d", id), UniqueTTL: time.Hour, MaxAttempts: 1})
				}
			}
		}
		if due("cleanup", 6*time.Hour) && lock("cleanup", 6*time.Hour-time.Minute) {
			retention := an.Retention
			if retention <= 0 {
				retention = 395
			}
			a.DB.Exec(ctx, `DELETE FROM analytics_events WHERE created_at < now() - make_interval(days => $1)`, retention)
			a.DB.Exec(ctx, `DELETE FROM job_runs WHERE created_at < now() - interval '30 days'`)
			a.DB.Exec(ctx, `DELETE FROM refresh_tokens WHERE expires_at < now() OR revoked_at < now() - interval '7 days'`)
			a.DB.Exec(ctx, `DELETE FROM uploads WHERE expires_at < now() - interval '1 day' AND status<>'COMPLETED'`)
			a.DB.Exec(ctx, `DELETE FROM webhook_deliveries WHERE created_at < now() - interval '30 days'`)
		}
		if due("sitemaps", time.Hour) && lock("sitemaps", 59*time.Minute) {
			rows, err := a.DB.Query(ctx, `SELECT id FROM tenants WHERE status='ACTIVE'`)
			if err == nil {
				var ids []int64
				for rows.Next() {
					var id int64
					rows.Scan(&id)
					ids = append(ids, id)
				}
				rows.Close()
				for _, id := range ids {
					a.Enqueue(ctx, queue.GenerateSitemap, map[string]any{"tenant_id": id},
						queue.Options{UniqueKey: fmt.Sprintf("sitemap:%d", id), UniqueTTL: 30 * time.Second})
				}
			}
		}
		// Storage warning (PRD §98).
		if due("storage", time.Hour) && lock("storage", 59*time.Minute) {
			var st struct {
				WarningGB float64 `json:"warning_threshold_gb"`
			}
			if a.SystemSetting(ctx, "storage", &st) && st.WarningGB > 0 {
				var used int64
				a.DB.QueryRow(ctx, `SELECT COALESCE((SELECT sum(original_size+processed_size) FROM audio_files),0)+COALESCE((SELECT sum(size) FROM images),0)`).Scan(&used)
				if float64(used) > st.WarningGB*(1<<30) {
					a.Notify(ctx, nil, "storage.warning", "warning", "Storage warning",
						fmt.Sprintf("Storage usage %.1f GB exceeds %.0f GB threshold.", float64(used)/(1<<30), st.WarningGB), "/system")
				}
			}
		}
	}
}
