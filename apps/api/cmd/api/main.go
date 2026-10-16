// Command api runs the HTTP API server.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"podcast/api/internal/api"
	"podcast/api/internal/app"
	"podcast/api/internal/config"
	"podcast/api/internal/logx"
	"podcast/api/internal/worker"
)

func main() {
	cfg := config.Load()
	log := logx.New(cfg.LogLevel, "api")
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

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

	// Optional: run an embedded worker in the same process (single-node / development).
	if os.Getenv("EMBEDDED_WORKER") == "true" {
		go (&worker.Worker{App: a, ID: "embedded", Concurrency: cfg.WorkerConcurrency}).Run(ctx)
	}

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           api.New(a).Router(),
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		log.Info("api listening", "addr", srv.Addr, "env", cfg.Env, "storage", a.Storage.Driver())
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server error", "err", err)
			stop()
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	srv.Shutdown(shutdown)
	log.Info("api stopped")
}
