package httpserver

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
)

func TestStatus(t *testing.T) {
	cases := []struct {
		err  error
		want int
	}{
		{errs.New(errs.Invalid, "op", ""), 400},
		{errs.New(errs.Unauthenticated, "op", ""), 401},
		{errs.New(errs.Forbidden, "op", ""), 403},
		{errs.New(errs.NotFound, "op", ""), 404},
		{errs.New(errs.Conflict, "op", ""), 409},
		{errs.New(errs.RateLimited, "op", ""), 429},
		{errs.New(errs.Cancelled, "op", ""), 499},
		{errs.New(errs.Unavailable, "op", ""), 503},
		{errs.New(errs.Internal, "op", ""), 500},
		{errors.New("no kind"), 500},
		{fmt.Errorf("outer: %w", errs.New(errs.NotFound, "op", "")), 404},
	}
	for _, tc := range cases {
		if got := Status(tc.err); got != tc.want {
			t.Errorf("Status(%v) = %d, want %d", tc.err, got, tc.want)
		}
	}
}

func TestRequestDeadlineCancelsTheContext(t *testing.T) {
	engine := gin.New()
	engine.Use(requestDeadline(20 * time.Millisecond))
	ended := make(chan error, 1)
	engine.GET("/slow", func(c *gin.Context) {
		select {
		case <-c.Request.Context().Done():
			ended <- c.Request.Context().Err()
		case <-time.After(5 * time.Second):
			ended <- nil
		}
	})
	engine.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/slow", nil))
	if err := <-ended; !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("context ended with %v, want %v", err, context.DeadlineExceeded)
	}
}

func TestNewSetsConnectionTimeouts(t *testing.T) {
	srv := New(":0", time.Second, http.NotFoundHandler())
	if srv.ReadHeaderTimeout <= 0 || srv.IdleTimeout <= 0 {
		t.Fatalf("ReadHeaderTimeout %v, IdleTimeout %v, want both positive", srv.ReadHeaderTimeout, srv.IdleTimeout)
	}
}

func TestNewMountsTheV1Handler(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { io.WriteString(w, "health") })
	mux.HandleFunc("DELETE /v1/devices/{id}", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "device "+r.PathValue("id")) })
	mux.HandleFunc("GET /s/{id}", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "share "+r.PathValue("id")) })
	mux.HandleFunc("OPTIONS /v1/ops", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	handler := New("", time.Second, mux).Handler

	cases := []struct {
		method, path string
		status       int
		body         string
	}{
		{http.MethodGet, "/healthz", 200, "health"},
		{http.MethodDelete, "/v1/devices/d1", 200, "device d1"},
		{http.MethodGet, "/s/abc", 200, "share abc"},
		{http.MethodOptions, "/v1/ops", 204, ""},
		{http.MethodPost, "/healthz", 405, "Method Not Allowed\n"},
		{http.MethodGet, "/elsewhere", 404, "404 page not found"},
	}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		if w.Code != tc.status || w.Body.String() != tc.body {
			t.Errorf("%s %s = %d %q, want %d %q", tc.method, tc.path, w.Code, w.Body.String(), tc.status, tc.body)
		}
	}
}
