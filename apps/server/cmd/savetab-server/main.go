// Command savetab-server serves the savetab sync API.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/api"
	"github.com/KOCEAN33/savetab/apps/server/internal/store"
)

func main() {
	if err := run(); err != nil {
		slog.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return errors.New("DATABASE_URL is not set")
	}
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	cfg := api.LoginConfig{
		Issuer:       os.Getenv("OIDC_ISSUER"),
		ClientID:     os.Getenv("OIDC_CLIENT_ID"),
		ClientSecret: os.Getenv("OIDC_CLIENT_SECRET"),
		PublicURL:    os.Getenv("PUBLIC_URL"),
		RedirectURIs: strings.Fields(os.Getenv("AUTH_REDIRECT_URIS")),
	}
	if cfg.Issuer == "" || cfg.ClientID == "" || cfg.PublicURL == "" || len(cfg.RedirectURIs) == 0 {
		return errors.New("OIDC_ISSUER, OIDC_CLIENT_ID, PUBLIC_URL, and AUTH_REDIRECT_URIS must be set")
	}

	db, err := store.Open(ctx, url)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := db.Migrate(ctx); err != nil {
		return err
	}

	login, err := api.NewLogin(ctx, cfg)
	if err != nil {
		return fmt.Errorf("OIDC issuer %s: %w", cfg.Issuer, err)
	}

	srv := &http.Server{Addr: addr, Handler: api.New(db, login), ReadHeaderTimeout: 10 * time.Second}
	failed := make(chan error, 1)
	go func() { failed <- srv.ListenAndServe() }()
	slog.Info("listening", "addr", addr)
	select {
	case err := <-failed:
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return srv.Shutdown(shutdown)
	}
}
