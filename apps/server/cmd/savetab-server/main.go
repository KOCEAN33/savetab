// Command savetab-server serves the savetab sync API.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/caarlos0/env/v11"

	"github.com/KOCEAN33/savetab/apps/server/internal/api"
	"github.com/KOCEAN33/savetab/apps/server/internal/bus"
	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/config"
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
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	start, cancel := context.WithTimeout(ctx, cfg.StartWait)
	defer cancel()
	store, err := db.Open(start, cfg.DatabaseURL.Reveal(), cfg.DBPoolMax)
	if err != nil {
		return err
	}
	defer store.Close()
	if err := store.Migrate(ctx); err != nil {
		return err
	}

	login, err := api.NewLogin(ctx, api.LoginConfig{
		Issuer: cfg.OIDCIssuer, ClientID: cfg.OIDCClientID, PublicURL: cfg.PublicURL, RedirectURIs: cfg.AuthRedirectURIs,
	})
	if err != nil {
		return fmt.Errorf("OIDC issuer %s: %w", cfg.OIDCIssuer, err)
	}

	srv := &http.Server{Addr: cfg.ListenAddr, Handler: api.New(bus.New(store), login), ReadHeaderTimeout: 10 * time.Second}
	failed := make(chan error, 1)
	go func() { failed <- srv.ListenAndServe() }()
	slog.Info("listening", "addr", cfg.ListenAddr)
	select {
	case err := <-failed:
		return err
	case <-ctx.Done():
		drain, cancel := context.WithTimeout(context.Background(), cfg.HTTPDrainTimeout)
		defer cancel()
		return srv.Shutdown(drain)
	}
}
