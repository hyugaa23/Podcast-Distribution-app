// Package util holds small shared helpers: slugs, sanitization, safe HTTP fetching,
// user-agent parsing and file sniffing.
package util

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"syscall"
	"time"
	"unicode"

	"github.com/microcosm-cc/bluemonday"
	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

// Slugify converts s into a URL-safe slug.
func Slugify(s string) string {
	t := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
	r, _, _ := transform.String(t, strings.ToLower(s))
	r = strings.Trim(nonSlug.ReplaceAllString(r, "-"), "-")
	if len(r) > 80 {
		r = strings.Trim(r[:80], "-")
	}
	if r == "" {
		r = "item"
	}
	return r
}

var richPolicy = func() *bluemonday.Policy {
	p := bluemonday.UGCPolicy()
	p.RequireNoFollowOnLinks(false)
	p.AddTargetBlankToFullyQualifiedLinks(true)
	return p
}()

var strictPolicy = bluemonday.StrictPolicy()

// SanitizeHTML removes scripts/handlers while keeping basic formatting (XSS protection, PRD §77).
func SanitizeHTML(s string) string { return strings.TrimSpace(richPolicy.Sanitize(s)) }

// StripTags converts HTML to plain text.
func StripTags(s string) string {
	return strings.TrimSpace(html.UnescapeString(strictPolicy.Sanitize(s)))
}

// PlainText sanitizes a value that must never contain markup.
func PlainText(s string) string { return strings.TrimSpace(strictPolicy.Sanitize(s)) }

// Truncate shortens s to n runes on a word boundary.
func Truncate(s string, n int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) <= n {
		return string(r)
	}
	cut := string(r[:n])
	if i := strings.LastIndex(cut, " "); i > n/2 {
		cut = cut[:i]
	}
	return strings.TrimRight(cut, " ,.;:") + "…"
}

// RandomToken returns a URL-safe random string of n bytes of entropy.
func RandomToken(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// RandomHex returns n random bytes hex-encoded.
func RandomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func SHA256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// ---------------------------------------------------------------------------
// SSRF-safe HTTP client for fetching user supplied URLs (RSS import, mirroring).

var ErrPrivateAddress = errors.New("destination address is not allowed")

func isPrivateIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsUnspecified() || ip.IsMulticast() || ip.Equal(net.IPv4bcast) ||
		(ip.To4() != nil && ip.To4()[0] == 100 && ip.To4()[1]&0xc0 == 64) // CGNAT 100.64/10
}

// SafeHTTPClient refuses connections to private networks unless allowPrivate is set.
func SafeHTTPClient(timeout time.Duration, allowPrivate bool) *http.Client {
	dialer := &net.Dialer{
		Timeout: 10 * time.Second,
		Control: func(network, address string, _ syscall.RawConn) error {
			if allowPrivate {
				return nil
			}
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			if ip := net.ParseIP(host); ip != nil && isPrivateIP(ip) {
				return ErrPrivateAddress
			}
			return nil
		},
	}
	tr := &http.Transport{
		DialContext:           dialer.DialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 20 * time.Second,
		MaxIdleConns:          20,
		IdleConnTimeout:       60 * time.Second,
		Proxy:                 http.ProxyFromEnvironment,
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: tr,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}
			if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
				return errors.New("unsupported redirect scheme")
			}
			return nil
		},
	}
}

// ValidateFetchURL checks that raw is an absolute http(s) URL.
func ValidateFetchURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("invalid URL: must be an absolute http(s) URL")
	}
	return u, nil
}

// FetchLimited GETs url and returns at most max bytes of body.
func FetchLimited(ctx context.Context, c *http.Client, rawURL string, max int64, headers map[string]string) (*http.Response, []byte, error) {
	if _, err := ValidateFetchURL(rawURL); err != nil {
		return nil, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("User-Agent", "PodcastEngine/1.0 (+https://github.com/podcast-engine)")
	for k, v := range headers {
		if v != "" {
			req.Header.Set(k, v)
		}
	}
	resp, err := c.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, max+1))
	if err != nil {
		return resp, nil, err
	}
	if int64(len(body)) > max {
		return resp, nil, fmt.Errorf("response exceeds %d bytes", max)
	}
	return resp, body, nil
}

