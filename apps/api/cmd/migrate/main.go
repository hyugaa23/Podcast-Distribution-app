// Command migrate applies database migrations, seeds base data and optionally demo content.
//
//	go run ./cmd/migrate            # migrations + themes, categories, platforms, settings, super admin
//	go run ./cmd/migrate -demo      # also create demo tenants (one per theme), podcasts and episodes
//	go run ./cmd/migrate -rebase-media http://localhost:8080/media=https://media.example.com
//	                                # rewrite stored media URLs after moving storage / adding a CDN
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"strings"

	"podcast/api/internal/app"
	"podcast/api/internal/config"
	"podcast/api/internal/logx"
)

func main() {
	demo := flag.Bool("demo", false, "seed demo tenants, podcasts and episodes")
	demoArt := flag.Bool("demo-art", false, "re-render demo podcast covers and host avatars")
	rebase := flag.String("rebase-media", "", "OLD=NEW: rewrite stored media URLs from OLD base to NEW base")
	flag.Parse()

	cfg := config.Load()
	log := logx.New(cfg.LogLevel, "migrate")
	slog.SetDefault(log)
	ctx := context.Background()

	a, err := app.New(ctx, cfg, log)
	if err != nil {
		log.Error("startup failed", "err", err)
		os.Exit(1)
	}
	defer a.Close()
	if err := a.EnsureBaseData(ctx); err != nil {
		log.Error("seed failed", "err", err)
		os.Exit(1)
	}
	if *demo {
		if cfg.IsProduction() {
			log.Error("-demo flag is not allowed in production (APP_ENV=" + cfg.Env + ")")
			os.Exit(1)
		}
		if err := a.SeedDemo(ctx); err != nil {
			log.Error("demo seed failed", "err", err)
			os.Exit(1)
		}
	}
	if *demoArt {
		n, err := a.RefreshDemoArtwork(ctx)
		if err != nil {
			log.Error("demo art failed", "err", err)
			os.Exit(1)
		}
		log.Info("demo artwork refreshed", "podcasts", n)
	}
	if *rebase != "" {
		from, to, ok := strings.Cut(*rebase, "=")
		if !ok {
			log.Error("-rebase-media expects OLD=NEW")
			os.Exit(1)
		}
		n, err := a.RebaseMediaURL(ctx, from, to)
		if err != nil {
			log.Error("rebase failed", "err", err)
			os.Exit(1)
		}
		log.Info("media URLs rewritten", "rows", n, "from", from, "to", to)
	}
	log.Info("database ready")
}
