// Package api exposes the HTTP API: public tenant-resolved endpoints for the web
// app and authenticated admin endpoints with backend-enforced RBAC (PRD §65, §69, §71).
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"podcast/api/internal/app"
	"podcast/api/internal/db"
)

type Server struct {
	App     *app.App
	metrics *metrics
}

func New(a *app.App) *Server {
	return &Server{App: a, metrics: newMetrics()}
}

// Router builds the full HTTP route tree.
func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(s.realIP)
	r.Use(s.recoverer)
	r.Use(s.logAndMeasure)
	r.Use(securityHeaders)
	r.Use(s.cors)
	r.Use(middleware.GetHead)

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	r.Get("/readyz", s.readyz)
	r.Get("/metrics", s.requireMetricsAccess(s.prometheus))

	// Local storage driver: serve media with range support (production uses the CDN / object storage directly).
	if s.App.Storage.Driver() == "local" {
		r.Get("/media/*", s.serveLocalMedia)
	}

	r.Route("/api", func(r chi.Router) {
		r.Use(middleware.Timeout(120 * time.Second))

		// ---------------- Public (tenant resolved from host) ----------------
		r.Route("/public", func(r chi.Router) {
			r.Use(s.rateLimit("public", 240))
			r.Get("/resolve", s.publicResolve)
			r.Get("/domain-verification", s.publicDomainVerification)
			r.Group(func(r chi.Router) {
				r.Use(s.tenantFromHost)
				r.Get("/site", s.publicSite)
				r.Get("/home", s.publicHome)
				r.Get("/podcasts", s.publicPodcasts)
				r.Get("/podcasts/{slug}", s.publicPodcast)
				r.Get("/podcasts/{slug}/episodes", s.publicPodcastEpisodes)
				r.Get("/podcasts/{slug}/episodes/{episode}", s.publicEpisode)
				r.Get("/podcasts/{slug}/episodes/{episode}/transcript", s.publicTranscript)
				r.Get("/episodes", s.publicEpisodes)
				r.Get("/categories", s.publicCategories)
				r.Get("/categories/{slug}", s.publicCategory)
				r.Get("/hosts", s.publicHosts)
				r.Get("/hosts/{slug}", s.publicHost)
				r.Get("/tags/{slug}", s.publicTag)
				r.Get("/collections", s.publicCollections)
				r.Get("/collections/{slug}", s.publicCollection)
				r.Get("/search", s.publicSearch)
				r.Get("/feeds/{slug}", s.publicFeed)
				r.Get("/sitemap/{segment}", s.publicSitemap)
				r.Get("/robots.txt", s.publicRobots)
				r.Get("/redirect", s.publicRedirect)
				r.Get("/preview/episodes/{id}", s.publicPreviewEpisode)
				r.With(s.rateLimit("events", 120)).Post("/events", s.publicEvent)
			})
		})

		// Signed local upload target — longer timeout for large files (no bearer token: authorised by HMAC signature).
		r.With(middleware.Timeout(30 * time.Minute)).Put("/uploads/{id}/data", s.uploadData)

		// ---------------- Auth ----------------
		r.Route("/auth", func(r chi.Router) {
			r.With(s.rateLimit("login", 10)).Post("/login", s.login)
			r.With(s.rateLimit("refresh", 60)).Post("/refresh", s.refresh)
			r.Post("/logout", s.logout)
			r.With(s.authenticate).Get("/me", s.me)
			r.With(s.authenticate).Post("/change-password", s.changePassword)
			r.With(s.rateLimit("forgot", 5)).Post("/forgot-password", s.forgotPassword)
			r.With(s.rateLimit("reset", 10)).Post("/reset-password", s.resetPassword)
		})

		// ---------------- Admin (authenticated) ----------------
		r.Group(func(r chi.Router) {
			r.Use(s.authenticate)
			r.Use(s.rateLimit("admin", 600))

			r.Get("/dashboard", s.dashboard)
			r.Get("/themes", s.listThemes)

			r.Get("/tenants", s.listTenants)
			r.With(s.requireRoles(roleSuper)).Post("/tenants", s.createTenant)
			r.Get("/tenants/{id}", s.getTenant)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Put("/tenants/{id}", s.updateTenant)
			r.With(s.requireRoles(roleSuper)).Delete("/tenants/{id}", s.deleteTenant)
			r.Get("/tenants/{id}/settings", s.getTenantSettings)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Put("/tenants/{id}/settings", s.updateTenantSettings)
			r.Get("/tenants/{id}/seo", s.getSEO)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Put("/tenants/{id}/seo", s.updateSEO)
			r.Get("/tenants/{id}/podcasts", s.tenantPodcasts)

			r.Get("/domains", s.listDomains)
			r.With(s.requireRoles(roleSuper)).Post("/domains", s.createDomain)
			r.With(s.requireRoles(roleSuper)).Put("/domains/{id}", s.updateDomain)
			r.With(s.requireRoles(roleSuper)).Delete("/domains/{id}", s.deleteDomain)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Post("/domains/{id}/verify", s.verifyDomain)

			r.Get("/users", s.listUsers)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Post("/users", s.createUser)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Put("/users/{id}", s.updateUser)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Delete("/users/{id}", s.deleteUser)

			r.Get("/podcasts", s.listPodcasts)
			r.Post("/podcasts", s.createPodcast)
			r.Post("/podcasts/bulk", s.bulkPodcasts)
			r.Get("/podcasts/{id}", s.getPodcast)
			r.Put("/podcasts/{id}", s.updatePodcast)
			r.Delete("/podcasts/{id}", s.deletePodcast)
			r.Post("/podcasts/{id}/publish", s.publishPodcast)
			r.Post("/podcasts/{id}/unpublish", s.unpublishPodcast)
			r.Get("/podcasts/{id}/episodes", s.podcastEpisodes)
			r.Get("/podcasts/{id}/feed", s.podcastFeedInfo)
			r.Get("/podcasts/{id}/rss-health", s.podcastRSSHealth)
			r.Post("/podcasts/{id}/rss-health", s.runPodcastRSSHealth)
			r.Get("/podcasts/{id}/tenants", s.podcastTenants)
			r.With(s.requireRoles(roleSuper)).Put("/podcasts/{id}/tenants", s.setPodcastTenants)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Put("/podcasts/{id}/tenants/{tenantID}", s.setTenantOverride)

			r.Post("/episodes", s.createEpisode)
			r.Post("/episodes/bulk", s.bulkEpisodes)
			r.Get("/episodes", s.listEpisodes)
			r.Get("/episodes/{id}", s.getEpisode)
			r.Put("/episodes/{id}", s.updateEpisode)
			r.Delete("/episodes/{id}", s.deleteEpisode)
			r.Post("/episodes/{id}/publish", s.publishEpisode)
			r.Post("/episodes/{id}/unpublish", s.unpublishEpisode)
			r.Post("/episodes/{id}/schedule", s.scheduleEpisode)
			r.Get("/episodes/{id}/audio", s.episodeAudio)
			r.Post("/episodes/{id}/audio/retry", s.retryAudio)
			r.Post("/episodes/{id}/transcript/generate", s.generateTranscript)
			r.Post("/episodes/{id}/preview-token", s.previewToken)

			r.Post("/uploads", s.initUpload)
			r.Post("/uploads/{id}/complete", s.completeUpload)

			r.Get("/categories", s.listCategories)
			r.With(s.requireRoles(roleSuper)).Post("/categories", s.createCategory)
			r.With(s.requireRoles(roleSuper)).Put("/categories/{id}", s.updateCategory)
			r.With(s.requireRoles(roleSuper)).Delete("/categories/{id}", s.deleteCategory)
			r.Get("/tags", s.listTags)

			r.Get("/hosts", s.listHosts)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin, roleEditor, roleCreator)).Post("/hosts", s.createHost)
			r.Get("/hosts/{id}", s.getHost)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin, roleEditor, roleCreator)).Put("/hosts/{id}", s.updateHost)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin, roleEditor)).Delete("/hosts/{id}", s.deleteHost)

			r.Get("/collections", s.listCollections)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin, roleEditor)).Post("/collections", s.createCollection)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin, roleEditor)).Put("/collections/{id}", s.updateCollection)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin, roleEditor)).Delete("/collections/{id}", s.deleteCollection)

			r.Get("/platforms", s.listPlatforms)
			r.With(s.requireRoles(roleSuper)).Post("/platforms", s.createPlatform)
			r.With(s.requireRoles(roleSuper)).Put("/platforms/{id}", s.updatePlatform)
			r.With(s.requireRoles(roleSuper)).Delete("/platforms/{id}", s.deletePlatform)

			r.Get("/distribution", s.listDistribution)
			r.Get("/distribution/overview", s.distributionOverview)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Post("/distribution/bulk", s.bulkDistribution)
			r.Get("/distribution/{podcastID}", s.podcastDistribution)
			r.Get("/distribution/{podcastID}/readiness", s.podcastReadiness)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Post("/distribution/{podcastID}/{platform}", s.setDistribution)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Post("/distribution/{podcastID}/{platform}/submit", s.submitDistribution)
			r.Get("/distribution/{podcastID}/{platform}/events", s.distributionEvents)

			r.With(s.requireRoles(roleSuper, roleTenantAdmin, roleEditor)).Post("/imports/rss/preview", s.previewRSSImport)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin, roleEditor)).Post("/imports/rss", s.importRSS)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin, roleEditor)).Post("/imports/csv", s.importCSV)
			r.Get("/rss-sources", s.listRSSSources)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin, roleEditor)).Put("/rss-sources/{id}", s.updateRSSSource)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin, roleEditor)).Post("/rss-sources/{id}/sync", s.syncRSSSource)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Delete("/rss-sources/{id}", s.deleteRSSSource)
			r.Get("/rss-sources/{id}/logs", s.rssSourceLogs)

			r.Get("/exports/{kind}", s.export)

			r.Get("/analytics/summary", s.analyticsSummary)
			r.Get("/analytics/episodes", s.analyticsEpisodes)
			r.Get("/analytics/geo", s.analyticsGeo)
			r.Get("/analytics/devices", s.analyticsDevices)
			r.With(s.requireRoles(roleSuper)).Get("/analytics/network", s.analyticsNetwork)

			r.Get("/notifications", s.listNotifications)
			r.Post("/notifications/read-all", s.readAllNotifications)
			r.Post("/notifications/clear-all", s.clearAllNotifications)
			r.Post("/notifications/{id}/read", s.readNotification)

			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Get("/audit-logs", s.listAuditLogs)

			r.Get("/redirects", s.listRedirects)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Post("/redirects", s.createRedirect)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Delete("/redirects/{id}", s.deleteRedirect)

			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Get("/api-keys", s.listAPIKeys)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Post("/api-keys", s.createAPIKey)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Delete("/api-keys/{id}", s.revokeAPIKey)

			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Get("/webhooks", s.listWebhooks)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Post("/webhooks", s.createWebhook)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Delete("/webhooks/{id}", s.deleteWebhook)
			r.With(s.requireRoles(roleSuper, roleTenantAdmin)).Get("/webhooks/{id}/deliveries", s.webhookDeliveries)

			r.Route("/system", func(r chi.Router) {
				r.Use(s.requireRoles(roleSuper))
				r.Get("/settings", s.getSystemSettings)
				r.Put("/settings/{key}", s.updateSystemSetting)
				r.Get("/metrics", s.systemMetrics)
				r.Get("/jobs", s.listJobs)
				r.Post("/jobs/{id}/retry", s.retryJob)
				r.Get("/logs", s.listSystemLogs)
				r.Post("/logs/{id}/resolve", s.resolveSystemLog)
				r.Get("/backup", s.backupExport)
			})
		})
	})
	return r
}

