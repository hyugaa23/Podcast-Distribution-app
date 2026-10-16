package api

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"podcast/api/internal/app"
	"podcast/api/internal/authn"
	"podcast/api/internal/util"
)

const (
	roleSuper       = authn.RoleSuperAdmin
	roleTenantAdmin = authn.RoleTenantAdmin
	roleEditor      = authn.RoleEditor
	roleCreator     = authn.RoleCreator
	roleViewer      = authn.RoleViewer
)

const refreshCookie = "pe_refresh"

// Principal is the authenticated actor of a request.
type Principal struct {
	UserID      int64
	Email       string
	Role        string
	TenantID    *int64
	APIKeyID    int64
	Permissions []string
}

func (p *Principal) IsSuper() bool { return p.Role == roleSuper }

// Tenant returns the principal's tenant id (0 for super admins).
func (p *Principal) Tenant() int64 {
	if p.TenantID == nil {
		return 0
	}
	return *p.TenantID
}

func (p *Principal) userIDPtr() *int64 {
	if p.UserID == 0 {
		return nil
	}
	return &p.UserID
}

const principalKey ctxKey = "principal"

func principal(r *http.Request) *Principal {
	p, _ := r.Context().Value(principalKey).(*Principal)
	return p
}

// authenticate validates a JWT access token or API key (PRD §70, §104).
func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tok := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		if k := r.Header.Get("X-API-Key"); k != "" {
			tok = k
		}
		if tok == "" {
			writeError(w, http.StatusUnauthorized, "unauthorized", "Authentication required")
			return
		}
		var p *Principal
		if strings.HasPrefix(tok, "pk_") {
			p = s.apiKeyPrincipal(r.Context(), tok)
			if p == nil {
				writeError(w, http.StatusUnauthorized, "unauthorized", "Invalid API key")
				return
			}
			if !apiKeyAllowed(p, r) {
				writeError(w, http.StatusForbidden, "forbidden", "API key lacks the required permission")
				return
			}
		} else {
			c, err := s.App.Signer.Parse(tok)
			if err != nil || c.Purpose != "access" {
				writeError(w, http.StatusUnauthorized, "unauthorized", "Invalid or expired token")
				return
			}
			// Re-check the account is still active (disabled users lose access immediately).
			var status string
			if err := s.App.DB.QueryRow(r.Context(), `SELECT status FROM users WHERE id=$1`, c.UserID).Scan(&status); err != nil || status != "ACTIVE" {
				writeError(w, http.StatusUnauthorized, "unauthorized", "Account is disabled")
				return
			}
			p = &Principal{UserID: c.UserID, Email: c.Email, Role: c.Role, TenantID: c.TenantID}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey, p)))
	})
}

func (s *Server) apiKeyPrincipal(ctx context.Context, tok string) *Principal {
	var id, tenantID int64
	var perms []string
	err := s.App.DB.QueryRow(ctx, `SELECT k.id, k.tenant_id, k.permissions FROM api_keys k JOIN tenants t ON t.id=k.tenant_id
		WHERE k.key_hash=$1 AND k.revoked_at IS NULL AND t.status='ACTIVE'`, authn.HashToken(tok)).Scan(&id, &tenantID, &perms)
	if err != nil {
		return nil
	}
	s.App.DB.Exec(ctx, `UPDATE api_keys SET last_used_at=now() WHERE id=$1`, id)
	role := roleViewer
	if slices.Contains(perms, "write:podcasts") || slices.Contains(perms, "write:episodes") {
		role = roleEditor
	}
	return &Principal{Email: "api-key", Role: role, TenantID: &tenantID, APIKeyID: id, Permissions: perms}
}

// apiKeyAllowed gates API-key requests to the endpoints covered by their permissions.
func apiKeyAllowed(p *Principal, r *http.Request) bool {
	path := strings.TrimPrefix(r.URL.Path, "/api")
	read := r.Method == http.MethodGet
	has := func(perm string) bool { return slices.Contains(p.Permissions, perm) }
	switch {
	case strings.HasPrefix(path, "/podcasts"):
		if read {
			return has("read:podcasts")
		}
		return has("write:podcasts")
	case strings.HasPrefix(path, "/episodes"):
		if read {
			return has("read:episodes")
		}
		return has("write:episodes")
	case strings.HasPrefix(path, "/uploads"):
		return has("write:episodes") || has("write:podcasts")
	case strings.HasPrefix(path, "/analytics/summary"):
		return read && has("read:analytics")
	case path == "/categories" || path == "/tags":
		return read
	}
	return false
}

