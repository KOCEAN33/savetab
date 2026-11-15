//go:build ignore

package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
)

func attrs() []slog.Attr { return nil }

// key stands for a constant of internal/platform/logline.
func run(key string) {
	ctx := context.Background()
	err := errors.New("down")
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	// ruleid: log-through-logline
	slog.Error("server stopped", "err", err)
	// ruleid: log-through-logline
	slog.InfoContext(ctx, "request done")
	// ruleid: log-through-logline
	logger.Info("request done", "user.id", "u1")
	// ruleid: log-through-logline
	logger.ErrorContext(ctx, "request failed", "err", err)
	// ruleid: log-through-logline
	logger = logger.With("service", "savetab-server")
	// ruleid: log-through-logline
	logger.LogAttrs(ctx, slog.LevelInfo, "http.request", slog.String("user.id", "u1"))
	// ruleid: log-through-logline
	_ = slog.Int64("duration_ms", 12)
	// ok: log-through-logline
	logger.LogAttrs(ctx, slog.LevelInfo, "http.request", attrs()...)
	// ok: log-through-logline
	_ = slog.String(key, "u1")
	// ok: log-through-logline
	_ = slog.StringValue("[redacted]")
	// ok: log-through-logline
	http.Error(httptest.NewRecorder(), "bad request", http.StatusBadRequest)
	// ok: log-through-logline
	logger = logger.With(slog.String(key, "savetab-server"))
}

func main() { run("user.id") }
