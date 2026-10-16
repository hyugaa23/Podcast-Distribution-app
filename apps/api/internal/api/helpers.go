package api

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"podcast/api/internal/authn"
	"podcast/api/internal/rss"
)

func itoa(n int) string { return strconv.Itoa(n) }

func isPrivate(host string) bool {
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate())
}

var (
	dummyHashOnce sync.Once
	dummyHash     string
)

// equalizeLoginTiming spends a bcrypt comparison for unknown users so response times do not reveal
// which emails exist.
func equalizeLoginTiming(pw string) {
	dummyHashOnce.Do(func() { dummyHash, _ = authn.HashPassword("timing-equalizer-password") })
	authn.CheckPassword(dummyHash, pw)
}

// parseTime accepts RFC3339 or "2006-01-02T15:04" / "2006-01-02 15:04" in loc.
func parseTime(s string, loc *time.Location) (time.Time, error) {
	s = strings.TrimSpace(s)
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	var lastErr error
	for _, layout := range []string{"2006-01-02T15:04", "2006-01-02 15:04", "2006-01-02T15:04:05", "2006-01-02 15:04:05", "2006-01-02"} {
		t, err := time.ParseInLocation(layout, s, loc)
		if err == nil {
			return t, nil
		}
		lastErr = err
	}
	return time.Time{}, lastErr
}

func strPtr(s string) *string { return &s }

func nilIfZero(n int64) *int64 {
	if n == 0 {
		return nil
	}
	return &n
}

func rssValidate(b []byte) rss.Result { return rss.Validate(b) }

// isInternalCall reports a request from a private/loopback peer that carries no forwarded client
// address, i.e. a server-to-server call from the web app on the internal network.
func isInternalCall(r *http.Request) bool {
	if r.Header.Get("X-Forwarded-For") != "" || r.Header.Get("CF-Connecting-IP") != "" || r.Header.Get("X-Real-IP") != "" {
		return false
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	return isPrivate(host)
}
