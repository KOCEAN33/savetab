package httpserver

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
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
	srv := New(Config{RequestDeadline: time.Second, ReadyPingTimeout: time.Second}, slog.New(slog.DiscardHandler), pinger{}, http.NotFoundHandler(), func(gin.IRouter) {})
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
	handler := New(Config{RequestDeadline: time.Second, ReadyPingTimeout: time.Second}, slog.New(slog.DiscardHandler), pinger{}, mux, func(gin.IRouter) {}).Handler

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
	}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		if w.Code != tc.status || w.Body.String() != tc.body {
			t.Errorf("%s %s = %d %q, want %d %q", tc.method, tc.path, w.Code, w.Body.String(), tc.status, tc.body)
		}
	}
}

type pinger struct {
	err   error
	block bool
}

func (p pinger) Ping(ctx context.Context) error {
	if p.block {
		<-ctx.Done()
		return ctx.Err()
	}
	return p.err
}

// serve runs srv on a free local port until the test ends and returns its URL.
func serve(t *testing.T, srv *Server) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go srv.Serve(l)
	t.Cleanup(func() { srv.Close() })
	return "http://" + l.Addr().String()
}

func get(t *testing.T, url string) int {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

func TestHealthWithTheDatabaseDown(t *testing.T) {
	url := serve(t, New(Config{RequestDeadline: time.Second, ReadyPingTimeout: time.Second}, slog.New(slog.DiscardHandler), pinger{err: errors.New("connection refused")}, http.NotFoundHandler(), func(gin.IRouter) {}))
	if got := get(t, url+"/livez"); got != 200 {
		t.Errorf("/livez = %d, want 200", got)
	}
	if got := get(t, url+"/readyz"); got != 503 {
		t.Errorf("/readyz = %d, want 503", got)
	}
}

func TestReadyzWithTheDatabaseUp(t *testing.T) {
	url := serve(t, New(Config{RequestDeadline: time.Second, ReadyPingTimeout: time.Second}, slog.New(slog.DiscardHandler), pinger{}, http.NotFoundHandler(), func(gin.IRouter) {}))
	if got := get(t, url+"/readyz"); got != 200 {
		t.Errorf("/readyz = %d, want 200", got)
	}
}

func TestReadyzBeforeTheListenerOpens(t *testing.T) {
	srv := New(Config{RequestDeadline: time.Second, ReadyPingTimeout: time.Second}, slog.New(slog.DiscardHandler), pinger{}, http.NotFoundHandler(), func(gin.IRouter) {})
	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if w.Code != 503 {
		t.Errorf("/readyz before Serve = %d, want 503", w.Code)
	}
}

func TestReadyzWhenThePingOutlastsItsTimeout(t *testing.T) {
	url := serve(t, New(Config{RequestDeadline: 5 * time.Second, ReadyPingTimeout: 50 * time.Millisecond}, slog.New(slog.DiscardHandler), pinger{block: true}, http.NotFoundHandler(), func(gin.IRouter) {}))
	start := time.Now()
	if got := get(t, url+"/readyz"); got != 503 {
		t.Errorf("/readyz = %d, want 503", got)
	}
	if took := time.Since(start); took > time.Second {
		t.Errorf("/readyz took %v, want it to end at the 50ms ping timeout", took)
	}
}
