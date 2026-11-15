package httpserver

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/KOCEAN33/savetab/apps/server/internal/platform/logline"
)

// requestLine writes one line per request, when the request ends, and answers 500 for a
// handler that panics. It goes first in the chain, so every other handler runs inside it.
func requestLine(logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		// The caller's context: a later middleware gives the request a deadline of its own.
		caller := c.Request.Context()
		ctx, fields := logline.NewContext(caller, c.GetHeader("traceparent"))
		c.Request = c.Request.WithContext(ctx)
		method := c.Request.Method
		defer func() {
			var stack []byte
			if v := recover(); v != nil {
				stack = debug.Stack()
				fields.SetPanic(v)
				if !c.Writer.Written() {
					c.AbortWithStatus(http.StatusInternalServerError)
				}
			}
			// A failure to write the line leaves the answer as it is.
			defer func() { _ = recover() }()
			status := c.Writer.Status()
			outcome, level := outcomeOf(status, errors.Is(caller.Err(), context.Canceled), stack != nil)
			logger.LogAttrs(ctx, level, logline.EventRequest, fields.RequestAttrs(logline.Request{
				Method: method, Route: c.FullPath(), Status: status, Duration: time.Since(start), Outcome: outcome, Stack: stack,
			})...)
		}()
		c.Next()
	}
}

// outcomeOf is how a request ended and the level of its line: error only when the service
// failed the request.
func outcomeOf(status int, cancelled, panicked bool) (string, slog.Level) {
	switch {
	case panicked:
		return logline.OutcomeError, slog.LevelError
	case cancelled:
		return logline.OutcomeCancelled, slog.LevelInfo
	case status >= http.StatusInternalServerError:
		return logline.OutcomeError, slog.LevelError
	case status >= http.StatusBadRequest:
		return logline.OutcomeClientError, slog.LevelInfo
	}
	return logline.OutcomeSuccess, slog.LevelInfo
}