// ---------------------------------------------------------------------------
// JSON helpers

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeData(w http.ResponseWriter, v any) { writeJSON(w, http.StatusOK, map[string]any{"data": v}) }

func writeList(w http.ResponseWriter, items any, total int, page, perPage int) {
	writeJSON(w, http.StatusOK, map[string]any{"data": items, "meta": map[string]int{
		"total": total, "page": page, "per_page": perPage, "pages": (total + perPage - 1) / max(perPage, 1)}})
}

func writeError(w http.ResponseWriter, status int, code, msg string, details ...any) {
	e := apiError{Code: code, Message: msg}
	if len(details) > 0 {
		e.Details = details[0]
	}
	writeJSON(w, status, map[string]any{"error": e})
}

func badRequest(w http.ResponseWriter, msg string, details ...any) {
	writeError(w, http.StatusBadRequest, "bad_request", msg, details...)
}
func notFound(w http.ResponseWriter)  { writeError(w, http.StatusNotFound, "not_found", "Resource not found") }
func forbidden(w http.ResponseWriter) { writeError(w, http.StatusForbidden, "forbidden", "You do not have permission to perform this action") }

// serverError logs the technical error internally and returns a generic message (PRD §80).
func (s *Server) serverError(w http.ResponseWriter, r *http.Request, err error) {
	if db.IsNotFound(err) {
		notFound(w)
		return
	}
	if db.IsUniqueViolation(err) {
		writeError(w, http.StatusConflict, "conflict", "A record with the same unique value already exists")
		return
	}
	if db.IsForeignKeyViolation(err) {
		badRequest(w, "Referenced record does not exist or is still in use")
		return
	}
	if errors.Is(err, context.Canceled) {
		return
	}
	reqID := middleware.GetReqID(r.Context())
	s.App.SysLog(r.Context(), "error", "api", fmt.Sprintf("%s %s failed", r.Method, r.URL.Path), err.Error()+" req="+reqID, nil)
	writeError(w, http.StatusInternalServerError, "internal_error", "Something went wrong. The error has been logged.", map[string]string{"request_id": reqID})
}

