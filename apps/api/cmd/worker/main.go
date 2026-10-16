// Command worker runs background jobs and the cron scheduler (PRD §72, §73).
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"podcast/api/internal/app"
	"podcast/api/internal/config"
	"podcast/api/internal/logx"
	"podcast/api/internal/worker"
)

func main() {
	cfg := config.Load()
	log := logx.New(cfg.LogLevel, "worker")
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
	(&worker.Worker{App: a, ID: os.Getenv("WORKER_ID"), Concurrency: cfg.WorkerConcurrency}).Run(ctx)
	log.Info("worker stopped")
}
