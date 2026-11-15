// Command savetab-server serves the savetab sync API.
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/caarlos0/env/v11"

	"github.com/KOCEAN33/savetab/apps/server/internal/platform/config"
	"github.com/KOCEAN33/savetab/apps/server/internal/wire"
)

func main() {
	if err := run(); err != nil {
		slog.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load(env.Options{})
	if err != nil {
		return err
	}
	return wire.Run(context.Background(), cfg, wire.Options{})
}
