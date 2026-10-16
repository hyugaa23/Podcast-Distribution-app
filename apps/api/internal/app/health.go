package app

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"podcast/api/internal/rss"
	"podcast/api/internal/util"
)

// HealthCheck is one RSS health monitor item (PRD §96).
type HealthCheck struct {
	Key     string `json:"key"`
	Label   string `json:"label"`
	Status  string `json:"status"` // ok | warning | critical
	Message string `json:"message"`
}

type RSSHealth struct {
	PodcastID int64         `json:"podcast_id"`
	Status    string        `json:"status"` // HEALTHY | WARNING | CRITICAL
	Checks    []HealthCheck `json:"checks"`
	FeedURL   string        `json:"feed_url"`
	CheckedAt time.Time     `json:"checked_at"`
}

// CheckRSSHealth monitors reachability, XML validity, artwork, audio, required fields, GUIDs and SSL.
func (a *App) CheckRSSHealth(ctx context.Context, podcastID int64) (*RSSHealth, error) {
	p, err := a.PodcastByID(ctx, podcastID)
	if err != nil {
		return nil, err
	}
	feedURL := a.FeedURL(ctx, p)
	h := &RSSHealth{PodcastID: podcastID, FeedURL: feedURL, CheckedAt: time.Now().UTC()}
	add := func(key, label, status, msg string) {
		h.Checks = append(h.Checks, HealthCheck{Key: key, Label: label, Status: status, Message: msg})
	}

	// RSS reachable: try the public URL; fall back to direct generation for local/dev hosts.
	var feed []byte
	client := util.SafeHTTPClient(15*time.Second, false)
	resp, body, ferr := util.FetchLimited(ctx, client, feedURL, maxFeedBytes, nil)
	switch {
	case ferr == nil && resp.StatusCode == 200:
		feed = body
		add("reachable", "RSS reachable", "ok", "Feed responded 200 OK")
	default:
		msg := "Feed URL not reachable"
		if ferr != nil {
			msg += ": " + ferr.Error()
		} else {
			msg += fmt.Sprintf(": HTTP %d", resp.StatusCode)
		}
		status := "critical"
		if IsLocalHost(util.HostOf(feedURL)) {
			status = "warning"
		}
		add("reachable", "RSS reachable", status, msg)
		feed, _, err = a.BuildFeed(ctx, podcastID)
		if err != nil {
			return nil, err
		}
	}

	res := rss.Validate(feed)
	if res.Valid {
		msg := "Feed is valid"
		if res.Warnings > 0 {
			msg = fmt.Sprintf("Valid with %d warning(s)", res.Warnings)
		}
		add("xml", "XML valid", "ok", msg)
	} else {
		var msgs []string
		for _, is := range res.Issues {
			if is.Severity == "error" {
				msgs = append(msgs, is.Message)
			}
		}
		add("xml", "XML valid", "critical", strings.Join(uniq(msgs), "; "))
	}

	// Required fields.
	var missing []string
	if p.Title == "" {
		missing = append(missing, "title")
	}
	if util.StripTags(p.Description) == "" {
		missing = append(missing, "description")
	}
	if p.OwnerEmail == "" {
		missing = append(missing, "owner email")
	}
	if p.CategoryID == nil {
		missing = append(missing, "category")
	}
	if len(missing) > 0 {
		add("fields", "Required fields", "critical", "Missing: "+strings.Join(missing, ", "))
	} else {
		add("fields", "Required fields", "ok", "All required fields present")
	}

	// Artwork valid.
	if p.ArtworkURL == "" {
		add("artwork", "Artwork valid", "critical", "No artwork set")
	} else if st := a.urlStatus(ctx, p.ArtworkURL); st != 200 {
		add("artwork", "Artwork valid", "critical", fmt.Sprintf("Artwork URL returned %d", st))
	} else {
		var w, hh int
		a.DB.QueryRow(ctx, `SELECT width, height FROM images WHERE owner_type='podcast' AND owner_id=$1 AND status='READY' ORDER BY id DESC LIMIT 1`,
			podcastID).Scan(&w, &hh)
		if w > 0 && (w != hh || w < 1400 || w > 3000) {
			add("artwork", "Artwork valid", "warning", fmt.Sprintf("Artwork is %dx%d; directories require 1400–3000 px square", w, hh))
		} else {
			add("artwork", "Artwork valid", "ok", "Artwork reachable")
		}
	}

	// Audio reachable (latest 3 episodes).
	rows, err := a.DB.Query(ctx, `SELECT title, audio_url FROM episodes WHERE podcast_id=$1 AND status='PUBLISHED' AND audio_url<>''
		ORDER BY published_at DESC LIMIT 3`, podcastID)
	if err == nil {
		var bad []string
		n := 0
		for rows.Next() {
			var title, u string
			rows.Scan(&title, &u)
			n++
			if st := a.urlStatus(ctx, u); st != 200 && st != 206 {
				bad = append(bad, fmt.Sprintf("%s (%d)", title, st))
			}
		}
		rows.Close()
		switch {
		case n == 0:
			add("audio", "Audio reachable", "critical", "No published episodes with audio")
		case len(bad) > 0:
			add("audio", "Audio reachable", "critical", "Unreachable: "+strings.Join(bad, ", "))
		default:
			add("audio", "Audio reachable", "ok", fmt.Sprintf("Latest %d episode file(s) reachable", n))
		}
	}

	// Episode GUIDs: present and unique.
	var total, distinct, empty int
	a.DB.QueryRow(ctx, `SELECT count(*), count(DISTINCT guid), count(*) FILTER (WHERE guid='') FROM episodes WHERE podcast_id=$1`, podcastID).
		Scan(&total, &distinct, &empty)
	if empty > 0 || distinct != total {
		add("guid", "Episode GUID", "critical", "Missing or duplicate GUIDs detected")
	} else {
		add("guid", "Episode GUID", "ok", fmt.Sprintf("%d unique permanent GUID(s)", total))
	}

	// SSL.
	host := util.HostOf(feedURL)
	if strings.HasPrefix(feedURL, "https://") {
		if err := checkTLS(host); err != nil {
			add("ssl", "SSL", "critical", "TLS error: "+err.Error())
		} else {
			add("ssl", "SSL", "ok", "Valid certificate")
		}
	} else if IsLocalHost(host) {
		add("ssl", "SSL", "warning", "Development host served over HTTP")
	} else {
		add("ssl", "SSL", "critical", "Feed is not served over HTTPS")
	}

	h.Status = "HEALTHY"
	for _, c := range h.Checks {
		if c.Status == "critical" {
			h.Status = "CRITICAL"
			break
		}
		if c.Status == "warning" {
			h.Status = "WARNING"
		}
	}
	cj, _ := json.Marshal(h.Checks)
	a.DB.Exec(ctx, `INSERT INTO rss_health_checks(podcast_id, status, checks) VALUES ($1,$2,$3)`, podcastID, h.Status, cj)
	a.DB.Exec(ctx, `DELETE FROM rss_health_checks WHERE podcast_id=$1 AND id NOT IN
		(SELECT id FROM rss_health_checks WHERE podcast_id=$1 ORDER BY checked_at DESC LIMIT 20)`, podcastID)
	return h, nil
}

