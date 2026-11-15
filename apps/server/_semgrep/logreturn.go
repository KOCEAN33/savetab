//go:build ignore

package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/KOCEAN33/savetab/apps/server/internal/platform/logline"
)

func load() error { return errors.New("down") }

func logged(logger *slog.Logger) error {
	if err := load(); err != nil {
		// ruleid: log-an-error-or-return-it
		logger.Error("load failed", "err", err)
		return err
	}
	return nil
}

func wrapped(ctx context.Context, logger *slog.Logger) (int, error) {
	if err := load(); err != nil {
		// ruleid: log-an-error-or-return-it
		logger.LogAttrs(ctx, slog.LevelError, "load failed", slog.Any("err", err))
		return 0, err
	}
	if err := load(); err != nil {
		// ruleid: log-an-error-or-return-it
		logger.ErrorContext(ctx, "load failed", "err", err)
		return 0, fmt.Errorf("load: %w", err)
	}
	return 1, nil
}

func recorded(ctx context.Context) error {
	if err := load(); err != nil {
		// ruleid: log-an-error-or-return-it
		logline.SetError(ctx, err)
		return err
	}
	return nil
}

func handled(ctx context.Context) int {
	if err := load(); err != nil {
		// ok: log-an-error-or-return-it
		logline.SetError(ctx, err)
		return 0
	}
	return 1
}

func returned() error {
	if err := load(); err != nil {
		// ok: log-an-error-or-return-it
		return fmt.Errorf("load: %w", err)
	}
	return nil
}