// requireRoles restricts a route to the given roles (validated on the backend, PRD §71).
func (s *Server) requireRoles(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p := principal(r)
			if p == nil || !slices.Contains(roles, p.Role) {
				forbidden(w)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (s *Server) requireMetricsAccess(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		host, _, _ := strings.Cut(r.RemoteAddr, ":")
		if strings.HasPrefix(r.RemoteAddr, "127.0.0.1") || strings.HasPrefix(r.RemoteAddr, "[::1]") || isPrivate(host) {
			h(w, r)
			return
		}
		forbidden(w)
	}
}

// ---------------------------------------------------------------------------
// Tenant scoping helpers (PRD §113: never trust tenant ids from the frontend)

// scopeTenant returns the tenant filter for list endpoints: a super admin may pass ?tenant_id,
// everyone else is pinned to their own tenant. Returns 0 for "all tenants" (super admin only).
func scopeTenant(r *http.Request) int64 {
	p := principal(r)
	if p.IsSuper() {
		return queryInt64(r, "tenant_id")
	}
	return p.Tenant()
}

// canAccessTenant reports whether the principal may read data of tenantID.
func canAccessTenant(p *Principal, tenantID int64) bool {
	return p.IsSuper() || (p.TenantID != nil && *p.TenantID == tenantID)
}

// canManageTenant reports whether the principal may change settings of tenantID.
func canManageTenant(p *Principal, tenantID int64) bool {
	return p.IsSuper() || (p.Role == roleTenantAdmin && p.Tenant() == tenantID)
}

type podcastAccess struct {
	Read   bool // can view in admin
	Edit   bool // can edit the source podcast record & its episodes
	Delete bool
	Owner  *int64
}

// podcastAccessFor resolves the principal's permissions on a podcast.
func (s *Server) podcastAccessFor(ctx context.Context, p *Principal, podcastID int64) (podcastAccess, error) {
	var acc podcastAccess
	var owner *int64
	if err := s.App.DB.QueryRow(ctx, `SELECT owner_tenant_id FROM podcasts WHERE id=$1`, podcastID).Scan(&owner); err != nil {
		return acc, err
	}
	acc.Owner = owner
	if p.IsSuper() {
		return podcastAccess{true, true, true, owner}, nil
	}
	tid := p.Tenant()
	owned := owner != nil && *owner == tid
	visible := owned
	if !visible {
		s.App.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tenant_podcast_ids($1) WHERE podcast_id=$2)`, tid, podcastID).Scan(&visible)
	}
	switch p.Role {
	case roleTenantAdmin:
		acc = podcastAccess{Read: visible, Edit: owned, Delete: owned}
	case roleEditor:
		acc = podcastAccess{Read: visible, Edit: owned}
	case roleCreator:
		var assigned bool
		s.App.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM user_podcasts WHERE user_id=$1 AND podcast_id=$2)`, p.UserID, podcastID).Scan(&assigned)
		acc = podcastAccess{Read: assigned && visible, Edit: assigned && owned}
	case roleViewer:
		acc = podcastAccess{Read: visible}
	}
	acc.Owner = owner
	return acc, nil
}

// creatorFilter returns SQL restricting podcasts to a creator's assignments (or "TRUE").
func creatorFilter(p *Principal, alias string, argPos int) (string, []any) {
	if p.Role == roleCreator {
		return alias + ".id IN (SELECT podcast_id FROM user_podcasts WHERE user_id=$" + itoa(argPos) + ")", []any{p.UserID}
	}
	return "TRUE", nil
}

// ---------------------------------------------------------------------------
// Handlers

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in loginReq
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))
	var id int64
	var hash, name, role, status string
	var tenantID *int64
	err := s.App.DB.QueryRow(r.Context(), `SELECT id, password_hash, name, role, tenant_id, status FROM users WHERE email=$1`, email).
		Scan(&id, &hash, &name, &role, &tenantID, &status)
	if err != nil || !authn.CheckPassword(hash, in.Password) {
		if err == pgx.ErrNoRows {
			equalizeLoginTiming(in.Password)
		}
		s.App.Audit(r.Context(), app.AuditEntry{UserEmail: email, Action: "LOGIN_FAILED", ResourceType: "user", IP: clientIP(r), UserAgent: r.UserAgent()})
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "Invalid email or password")
		return
	}
	if status != "ACTIVE" {
		writeError(w, http.StatusForbidden, "account_disabled", "This account is disabled")
		return
	}
	s.issueSession(w, r, id, email, name, role, tenantID)
	s.App.DB.Exec(r.Context(), `UPDATE users SET last_login_at=now() WHERE id=$1`, id)
	s.App.Audit(r.Context(), app.AuditEntry{UserID: &id, UserEmail: email, Action: "LOGIN", ResourceType: "user", ResourceID: id,
		TenantID: tenantID, IP: clientIP(r), UserAgent: r.UserAgent()})
}

