package app

import (
	"context"
	"fmt"
	"time"

	"podcast/api/internal/util"
)

// Analytics event types (PRD §58).
var AnalyticsEventTypes = map[string]bool{
	"PAGE_VIEW": true, "PLAY": true, "25_PERCENT": true, "50_PERCENT": true, "75_PERCENT": true,
	"COMPLETE": true, "PAUSE": true, "SEEK": true, "DOWNLOAD": true,
}

type EventInput struct {
	Type      string `json:"type"`
	PodcastID int64  `json:"podcast_id"`
	EpisodeID int64  `json:"episode_id"`
	Path      string `json:"path"`
	Referrer  string `json:"referrer"`
	SessionID string `json:"session_id"`
	Position  int    `json:"position"`
}

type EventContext struct {
	TenantID  int64
	Domain    string
	IP        string
	UserAgent string
	Country   string
}

// RecordEvent stores an analytics event after validating that referenced content belongs to the tenant.
func (a *App) RecordEvent(ctx context.Context, ec EventContext, in EventInput) error {
	if !AnalyticsEventTypes[in.Type] {
		return fmt.Errorf("unknown event type")
	}
	device, browser, os := util.ParseUA(ec.UserAgent)
	if device == "Bot" {
		return nil
	}
	var podcastID, episodeID *int64
	if in.EpisodeID > 0 {
		var pid int64
		if err := a.DB.QueryRow(ctx, `SELECT podcast_id FROM episodes WHERE id=$1`, in.EpisodeID).Scan(&pid); err != nil {
			return fmt.Errorf("unknown episode")
		}
		in.PodcastID = pid
		episodeID = &in.EpisodeID
	}
	if in.PodcastID > 0 {
		if !a.PodcastVisibleOnTenant(ctx, ec.TenantID, in.PodcastID) {
			return fmt.Errorf("podcast not available on this site")
		}
		podcastID = &in.PodcastID
	}
	// Privacy-friendly daily visitor hash (no raw IPs stored).
	day := time.Now().UTC().Format("2006-01-02")
	visitor := util.SHA256Hex(fmt.Sprintf("%s|%d|%s|%s|%s", day, ec.TenantID, ec.IP, ec.UserAgent, a.Cfg.JWTSecret))[:32]
	refHost := util.HostOf(in.Referrer)
	if refHost == util.NormalizeHost(ec.Domain) {
		refHost = "" // internal navigation
	}
	country := ec.Country
	if country == "" || country == "XX" {
		country = "Unknown"
	}
	_, err := a.DB.Exec(ctx, `INSERT INTO analytics_events(tenant_id, domain, event_type, podcast_id, episode_id, path,
		referrer_host, country, device, browser, os, visitor_hash, session_id, position)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
		ec.TenantID, util.NormalizeHost(ec.Domain), in.Type, podcastID, episodeID, util.Truncate(in.Path, 500),
		refHost, country, device, browser, os, visitor, util.Truncate(in.SessionID, 64), in.Position)
	return err
}

// AggregateAnalytics rolls raw events into analytics_daily for the last `days` days (worker, PRD §72).
func (a *App) AggregateAnalytics(ctx context.Context, days int) error {
	_, err := a.DB.Exec(ctx, `
		INSERT INTO analytics_daily(day, tenant_id, podcast_id, episode_id, event_type, events, visitors)
		SELECT created_at::date, tenant_id, COALESCE(podcast_id,0), COALESCE(episode_id,0), event_type,
		       count(*), count(DISTINCT visitor_hash)
		  FROM analytics_events
		 WHERE created_at >= (current_date - $1::int)
		 GROUP BY 1,2,3,4,5
		ON CONFLICT (day, tenant_id, podcast_id, episode_id, event_type)
		DO UPDATE SET events=EXCLUDED.events, visitors=EXCLUDED.visitors`, days)
	return err
}

// AnalyticsFilter scopes analytics queries. TenantIDs nil = whole network.
type AnalyticsFilter struct {
	TenantIDs []int64
	PodcastID int64
	From      time.Time
	To        time.Time
}

type KV struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Value int64  `json:"value"`
}

type SeriesPoint struct {
	Day       string `json:"day"`
	Plays     int64  `json:"plays"`
	PageViews int64  `json:"page_views"`
	Visitors  int64  `json:"visitors"`
}

type AnalyticsSummary struct {
	From           time.Time     `json:"from"`
	To             time.Time     `json:"to"`
	EpisodePlays   int64         `json:"episode_plays"`
	PodcastPlays   int64         `json:"podcast_plays"`
	Completions    int64         `json:"completions"`
	UniqueVisitors int64         `json:"unique_visitors"`
	PageViews      int64         `json:"page_views"`
	Funnel         []KV          `json:"funnel"`
	Series         []SeriesPoint `json:"series"`
	TopPodcasts    []KV          `json:"top_podcasts"`
	TopEpisodes    []KV          `json:"top_episodes"`
	Referrers      []KV          `json:"referrers"`
	Countries      []KV          `json:"countries"`
	Devices        []KV          `json:"devices"`
	Browsers       []KV          `json:"browsers"`
	Domains        []KV          `json:"domains"`
}

func (f AnalyticsFilter) where(alias string, args *[]any) string {
	w := fmt.Sprintf("%s.created_at >= $1 AND %s.created_at < $2", alias, alias)
	*args = append(*args, f.From, f.To)
	if f.TenantIDs != nil {
		*args = append(*args, f.TenantIDs)
		w += fmt.Sprintf(" AND %s.tenant_id = ANY($%d)", alias, len(*args))
	}
	if f.PodcastID > 0 {
		*args = append(*args, f.PodcastID)
		w += fmt.Sprintf(" AND %s.podcast_id = $%d", alias, len(*args))
	}
	return w
}

func (a *App) kv(ctx context.Context, sql string, args ...any) []KV {
	out := []KV{}
	rows, err := a.DB.Query(ctx, sql, args...)
	if err != nil {
		a.Log.Error("analytics query", "err", err)
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var k KV
		if err := rows.Scan(&k.Key, &k.Label, &k.Value); err == nil {
			out = append(out, k)
		}
	}
	return out
}

// Summary computes the analytics dashboard (PRD §57).
func (a *App) Summary(ctx context.Context, f AnalyticsFilter) (*AnalyticsSummary, error) {
	s := &AnalyticsSummary{From: f.From, To: f.To}
	var args []any
	w := f.where("ev", &args)
	err := a.DB.QueryRow(ctx, `SELECT
		count(*) FILTER (WHERE event_type='PLAY' AND episode_id IS NOT NULL),
		count(DISTINCT (session_id, podcast_id)) FILTER (WHERE event_type='PLAY' AND podcast_id IS NOT NULL),
		count(*) FILTER (WHERE event_type='COMPLETE'),
		count(DISTINCT visitor_hash),
		count(*) FILTER (WHERE event_type='PAGE_VIEW')
		FROM analytics_events ev WHERE `+w, args...).
		Scan(&s.EpisodePlays, &s.PodcastPlays, &s.Completions, &s.UniqueVisitors, &s.PageViews)
	if err != nil {
		return nil, err
	}
	s.Funnel = a.kv(ctx, `SELECT event_type, event_type, count(*) FROM analytics_events ev WHERE `+w+`
		AND event_type IN ('PLAY','25_PERCENT','50_PERCENT','75_PERCENT','COMPLETE')
		GROUP BY 1 ORDER BY array_position(ARRAY['PLAY','25_PERCENT','50_PERCENT','75_PERCENT','COMPLETE'], event_type)`, args...)

	rows, err := a.DB.Query(ctx, `SELECT to_char(d::date,'YYYY-MM-DD'),
		count(ev.id) FILTER (WHERE ev.event_type='PLAY'), count(ev.id) FILTER (WHERE ev.event_type='PAGE_VIEW'),
		count(DISTINCT ev.visitor_hash)
		FROM generate_series($1::timestamptz::date, ($2::timestamptz - interval '1 second')::date, interval '1 day') d
		LEFT JOIN analytics_events ev ON ev.created_at::date = d::date AND `+w+`
		GROUP BY 1 ORDER BY 1`, args...)
	if err == nil {
		for rows.Next() {
			var p SeriesPoint
			rows.Scan(&p.Day, &p.Plays, &p.PageViews, &p.Visitors)
			s.Series = append(s.Series, p)
		}
		rows.Close()
	}
	s.TopPodcasts = a.kv(ctx, `SELECT p.id::text, p.title, count(*) FROM analytics_events ev JOIN podcasts p ON p.id=ev.podcast_id
		WHERE `+w+` AND ev.event_type='PLAY' GROUP BY 1,2 ORDER BY 3 DESC LIMIT 10`, args...)
	s.TopEpisodes = a.kv(ctx, `SELECT e.id::text, e.title, count(*) FROM analytics_events ev JOIN episodes e ON e.id=ev.episode_id
		WHERE `+w+` AND ev.event_type='PLAY' GROUP BY 1,2 ORDER BY 3 DESC LIMIT 10`, args...)
	s.Referrers = a.kv(ctx, `SELECT COALESCE(NULLIF(referrer_host,''),'(direct)'), COALESCE(NULLIF(referrer_host,''),'Direct / internal'), count(*)
		FROM analytics_events ev WHERE `+w+` AND event_type='PAGE_VIEW' GROUP BY 1,2 ORDER BY 3 DESC LIMIT 10`, args...)
	s.Countries = a.kv(ctx, `SELECT country, country, count(DISTINCT visitor_hash) FROM analytics_events ev WHERE `+w+` GROUP BY 1,2 ORDER BY 3 DESC LIMIT 10`, args...)
	s.Devices = a.kv(ctx, `SELECT device, device, count(DISTINCT visitor_hash) FROM analytics_events ev WHERE `+w+` GROUP BY 1,2 ORDER BY 3 DESC`, args...)
	s.Browsers = a.kv(ctx, `SELECT browser, browser, count(DISTINCT visitor_hash) FROM analytics_events ev WHERE `+w+` GROUP BY 1,2 ORDER BY 3 DESC LIMIT 10`, args...)
	s.Domains = a.kv(ctx, `SELECT domain, domain, count(*) FROM analytics_events ev WHERE `+w+` GROUP BY 1,2 ORDER BY 3 DESC LIMIT 20`, args...)
	if s.Series == nil {
		s.Series = []SeriesPoint{}
	}
	return s, nil
}

// EpisodeStats holds per-episode analytics for a podcast.
type EpisodeStats struct {
	EpisodeID  int64  `json:"episode_id"`
	Title      string `json:"title"`
	Plays      int64  `json:"plays"`
	Completions int64 `json:"completions"`
	Downloads  int64  `json:"downloads"`
	Visitors   int64  `json:"visitors"`
	AvgPercent int    `json:"avg_percent"`
}

// EpisodeAnalytics returns per-episode breakdown for a podcast (PRD §57 gap).
func (a *App) EpisodeAnalytics(ctx context.Context, f AnalyticsFilter) ([]EpisodeStats, error) {
	var args []any
	w := f.where("ev", &args)
	rows, err := a.DB.Query(ctx, `
		SELECT e.id, e.title,
		  count(*) FILTER (WHERE ev.event_type='PLAY'),
		  count(*) FILTER (WHERE ev.event_type='COMPLETE'),
		  count(*) FILTER (WHERE ev.event_type='DOWNLOAD'),
		  count(DISTINCT ev.visitor_hash),
		  COALESCE(
		    CASE WHEN count(*) FILTER (WHERE ev.event_type='PLAY') > 0
		    THEN (
		      count(*) FILTER (WHERE ev.event_type='25_PERCENT') +
		      count(*) FILTER (WHERE ev.event_type='50_PERCENT') * 2 +
		      count(*) FILTER (WHERE ev.event_type='75_PERCENT') * 3 +
		      count(*) FILTER (WHERE ev.event_type='COMPLETE') * 4
		    ) * 25 / (count(*) FILTER (WHERE ev.event_type='PLAY') * 4)
		    ELSE 0 END, 0)
		FROM episodes e
		JOIN analytics_events ev ON ev.episode_id = e.id
		WHERE `+w+` AND ev.episode_id IS NOT NULL
		GROUP BY e.id, e.title
		ORDER BY 3 DESC
		LIMIT 50`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EpisodeStats{}
	for rows.Next() {
		var s EpisodeStats
		if err := rows.Scan(&s.EpisodeID, &s.Title, &s.Plays, &s.Completions, &s.Downloads, &s.Visitors, &s.AvgPercent); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, nil
}

// GeoBreakdown returns geographic distribution of visitors.
func (a *App) GeoBreakdown(ctx context.Context, f AnalyticsFilter) []KV {
	var args []any
	w := f.where("ev", &args)
	return a.kv(ctx, `SELECT country, country, count(DISTINCT visitor_hash) FROM analytics_events ev WHERE `+w+` GROUP BY 1,2 ORDER BY 3 DESC LIMIT 50`, args...)
}

// DeviceBreakdown returns device/browser/os distribution.
type DeviceBreakdown struct {
	Devices  []KV `json:"devices"`
	Browsers []KV `json:"browsers"`
	OS       []KV `json:"os"`
}

func (a *App) DeviceStats(ctx context.Context, f AnalyticsFilter) DeviceBreakdown {
	var args []any
	w := f.where("ev", &args)
	return DeviceBreakdown{
		Devices:  a.kv(ctx, `SELECT device, device, count(DISTINCT visitor_hash) FROM analytics_events ev WHERE `+w+` GROUP BY 1,2 ORDER BY 3 DESC`, args...),
		Browsers: a.kv(ctx, `SELECT browser, browser, count(DISTINCT visitor_hash) FROM analytics_events ev WHERE `+w+` GROUP BY 1,2 ORDER BY 3 DESC LIMIT 20`, args...),
		OS:       a.kv(ctx, `SELECT os, os, count(DISTINCT visitor_hash) FROM analytics_events ev WHERE `+w+` GROUP BY 1,2 ORDER BY 3 DESC LIMIT 20`, args...),
	}
}

type TenantComparison struct {
	TenantID       int64  `json:"tenant_id"`
	TenantName     string `json:"tenant_name"`
	Domain         string `json:"domain"`
	Plays          int64  `json:"plays"`
	Completions    int64  `json:"completions"`
	PageViews      int64  `json:"page_views"`
	UniqueVisitors int64  `json:"unique_visitors"`
	Podcasts       int64  `json:"podcasts"`
	Episodes       int64  `json:"episodes"`
}

// NetworkComparison compares performance across tenants (PRD §59).
func (a *App) NetworkComparison(ctx context.Context, from, to time.Time) ([]TenantComparison, error) {
	rows, err := a.DB.Query(ctx, `
		SELECT t.id, t.name,
		  COALESCE((SELECT domain FROM domains WHERE tenant_id=t.id AND is_primary LIMIT 1),''),
		  count(ev.id) FILTER (WHERE ev.event_type='PLAY'),
		  count(ev.id) FILTER (WHERE ev.event_type='COMPLETE'),
		  count(ev.id) FILTER (WHERE ev.event_type='PAGE_VIEW'),
		  count(DISTINCT ev.visitor_hash),
		  (SELECT count(*) FROM podcasts p WHERE p.status='PUBLISHED' AND p.id IN (SELECT podcast_id FROM tenant_podcast_ids(t.id))),
		  (SELECT count(*) FROM episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE e.status='PUBLISHED' AND p.status='PUBLISHED'
		     AND p.id IN (SELECT podcast_id FROM tenant_podcast_ids(t.id)))
		FROM tenants t
		LEFT JOIN analytics_events ev ON ev.tenant_id=t.id AND ev.created_at>=$1 AND ev.created_at<$2
		GROUP BY t.id, t.name ORDER BY 4 DESC, t.name`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TenantComparison{}
	for rows.Next() {
		var c TenantComparison
		if err := rows.Scan(&c.TenantID, &c.TenantName, &c.Domain, &c.Plays, &c.Completions, &c.PageViews,
			&c.UniqueVisitors, &c.Podcasts, &c.Episodes); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}
