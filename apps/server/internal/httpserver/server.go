// Package httpserver is the HTTP server around the API: the gin engine, its middleware, and
// the one function that turns an error kind into a status.
package httpserver

import (
	"context"
	"net/http"
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

// New returns the server for addr. Every request's context ends after deadline. v1 serves
// /v1, the share viewer under /s/, and /healthz, as it routes them itself.
func New(addr string, deadline time.Duration, v1 http.Handler) *http.Server {
	engine := gin.New()
	engine.Use(requestDeadline(deadline))
	mounted := gin.WrapH(v1)
	engine.Any("/v1/*path", mounted)
	engine.Any("/s/*path", mounted)
	engine.Any("/healthz", mounted)
	return &http.Server{Addr: addr, Handler: engine, ReadHeaderTimeout: readHeaderTimeout, IdleTimeout: idleTimeout}
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
