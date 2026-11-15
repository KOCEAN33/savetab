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
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/gin-gonic/gin"
	ginmiddleware "github.com/oapi-codegen/gin-middleware"

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

	srv, err := NewServer(httpserver.Config{RequestDeadline: cfg.RequestDeadline, ReadyPingTimeout: cfg.ReadyPingTimeout}, logger, bus.New(store), login)
	if err != nil {
		return err
	}
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

// NewServer builds the HTTP server over the use cases: /v1 as it routes itself, and /v2 as
// api/openapi.yaml declares it. A /v2 request passes the token check, the body limit, and the
// contract's validator, in that order, before its handler.
func NewServer(cfg httpserver.Config, logger *slog.Logger, b *bus.Bus, login *api.Login) (*httpserver.Server, error) {
	spec, err := api.GetSpec()
	if err != nil {
		return nil, fmt.Errorf("read the embedded contract: %w", err)
	}
	// The validator would otherwise hold each request's Host to the contract's servers.
	spec.Servers = nil
	validate := ginmiddleware.OapiRequestValidatorWithOptions(spec, &ginmiddleware.Options{
		ErrorHandler: func(c *gin.Context, message string, _ int) { httpserver.InvalidProblem(c, errors.New(message)) },
		Options:      openapi3filter.Options{AuthenticationFunc: openapi3filter.NoopAuthenticationFunc},
	})
	strict := api.NewStrictHandlerWithOptions(api.NewHandlers(b, login, spec), nil, api.StrictGinServerOptions{
		RequestErrorHandlerFunc:  httpserver.InvalidProblem,
		HandlerErrorFunc:         httpserver.Problem,
		ResponseErrorHandlerFunc: httpserver.Problem,
	})
	return httpserver.New(cfg, logger, b, api.New(b, login), func(r gin.IRouter) {
		api.RegisterHandlersWithOptions(r, strict, api.GinServerOptions{
			Middlewares: []api.MiddlewareFunc{
				api.Authenticate(b, spec, httpserver.Problem),
				api.MiddlewareFunc(httpserver.BodyLimit(api.BodyLimits(spec))),
				api.MiddlewareFunc(validate),
			},
			ErrorHandler: func(c *gin.Context, err error, _ int) { httpserver.InvalidProblem(c, err) },
		})
	}), nil
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