func decode(r *http.Request, dst any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 5<<20))
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("invalid JSON body: %v", err)
	}
	return nil
}

func idParam(r *http.Request, name string) int64 {
	n, err := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	if err != nil || n <= 0 {
		return 0
	}
	return n
}

func requireID(w http.ResponseWriter, id int64) bool {
	if id <= 0 {
		badRequest(w, "invalid or missing resource ID")
		return false
	}
	return true
}

func queryInt(r *http.Request, name string, def int) int {
	if n, err := strconv.Atoi(r.URL.Query().Get(name)); err == nil {
		return n
	}
	return def
}

func queryInt64(r *http.Request, name string) int64 {
	n, _ := strconv.ParseInt(r.URL.Query().Get(name), 10, 64)
	return n
}

func pagination(r *http.Request, defPer, maxPer int) (page, per, offset int) {
	page = max(queryInt(r, "page", 1), 1)
	per = queryInt(r, "per_page", defPer)
	if per < 1 {
		per = defPer
	}
	if per > maxPer {
		per = maxPer
	}
	return page, per, (page - 1) * per
}

// ---------------------------------------------------------------------------
// Middleware

type ctxKey string

const ipKey ctxKey = "client-ip"

// realIP extracts the client address. Forwarded headers are trusted only from private (proxy) peers.
func (s *Server) realIP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			host = r.RemoteAddr
		}
		ip := host
		if peer := net.ParseIP(host); peer != nil && (peer.IsLoopback() || peer.IsPrivate()) {
			if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
				ip = strings.TrimSpace(strings.Split(xff, ",")[0])
			} else if cf := r.Header.Get("CF-Connecting-IP"); cf != "" {
				ip = cf
			} else if xr := r.Header.Get("X-Real-IP"); xr != "" {
				ip = xr
			}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ipKey, ip)))
	})
}

