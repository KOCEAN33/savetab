// Package wire is the composition root: it builds the server from its configuration and
// owns its start order and its stop.
package wire

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/caarlos0/env/v11"

	"github.com/KOCEAN33/savetab/apps/server/internal/api"
	"github.com/KOCEAN33/savetab/apps/server/internal/bus"
	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/KOCEAN33/savetab/apps/server/internal/httpserver"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/config"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/logline"
)

const service = "savetab-server"

// Options changes how Run starts.
type Options struct {
	// Listener, when set, is served in place of a listener on cfg.ListenAddr.
	Listener net.Listener
	// Log, when set, takes the log lines in place of stdout.
	Log io.Writer
	// Version and Commit name the build on every log line.
	Version string
	Commit  string
}

// Main is the whole of the server command: it loads the configuration from the environment,
// runs the server, and returns the process's exit code. version and commit name the build.
func Main(version, commit string) int {
	cfg, err := config.Load(env.Options{})
	if err != nil {
		// The log format is itself configuration, so a bad configuration has no logger yet.
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	// Run's stop line holds its error.
	if Run(context.Background(), cfg, Options{Version: version, Commit: commit}) != nil {
		return 1
	}
	return 0
}

// Run starts the server and serves until ctx ends or SIGINT or SIGTERM arrives, then stops
// it. It opens no listener before the database is reached and migrated. It writes a start line
// once the listener is open and a stop line with the reason, which holds the error it returns.
func Run(ctx context.Context, cfg config.Config, opts Options) error {
	out := opts.Log
	if out == nil {
		out = os.Stdout
	}
	// A host without a name still logs, with an empty instance.
	instance, _ := os.Hostname()
	logger := logline.NewLogger(out, cfg.LogFormat, cfg.LogLevel, logline.Process{
		Service: service, Version: opts.Version, Commit: opts.Commit, Instance: instance,
	})
	traceID := logline.NewTraceID()

	err := run(ctx, cfg, opts, logger, traceID)
	reason, level := logline.ReasonSignal, slog.LevelInfo
	switch {
	case err != nil:
		reason, level = logline.ReasonError, slog.LevelError
	case ctx.Err() != nil:
		reason = logline.ReasonContext
	}
	logger.LogAttrs(context.WithoutCancel(ctx), level, logline.EventStop, logline.StopAttrs(traceID, reason, err)...)
	return err
}

func run(ctx context.Context, cfg config.Config, opts Options, logger *slog.Logger, traceID string) error {
	ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	start, cancel := context.WithTimeout(ctx, cfg.StartWait)
	defer cancel()
	store, err := db.Open(start, cfg.DatabaseURL.Reveal(), db.Options{
		MaxConns: cfg.DBPoolMax, StatementTimeout: cfg.DBStatementTimeout, IdleInTxTimeout: cfg.DBIdleInTxTimeout,
	})
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
	srv := httpserver.New(httpserver.Config{RequestDeadline: cfg.RequestDeadline, ReadyPingTimeout: cfg.ReadyPingTimeout}, logger, b, api.New(b, login))
	l := opts.Listener
	if l == nil {
		if l, err = net.Listen("tcp", cfg.ListenAddr); err != nil {
			return err
		}
	}
	logger.LogAttrs(ctx, slog.LevelInfo, logline.EventStart, logline.StartAttrs(traceID, logline.Settings{
		ListenAddr: l.Addr().String(), PublicURL: cfg.PublicURL, OIDCIssuer: cfg.OIDCIssuer, OIDCClientID: cfg.OIDCClientID,
		AuthRedirectURIs: cfg.AuthRedirectURIs, DBPoolMax: cfg.DBPoolMax, DBStatementTimeout: cfg.DBStatementTimeout,
		DBIdleInTxTimeout: cfg.DBIdleInTxTimeout, StartWait: cfg.StartWait,
		RequestDeadline: cfg.RequestDeadline, ReadyPingTimeout: cfg.ReadyPingTimeout, HTTPDrainTimeout: cfg.HTTPDrainTimeout,
		ShutdownBudget: cfg.ShutdownBudget, LogFormat: cfg.LogFormat, LogLevel: cfg.LogLevel,
	})...)
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
