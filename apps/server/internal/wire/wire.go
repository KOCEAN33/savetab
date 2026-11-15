// Package wire is the composition root: it builds the server from its configuration and
// owns its start order and its stop.
package wire

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/api"
	"github.com/KOCEAN33/savetab/apps/server/internal/bus"
	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/KOCEAN33/savetab/apps/server/internal/httpserver"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/config"
)

// Options changes how Run starts.
type Options struct {
	// Listener, when set, is served in place of a listener on cfg.ListenAddr.
	Listener net.Listener
}

// Run starts the server and serves until ctx ends or SIGINT or SIGTERM arrives, then stops
// it. It opens no listener before the database is reached and migrated.
func Run(ctx context.Context, cfg config.Config, opts Options) error {
	ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
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

	b := bus.New(store)
	srv := httpserver.New(httpserver.Config{RequestDeadline: cfg.RequestDeadline, ReadyPingTimeout: cfg.ReadyPingTimeout}, b, api.New(b, login))
	l := opts.Listener
	if l == nil {
		if l, err = net.Listen("tcp", cfg.ListenAddr); err != nil {
			return err
		}
	}
	return serve(ctx, stop, srv, l, cfg.HTTPDrainTimeout)
}

// serve serves on l until ctx ends, then calls stop, so a second signal ends the process, and
// gives running requests the drain timeout before it cancels them.
func serve(ctx context.Context, stop func(), srv *httpserver.Server, l net.Listener, drain time.Duration) error {
	failed := make(chan error, 1)
	go func() { failed <- srv.Serve(l) }()
	select {
	case err := <-failed:
		return err
	case <-ctx.Done():
	}
	stop()
	drained, cancel := context.WithTimeout(context.Background(), drain)
	defer cancel()
	err := srv.Shutdown(drained)
	if errors.Is(err, context.DeadlineExceeded) {
		// Closing the connections cancels the contexts of the requests still running.
		err = srv.Close()
	}
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
