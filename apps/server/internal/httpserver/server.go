// Package httpserver is the HTTP server around the API: the gin engine, its middleware, and
// the one function that turns an error kind into a status.
package httpserver

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
)

const (
	readHeaderTimeout = 10 * time.Second
	idleTimeout       = 120 * time.Second
	// statusClientClosedRequest is nginx's status for a request its caller gave up on. net/http
	// has no name for it.
	statusClientClosedRequest = 499
)

// Debug mode prints to stdout, where cmd/savetab-e2e writes its URL as the first line.
func init() { gin.SetMode(gin.ReleaseMode) }

// Config holds the server's timeouts, from the service configuration.
type Config struct {
	RequestDeadline  time.Duration
	ReadyPingTimeout time.Duration
}

// Pinger reaches the database every request needs.
type Pinger interface {
	Ping(ctx context.Context) error
}

// Server is the http.Server whose /readyz knows when its listener is open.
type Server struct {
	*http.Server
	listening atomic.Bool
}

// New returns the server. Every request writes one line to logger, and its context ends after
// cfg.RequestDeadline. v1 serves /v1, the share viewer under /s/, and /healthz, as it routes
// them itself. register adds the /v2 routes.
func New(cfg Config, logger *slog.Logger, db Pinger, v1 http.Handler, register func(gin.IRouter)) *Server {
	s := &Server{}
	engine := gin.New()
	// A generated handler passes the gin context down as the request's context.
	engine.ContextWithFallback = true
	engine.HandleMethodNotAllowed = true
	engine.NoRoute(noRoute)
	engine.NoMethod(noMethod)
	engine.Use(requestLine(logger), requestDeadline(cfg.RequestDeadline), cors)
	engine.GET("/livez", func(c *gin.Context) { c.Status(http.StatusOK) })
	engine.GET("/readyz", s.ready(db, cfg.ReadyPingTimeout))
	mounted := gin.WrapH(v1)
	engine.Any("/v1/*path", mounted)
	engine.Any("/s/*path", mounted)
	engine.Any("/healthz", mounted)
	register(engine)
	s.Server = &http.Server{Handler: engine, ReadHeaderTimeout: readHeaderTimeout, IdleTimeout: idleTimeout}
	return s
}

// Serve serves on l, which is open, so /readyz may answer 200 from here on.
func (s *Server) Serve(l net.Listener) error {
	s.listening.Store(true)
	return s.Server.Serve(l)
}

func (s *Server) ready(db Pinger, timeout time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !s.listening.Load() {
			c.Status(http.StatusServiceUnavailable)
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), timeout)
		defer cancel()
		if err := db.Ping(ctx); err != nil {
			c.Status(http.StatusServiceUnavailable)
			return
		}
		c.Status(http.StatusOK)
	}
}

func requestDeadline(d time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), d)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}

// Status is the HTTP status for err's kind. Every handler error goes through it.
func Status(err error) int {
	switch errs.KindOf(err) {
	case errs.Invalid:
		return http.StatusBadRequest
	case errs.Unauthenticated:
		return http.StatusUnauthorized
	case errs.Forbidden:
		return http.StatusForbidden
	case errs.NotFound:
		return http.StatusNotFound
	case errs.Conflict:
		return http.StatusConflict
	case errs.RateLimited:
		return http.StatusTooManyRequests
	case errs.Cancelled:
		return statusClientClosedRequest
	case errs.Unavailable:
		return http.StatusServiceUnavailable
	case errs.Internal:
		return http.StatusInternalServerError
	}
	return http.StatusInternalServerError
}
