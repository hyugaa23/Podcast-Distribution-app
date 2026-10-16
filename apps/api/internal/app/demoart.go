package app

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/google/uuid"

	"podcast/api/internal/storage"
)

// Demo cover art generator: poster-style podcast covers (big title typography, category label,
// host line, film grain) rendered with FFmpeg so demo sites look like real shows, not placeholders.

var fontCandidates = []string{
	os.Getenv("DEMO_FONT_BOLD"),
	`C:\Windows\Fonts\segoeuib.ttf`, `C:\Windows\Fonts\arialbd.ttf`,
	"/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
	"/usr/share/fonts/ttf-dejavu/DejaVuSans-Bold.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
}

var serifCandidates = []string{
	os.Getenv("DEMO_FONT_SERIF"),
	`C:\Windows\Fonts\georgiab.ttf`, "/usr/share/fonts/dejavu/DejaVuSerif-Bold.ttf",
	"/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", "/usr/share/fonts/ttf-dejavu/DejaVuSerif-Bold.ttf",
}

func firstExisting(paths []string) string {
	for _, p := range paths {
		if p == "" {
			continue
		}
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

// wrapWords splits text into lines of at most width characters.
func wrapWords(s string, width int) []string {
	var lines []string
	cur := ""
	for _, w := range strings.Fields(s) {
		if cur != "" && len(cur)+1+len(w) > width {
			lines = append(lines, cur)
			cur = w
		} else if cur == "" {
			cur = w
		} else {
			cur += " " + w
		}
	}
	if cur != "" {
		lines = append(lines, cur)
	}
	return lines
}

type coverSpec struct {
	Title, Kicker, Byline string
	C0, C1               string // 0xRRGGBB
	Style                int
	Size                 int
}

// renderCover draws a poster-like cover into out (JPEG). Text is passed via textfile= to avoid escaping.
func (a *App) renderCover(ctx context.Context, dir, out string, c coverSpec) error {
	size := c.Size
	if size == 0 {
		size = 1400
	}
	bold := firstExisting(fontCandidates)
	serif := firstExisting(serifCandidates)
	if serif == "" {
		serif = bold
	}
	write := func(name, text string) string {
		os.WriteFile(filepath.Join(dir, name), []byte(text), 0o644)
		return name
	}
	var vf []string
	// Base: diagonal gradient + grain + vignette.
	base := fmt.Sprintf("gradients=s=%dx%d:c0=%s:c1=%s:x0=0:y0=0:x1=%d:y1=%d:d=1", size, size, c.C0, c.C1, size, size)
	vf = append(vf, "noise=alls=14:allf=t", "vignette=PI/4.2")
	switch c.Style % 4 {
	case 1: // inset frame
		vf = append(vf, fmt.Sprintf("drawbox=x=%d:y=%d:w=%d:h=%d:color=white@0.85:t=6", size/16, size/16, size-size/8, size-size/8))
	case 2: // bold colour band at the bottom
		vf = append(vf, fmt.Sprintf("drawbox=x=0:y=%d:w=%d:h=%d:color=black@0.55:t=fill", size*58/100, size, size*42/100))
	case 3: // big translucent block top-left
		vf = append(vf, fmt.Sprintf("drawbox=x=%d:y=%d:w=%d:h=%d:color=white@0.12:t=fill", size/10, size/10, size*55/100, size*55/100))
	}
	if bold != "" {
		if err := copyFile(bold, filepath.Join(dir, "bold.ttf")); err != nil {
			return err
		}
		if err := copyFile(serif, filepath.Join(dir, "serif.ttf")); err != nil {
			return err
		}
		font := "bold.ttf"
		if c.Style%4 == 1 {
			font = "serif.ttf"
		}
		lines := wrapWords(strings.ToUpper(c.Title), 11)
		if c.Style%4 == 1 {
			lines = wrapWords(c.Title, 13)
		}
		if len(lines) > 4 {
			lines = lines[:4]
		}
		fs := size * 13 / 100
		if len(lines) >= 3 {
			fs = size * 105 / 1000
		}
		// Keep the longest line inside the safe area (bold caps ≈ 0.64em per character).
		longest := 0
		for _, l := range lines {
			if n := len([]rune(l)); n > longest {
				longest = n
			}
		}
		if longest > 0 {
			if maxFs := size * 80 / 100 * 100 / (64 * longest); fs > maxFs {
				fs = maxFs
			}
		}
		lineH := fs * 108 / 100
		pad := size * 9 / 100
		startY := size - pad - size*7/100 - lineH*len(lines)
		if c.Style%4 == 3 {
			startY = size * 15 / 100
		}
		x := fmt.Sprint(pad)
		if c.Style%4 == 1 {
			startY = (size - lineH*len(lines)) / 2
			x = "(w-text_w)/2"
		}
		for i, l := range lines {
			f := write(fmt.Sprintf("l%d.txt", i), l)
			vf = append(vf, fmt.Sprintf("drawtext=fontfile=%s:textfile=%s:fontcolor=white:fontsize=%d:x=%s:y=%d:shadowcolor=black@0.35:shadowx=0:shadowy=%d",
				font, f, fs, x, startY+i*lineH, size/200))
		}
		kicker := write("k.txt", strings.ToUpper(c.Kicker))
		vf = append(vf, fmt.Sprintf("drawtext=fontfile=bold.ttf:textfile=%s:fontcolor=white@0.9:fontsize=%d:x=%d:y=%d", kicker, size*32/1000, pad, pad))
		if c.Byline != "" {
			by := write("b.txt", c.Byline)
			bx := fmt.Sprint(pad)
			if c.Style%4 == 1 {
				bx = "(w-text_w)/2"
			}
			vf = append(vf, fmt.Sprintf("drawtext=fontfile=bold.ttf:textfile=%s:fontcolor=white@0.85:fontsize=%d:x=%s:y=h-%d", by, size*38/1000, bx, pad+size*4/100))
		}
	}
	cmd := exec.CommandContext(ctx, a.Cfg.FFmpegPath, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", base,
		"-vf", strings.Join(vf, ","), "-frames:v", "1", "-q:v", "3", out)
	cmd.Dir = dir
	if b, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("ffmpeg cover: %v %s", err, b)
	}
	return nil
}

// renderBanner draws a wide, text-free textured banner (hero backgrounds use it instead of the cover).
func (a *App) renderBanner(ctx context.Context, dir, out, c0, c1 string) error {
	base := fmt.Sprintf("gradients=s=1920x900:c0=%s:c1=%s:x0=0:y0=900:x1=1920:y1=0:nb_colors=2:d=1", c0, c1)
	vf := "noise=alls=12:allf=t,vignette=PI/3.6,drawbox=x=1240:y=-200:w=900:h=900:color=white@0.06:t=fill,drawbox=x=-200:y=520:w=700:h=700:color=black@0.12:t=fill"
	cmd := exec.CommandContext(ctx, a.Cfg.FFmpegPath, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", base,
		"-vf", vf, "-frames:v", "1", "-q:v", "3", out)
	cmd.Dir = dir
	if b, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("ffmpeg banner: %v %s", err, b)
	}
	return nil
}

