// Package authn implements password hashing and JWT tokens (PRD §70).
package authn

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// Roles (PRD §71).
const (
	RoleSuperAdmin  = "SUPER_ADMIN"
	RoleTenantAdmin = "TENANT_ADMIN"
	RoleEditor      = "EDITOR"
	RoleCreator     = "CREATOR"
	RoleViewer      = "VIEWER"
)

var ValidRoles = map[string]bool{RoleSuperAdmin: true, RoleTenantAdmin: true, RoleEditor: true, RoleCreator: true, RoleViewer: true}

func HashPassword(pw string) (string, error) {
	if len(pw) < 8 {
		return "", errors.New("password must be at least 8 characters")
	}
	b, err := bcrypt.GenerateFromPassword([]byte(pw), 12)
	return string(b), err
}

func CheckPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

type Claims struct {
	UserID   int64  `json:"uid"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	TenantID *int64 `json:"tid,omitempty"`
	Purpose  string `json:"pur,omitempty"`
	Resource int64  `json:"res,omitempty"`
	jwt.RegisteredClaims
}

type Signer struct {
	secret []byte
	ttl    time.Duration
}

func NewSigner(secret string, ttl time.Duration) *Signer {
	return &Signer{secret: []byte(secret), ttl: ttl}
}

func (s *Signer) sign(c Claims, ttl time.Duration) (string, error) {
	now := time.Now()
	c.RegisteredClaims = jwt.RegisteredClaims{
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		Issuer:    "podcast-engine",
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(s.secret)
}

// AccessToken issues a short-lived JWT access token.
func (s *Signer) AccessToken(userID int64, email, role string, tenantID *int64) (string, time.Time, error) {
	tok, err := s.sign(Claims{UserID: userID, Email: email, Role: role, TenantID: tenantID, Purpose: "access"}, s.ttl)
	return tok, time.Now().Add(s.ttl), err
}

// PreviewToken authorizes viewing an unpublished episode on the public site.
func (s *Signer) PreviewToken(episodeID int64, ttl time.Duration) (string, error) {
	return s.sign(Claims{Purpose: "preview", Resource: episodeID}, ttl)
}

func (s *Signer) Parse(token string) (*Claims, error) {
	c := &Claims{}
	_, err := jwt.ParseWithClaims(token, c, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return s.secret, nil
	}, jwt.WithIssuer("podcast-engine"), jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		return nil, err
	}
	return c, nil
}

// HMAC signs arbitrary data (signed local uploads).
func (s *Signer) HMAC(data string) string {
	m := hmac.New(sha256.New, s.secret)
	m.Write([]byte(data))
	return hex.EncodeToString(m.Sum(nil))
}

func (s *Signer) VerifyHMAC(data, sig string) bool {
	return hmac.Equal([]byte(s.HMAC(data)), []byte(sig))
}

// HashToken hashes opaque tokens (refresh tokens, API keys) for storage.
func HashToken(tok string) string {
	h := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(h[:])
}

// API key permissions (PRD §104).
var APIKeyPermissions = []string{"read:podcasts", "write:podcasts", "read:episodes", "write:episodes", "read:analytics"}