// ---------------------------------------------------------------------------
// File sniffing (MIME validation, PRD §77).

// SniffAudio returns the detected audio format ("mp3","m4a","wav") from the file header.
func SniffAudio(head []byte) string {
	switch {
	case len(head) >= 3 && bytes.Equal(head[:3], []byte("ID3")):
		return "mp3"
	case len(head) >= 2 && head[0] == 0xFF && (head[1]&0xE0) == 0xE0:
		return "mp3"
	case len(head) >= 12 && bytes.Equal(head[4:8], []byte("ftyp")):
		return "m4a"
	case len(head) >= 12 && bytes.Equal(head[:4], []byte("RIFF")) && bytes.Equal(head[8:12], []byte("WAVE")):
		return "wav"
	}
	return ""
}

// SniffImage returns "jpeg","png","webp","gif" or "".
func SniffImage(head []byte) string {
	ct := http.DetectContentType(head)
	switch ct {
	case "image/jpeg":
		return "jpeg"
	case "image/png":
		return "png"
	case "image/webp":
		return "webp"
	case "image/gif":
		return "gif"
	}
	return ""
}

// ---------------------------------------------------------------------------
// User agent parsing for analytics (devices, browsers, OS).

func ParseUA(ua string) (device, browser, os string) {
	l := strings.ToLower(ua)
	switch {
	case l == "":
		device = "Unknown"
	case strings.Contains(l, "bot") || strings.Contains(l, "spider") || strings.Contains(l, "crawl"):
		device = "Bot"
	case strings.Contains(l, "ipad") || strings.Contains(l, "tablet") || (strings.Contains(l, "android") && !strings.Contains(l, "mobile")):
		device = "Tablet"
	case strings.Contains(l, "mobi") || strings.Contains(l, "iphone") || strings.Contains(l, "android"):
		device = "Mobile"
	default:
		device = "Desktop"
	}
	switch {
	case strings.Contains(l, "edg/"):
		browser = "Edge"
	case strings.Contains(l, "opr/") || strings.Contains(l, "opera"):
		browser = "Opera"
	case strings.Contains(l, "samsungbrowser"):
		browser = "Samsung Internet"
	case strings.Contains(l, "firefox") || strings.Contains(l, "fxios"):
		browser = "Firefox"
	case strings.Contains(l, "chrome") || strings.Contains(l, "crios"):
		browser = "Chrome"
	case strings.Contains(l, "safari"):
		browser = "Safari"
	case l == "":
		browser = "Unknown"
	default:
		browser = "Other"
	}
	switch {
	case strings.Contains(l, "windows"):
		os = "Windows"
	case strings.Contains(l, "iphone") || strings.Contains(l, "ipad") || strings.Contains(l, "ios"):
		os = "iOS"
	case strings.Contains(l, "mac os") || strings.Contains(l, "macintosh"):
		os = "macOS"
	case strings.Contains(l, "android"):
		os = "Android"
	case strings.Contains(l, "linux"):
		os = "Linux"
	default:
		os = "Other"
	}
	return
}

// HostOf returns the lowercased hostname of a URL (no port), or "".
func HostOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Hostname())
}

// NormalizeHost lowercases and strips port and trailing dot from a Host header.
func NormalizeHost(h string) string {
	h = strings.ToLower(strings.TrimSpace(h))
	if i := strings.LastIndex(h, ":"); i > 0 && !strings.Contains(h[i:], "]") {
		h = h[:i]
	}
	return strings.TrimSuffix(h, ".")
}

var domainRe = regexp.MustCompile(`^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)

// ValidDomain validates a hostname such as podcast.com, www.podcast.com, sub.example.com.
func ValidDomain(d string) bool {
	return len(d) <= 253 && domainRe.MatchString(d) && (strings.Contains(d, ".") || d == "localhost")
}

var emailRe = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

func ValidEmail(e string) bool { return emailRe.MatchString(e) }

var colorRe = regexp.MustCompile(`^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$`)

func ValidColor(c string) bool { return colorRe.MatchString(c) }