func clientIP(r *http.Request) string {
	if ip, ok := r.Context().Value(ipKey).(string); ok {
		return ip
	}
	return r.RemoteAddr
}

func (s *Server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil && rec != http.ErrAbortHandler {
				s.App.SysLog(r.Context(), "critical", "api", fmt.Sprintf("panic in %s %s", r.Method, r.URL.Path),
					fmt.Sprintf("%v\n%s", rec, debug.Stack()), nil)
				writeError(w, 500, "internal_error", "Something went wrong. The error has been logged.")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		if !strings.HasPrefix(r.URL.Path, "/media/") {
			h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) cors(next http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, o := range s.App.Cfg.CORSOrigins {
		allowed[o] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && (allowed[origin] || allowed["*"]) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With, X-API-Key")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Add("Vary", "Origin")
		}
		if strings.HasPrefix(r.URL.Path, "/media/") {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// rateLimit applies a per-IP fixed-window limit per minute (PRD §77).
func (s *Server) rateLimit(bucket string, perMinute int) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Server-side rendering calls from the web app arrive from one internal address without a
			// forwarded client IP; limiting them per IP would throttle every visitor of every site at once.
			if bucket == "public" && isInternalCall(r) {
				next.ServeHTTP(w, r)
				return
			}
			if !s.App.Cache.Allow(r.Context(), bucket+":"+clientIP(r), perMinute, time.Minute) {
				w.Header().Set("Retry-After", "60")
				writeError(w, http.StatusTooManyRequests, "rate_limited", "Too many requests. Please slow down.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ---------------------------------------------------------------------------
// Metrics (PRD §79: API metrics)

type routeStat struct {
	Count    int64   `json:"count"`
	Errors   int64   `json:"errors"`
	TotalMS  float64 `json:"total_ms"`
	MaxMS    float64 `json:"max_ms"`
	Under200 int64   `json:"under_200ms"`
	Under500 int64   `json:"under_500ms"`
}

type metrics struct {
	mu      sync.Mutex
	started time.Time
	routes  map[string]*routeStat
}

func newMetrics() *metrics { return &metrics{started: time.Now(), routes: map[string]*routeStat{}} }

func (m *metrics) observe(route string, status int, d time.Duration) {
	ms := float64(d.Microseconds()) / 1000
	m.mu.Lock()
	defer m.mu.Unlock()
	st := m.routes[route]
	if st == nil {
		st = &routeStat{}
		m.routes[route] = st
	}
	st.Count++
	if status >= 500 {
		st.Errors++
	}
	st.TotalMS += ms
	if ms > st.MaxMS {
		st.MaxMS = ms
	}
	if ms < 200 {
		st.Under200++
	}
	if ms < 500 {
		st.Under500++
	}
}

func (m *metrics) snapshot() map[string]routeStat {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make(map[string]routeStat, len(m.routes))
	for k, v := range m.routes {
		out[k] = *v
	}
	return out
}

func (s *Server) logAndMeasure(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		d := time.Since(start)
		route := "404"
		if rc := chi.RouteContext(r.Context()); rc != nil && rc.RoutePattern() != "" {
			route = rc.RoutePattern()
		}
		if strings.HasPrefix(route, "/media/") {
			route = "/media/*"
		}
		s.metrics.observe(r.Method+" "+route, ww.Status(), d)
		level := slog.LevelInfo
		if ww.Status() >= 500 {
			level = slog.LevelError
		} else if r.URL.Path == "/healthz" || strings.HasPrefix(r.URL.Path, "/media/") {
			level = slog.LevelDebug
		}
		s.App.Log.Log(r.Context(), level, "request", "method", r.Method, "path", r.URL.Path, "status", ww.Status(),
			"ms", d.Milliseconds(), "ip", clientIP(r), "req_id", middleware.GetReqID(r.Context()))
	})
}

func (s *Server) readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	checks := map[string]string{"database": "ok", "redis": "ok"}
	status := 200
	if err := s.App.DB.Ping(ctx); err != nil {
		checks["database"], status = err.Error(), 503
	}
	if err := s.App.Redis.Ping(ctx).Err(); err != nil {
		checks["redis"], status = err.Error(), 503
	}
	writeJSON(w, status, checks)
}