func uniq(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

// urlStatus returns the HTTP status for a HEAD/GET (range) of u, or 0 on network failure.
func (a *App) urlStatus(ctx context.Context, u string) int {
	client := util.SafeHTTPClient(15*time.Second, false)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return 0
	}
	req.Header.Set("Range", "bytes=0-1023")
	req.Header.Set("User-Agent", "PodcastEngine/1.0 HealthCheck")
	resp, err := client.Do(req)
	if err != nil {
		return 0
	}
	resp.Body.Close()
	if resp.StatusCode == 206 {
		return 200
	}
	return resp.StatusCode
}

func checkTLS(host string) error {
	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 10 * time.Second}, "tcp", host+":443", &tls.Config{ServerName: host})
	if err != nil {
		return err
	}
	defer conn.Close()
	certs := conn.ConnectionState().PeerCertificates
	if len(certs) == 0 {
		return fmt.Errorf("no certificate")
	}
	if time.Until(certs[0].NotAfter) < 7*24*time.Hour {
		return fmt.Errorf("certificate expires %s", certs[0].NotAfter.Format("2006-01-02"))
	}
	return nil
}

// CheckDomain verifies ownership (DNS TXT or HTTP token), DNS routing and SSL status (PRD §8).
func (a *App) CheckDomain(ctx context.Context, domainID int64) error {
	var d Domain
	err := a.DB.QueryRow(ctx, `SELECT id, tenant_id, domain, verification_token, verification_status FROM domains WHERE id=$1`, domainID).
		Scan(&d.ID, &d.TenantID, &d.Domain, &d.VerificationToken, &d.VerificationStatus)
	if err != nil {
		return err
	}
	if IsLocalHost(d.Domain) && a.Cfg.DevAutoVerifyLocalHosts {
		a.DB.Exec(ctx, `UPDATE domains SET verification_status='VERIFIED', dns_status='OK', ssl_status='NONE',
			verified_at=COALESCE(verified_at, now()), last_checked_at=now(), last_error='' WHERE id=$1`, d.ID)
		return nil
	}
	var errs []string
	verification := d.VerificationStatus

	// Ownership: TXT _podcast-verify.<domain> = token, or HTTP /.well-known/podcast-verify.txt.
	verified := false
	if txts, err := net.DefaultResolver.LookupTXT(ctx, "_podcast-verify."+d.Domain); err == nil {
		for _, t := range txts {
			if strings.TrimSpace(t) == d.VerificationToken {
				verified = true
			}
		}
	}
	if !verified {
		client := util.SafeHTTPClient(10*time.Second, false)
		if _, body, err := util.FetchLimited(ctx, client, "http://"+d.Domain+"/.well-known/podcast-verify.txt", 4096, nil); err == nil &&
			strings.Contains(string(body), d.VerificationToken) {
			verified = true
		}
	}
	if verified {
		verification = "VERIFIED"
	} else if verification != "VERIFIED" {
		verification = "FAILED"
		errs = append(errs, "Ownership not verified: add TXT record _podcast-verify."+d.Domain+" = "+d.VerificationToken)
	}

	// DNS routing.
	dns := "OK"
	addrs, err := net.DefaultResolver.LookupHost(ctx, d.Domain)
	if err != nil || len(addrs) == 0 {
		dns = "MISCONFIGURED"
		errs = append(errs, "DNS does not resolve")
	} else if a.Cfg.PlatformCNAMETarget != "" || len(a.Cfg.PlatformIPs) > 0 {
		ok := false
		if cname, err := net.DefaultResolver.LookupCNAME(ctx, d.Domain); err == nil && a.Cfg.PlatformCNAMETarget != "" &&
			strings.TrimSuffix(cname, ".") == strings.TrimSuffix(a.Cfg.PlatformCNAMETarget, ".") {
			ok = true
		}
		for _, ip := range addrs {
			for _, want := range a.Cfg.PlatformIPs {
				if ip == want {
					ok = true
				}
			}
		}
		if !ok {
			dns = "MISCONFIGURED"
			errs = append(errs, "DNS does not point to the platform")
		}
	}

	ssl := "ACTIVE"
	if err := checkTLS(d.Domain); err != nil {
		ssl = "FAILED"
		errs = append(errs, "SSL: "+err.Error())
	}
	a.DB.Exec(ctx, `UPDATE domains SET verification_status=$2, dns_status=$3, ssl_status=$4, last_error=$5, last_checked_at=now(),
		verified_at=CASE WHEN $2='VERIFIED' THEN COALESCE(verified_at, now()) ELSE verified_at END WHERE id=$1`,
		d.ID, verification, dns, ssl, strings.Join(errs, "; "))
	if len(errs) > 0 {
		a.Notify(ctx, &d.TenantID, "domain.error", "warning", "Domain error", d.Domain+": "+strings.Join(errs, "; "), "/domains")
	}
	a.InvalidateDomains(ctx, d.TenantID)
	return nil
}
