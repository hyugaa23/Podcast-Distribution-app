// Package logx configures structured JSON logging for application and worker logs (PRD §79).
package logx

import (
	"log/slog"
	"os"
	"strings"
)

func New(level, service string) *slog.Logger {
	var lv slog.Level
	switch strings.ToLower(level) {
	case "debug":
		lv = slog.LevelDebug
	case "warn", "warning":
		lv = slog.LevelWarn
	case "error":
		lv = slog.LevelError
	default:
		lv = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: lv})).With("service", service)
}