// renderAvatar draws an initials avatar (host photo placeholder) with a soft ring.
func (a *App) renderAvatar(ctx context.Context, dir, out, name, c0, c1 string) error {
	bold := firstExisting(fontCandidates)
	base := fmt.Sprintf("gradients=s=600x600:c0=%s:c1=%s:x0=0:y0=600:x1=600:y1=0:d=1", c0, c1)
	vf := []string{"noise=alls=10:allf=t", "drawbox=x=40:y=40:w=520:h=520:color=white@0.18:t=10"}
	if bold != "" {
		if err := copyFile(bold, filepath.Join(dir, "bold.ttf")); err != nil {
			return err
		}
		var ini string
		for _, w := range strings.Fields(name) {
			if r := []rune(w); len(r) > 0 && len([]rune(ini)) < 2 && (r[0] >= 'A' && r[0] <= 'Z') {
				ini += string(r[0])
			}
		}
		os.WriteFile(filepath.Join(dir, "ini.txt"), []byte(ini), 0o644)
		vf = append(vf, "drawtext=fontfile=bold.ttf:textfile=ini.txt:fontcolor=white:fontsize=230:x=(w-text_w)/2:y=(h-text_h)/2-10:shadowcolor=black@0.3:shadowy=4")
	}
	cmd := exec.CommandContext(ctx, a.Cfg.FFmpegPath, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", base,
		"-vf", strings.Join(vf, ","), "-frames:v", "1", "-q:v", "3", out)
	cmd.Dir = dir
	if b, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("ffmpeg avatar: %v %s", err, b)
	}
	return nil
}