func (s *Server) issueSession(w http.ResponseWriter, r *http.Request, id int64, email, name, role string, tenantID *int64) {
	access, exp, err := s.App.Signer.AccessToken(id, email, role, tenantID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	refresh := util.RandomToken(32)
	if _, err := s.App.DB.Exec(r.Context(), `INSERT INTO refresh_tokens(user_id, token_hash, user_agent, ip, expires_at) VALUES ($1,$2,$3,$4,$5)`,
		id, authn.HashToken(refresh), util.Truncate(r.UserAgent(), 300), clientIP(r), time.Now().Add(s.App.Cfg.RefreshTokenTTL)); err != nil {
		s.serverError(w, r, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: refreshCookie, Value: refresh, Path: "/api/auth", HttpOnly: true, Secure: s.App.Cfg.CookieSecure,
		SameSite: http.SameSiteStrictMode, Expires: time.Now().Add(s.App.Cfg.RefreshTokenTTL),
	})
	writeData(w, map[string]any{
		"access_token": access, "token_type": "Bearer", "expires_at": exp,
		"user": map[string]any{"id": id, "email": email, "name": name, "role": role, "tenant_id": tenantID},
	})
}

// refresh rotates the refresh token. Requires X-Requested-With to block cross-site form posts (CSRF, PRD §77).
func (s *Server) refresh(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Requested-With") == "" {
		writeError(w, http.StatusForbidden, "csrf", "Missing X-Requested-With header")
		return
	}
	c, err := r.Cookie(refreshCookie)
	if err != nil || c.Value == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "No refresh token")
		return
	}
	var tokID, userID int64
	var email, name, role, status string
	var tenantID *int64
	err = s.App.DB.QueryRow(r.Context(), `SELECT rt.id, u.id, u.email, u.name, u.role, u.tenant_id, u.status FROM refresh_tokens rt
		JOIN users u ON u.id=rt.user_id WHERE rt.token_hash=$1 AND rt.expires_at>now()
		AND (rt.revoked_at IS NULL OR rt.revoked_at > now() - interval '20 seconds' AND rt.user_agent<>'logout')`,
		authn.HashToken(c.Value)).Scan(&tokID, &userID, &email, &name, &role, &tenantID, &status)
	if err != nil || status != "ACTIVE" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Session expired")
		return
	}
	// Rotation: the old token is revoked; a 20s reuse window tolerates parallel tabs/requests.
	s.App.DB.Exec(r.Context(), `UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at, now()) WHERE id=$1`, tokID)
	s.issueSession(w, r, userID, email, name, role, tenantID)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(refreshCookie); err == nil {
		s.App.DB.Exec(r.Context(), `UPDATE refresh_tokens SET revoked_at=now() - interval '1 minute', user_agent='logout' WHERE token_hash=$1`, authn.HashToken(c.Value))
	}
	http.SetCookie(w, &http.Cookie{Name: refreshCookie, Value: "", Path: "/api/auth", MaxAge: -1, HttpOnly: true,
		Secure: s.App.Cfg.CookieSecure, SameSite: http.SameSiteStrictMode})
	writeData(w, map[string]bool{"ok": true})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	if p.APIKeyID != 0 {
		writeData(w, map[string]any{"api_key_id": p.APIKeyID, "tenant_id": p.TenantID, "permissions": p.Permissions})
		return
	}
	rows, err := s.App.DB.Query(r.Context(), app.UserSelect+` WHERE u.id=$1`, p.UserID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	u, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[app.User])
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	resp := map[string]any{"user": u}
	if u.TenantID != nil {
		if t, err := s.loadTenant(r.Context(), *u.TenantID); err == nil {
			resp["tenant"] = t
		}
	}
	writeData(w, resp)
}

func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	p := principal(r)
	var in struct {
		Current string `json:"current_password"`
		New     string `json:"new_password"`
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, err.Error())
		return
	}
	var hash string
	if err := s.App.DB.QueryRow(r.Context(), `SELECT password_hash FROM users WHERE id=$1`, p.UserID).Scan(&hash); err != nil {
		s.serverError(w, r, err)
		return
	}
	if !authn.CheckPassword(hash, in.Current) {
		badRequest(w, "Current password is incorrect")
		return
	}
	nh, err := authn.HashPassword(in.New)
	if err != nil {
		badRequest(w, err.Error())
		return
	}
	s.App.DB.Exec(r.Context(), `UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1`, p.UserID, nh)
	s.App.DB.Exec(r.Context(), `UPDATE refresh_tokens SET revoked_at=now() - interval '1 minute' WHERE user_id=$1 AND revoked_at IS NULL`, p.UserID)
	s.audit(r, "CHANGED_PASSWORD", "user", p.UserID, p.TenantID, nil)
	writeData(w, map[string]bool{"ok": true})
}

// audit records an admin action with request context (PRD §78).
func (s *Server) audit(r *http.Request, action, resourceType string, resourceID any, tenantID *int64, changes any) {
	p := principal(r)
	e := app.AuditEntry{Action: action, ResourceType: resourceType, ResourceID: resourceID, TenantID: tenantID,
		IP: clientIP(r), UserAgent: util.Truncate(r.UserAgent(), 300), Changes: changes}
	if p != nil {
		e.UserID, e.UserEmail = p.userIDPtr(), p.Email
		if p.APIKeyID != 0 {
			e.UserEmail = "api-key:" + itoa(int(p.APIKeyID))
		}
	}
	s.App.Audit(r.Context(), e)
}