// storeDemoImage uploads a rendered file, registers it with the image pipeline and returns its URL.
func (a *App) storeDemoImage(ctx context.Context, path, key, ownerType string, ownerID int64, tenantID *int64) (string, error) {
	size, err := a.putFile(ctx, key, path, "image/jpeg")
	if err != nil {
		return "", err
	}
	var imgID int64
	a.DB.QueryRow(ctx, `INSERT INTO images(tenant_id, owner_type, owner_id, original_key, mime, size) VALUES ($1,$2,$3,$4,'image/jpeg',$5) RETURNING id`,
		tenantID, ownerType, ownerID, key, size).Scan(&imgID)
	if err := a.ProcessImage(ctx, imgID); err != nil {
		return "", err
	}
	return a.Storage.URL(key), nil
}

// RefreshDemoArtwork re-renders covers and host avatars for the demo podcasts (go run ./cmd/migrate -demo-art).
func (a *App) RefreshDemoArtwork(ctx context.Context) (int, error) {
	all := map[string]demoPodcast{}
	for _, t := range demoTenants {
		for _, p := range t.Podcasts {
			all[p.Title] = p
		}
	}
	for _, p := range library {
		all[p.Title] = p
	}
	rows, err := a.DB.Query(ctx, `SELECT p.id, p.title, p.owner_tenant_id, COALESCE(c.name,'Podcast') FROM podcasts p
		LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.id`)
	if err != nil {
		return 0, err
	}
	type row struct {
		id    int64
		title string
		owner *int64
		cat   string
	}
	var list []row
	for rows.Next() {
		var r row
		rows.Scan(&r.id, &r.title, &r.owner, &r.cat)
		list = append(list, r)
	}
	rows.Close()
	n := 0
	for i, r := range list {
		dp, ok := all[r.title]
		if !ok {
			continue
		}
		dir, err := os.MkdirTemp("", "pe-art")
		if err != nil {
			return n, err
		}
		out := filepath.Join(dir, "cover.jpg")
		if err := a.renderCover(ctx, dir, out, coverSpec{Title: r.title, Kicker: r.cat + " podcast", Byline: "with " + dp.Host,
			C0: dp.Colors[0], C1: dp.Colors[1], Style: i}); err != nil {
			os.RemoveAll(dir)
			return n, err
		}
		url, err := a.storeDemoImage(ctx, out, storage.PodcastKey(r.id, "artwork-"+uuid.NewString()[:8]+".jpg"), "podcast", r.id, r.owner)
		if err != nil {
			os.RemoveAll(dir)
			return n, err
		}
		a.DB.Exec(ctx, `UPDATE podcasts SET artwork_url=$2, updated_at=now() WHERE id=$1`, r.id, url)
		bn := filepath.Join(dir, "banner.jpg")
		if err := a.renderBanner(ctx, dir, bn, dp.Colors[0], dp.Colors[1]); err == nil {
			if bu, err := a.storeDemoImage(ctx, bn, storage.PodcastKey(r.id, "banner-"+uuid.NewString()[:8]+".jpg"), "podcast_banner", r.id, r.owner); err == nil {
				a.DB.Exec(ctx, `UPDATE podcasts SET banner_url=$2 WHERE id=$1`, r.id, bu)
			}
		}
		// Host avatars.
		hrows, _ := a.DB.Query(ctx, `SELECT h.id, h.name FROM hosts h JOIN podcast_hosts ph ON ph.host_id=h.id WHERE ph.podcast_id=$1`, r.id)
		type hr struct {
			id   int64
			name string
		}
		var hs []hr
		for hrows.Next() {
			var h hr
			hrows.Scan(&h.id, &h.name)
			hs = append(hs, h)
		}
		hrows.Close()
		for _, h := range hs {
			av := filepath.Join(dir, fmt.Sprintf("host-%d.jpg", h.id))
			if err := a.renderAvatar(ctx, dir, av, h.name, dp.Colors[1], dp.Colors[0]); err == nil {
				if u, err := a.storeDemoImage(ctx, av, storage.TenantImageKey(deref(r.owner), "host-"+uuid.NewString()[:8]+".jpg"), "host", h.id, r.owner); err == nil {
					a.DB.Exec(ctx, `UPDATE hosts SET photo_url=$2, updated_at=now() WHERE id=$1`, h.id, u)
				}
			}
		}
		os.RemoveAll(dir)
		a.InvalidatePodcast(ctx, r.id)
		n++
	}
	a.Cache.DelPrefix(ctx, "t:")
	a.Cache.DelPrefix(ctx, "feed:")
	return n, nil
}
