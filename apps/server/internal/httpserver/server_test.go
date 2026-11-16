package httpserver_test

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

	"github.com/KOCEAN33/savetab/apps/server/internal/httpserver"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
)

var serverConfig = httpserver.Config{RequestDeadline: 10 * time.Second, ReadyPingTimeout: time.Second}

func TestStatus(t *testing.T) {
	t.Parallel()
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
		if got := httpserver.Status(tc.err); got != tc.want {
			t.Errorf("httpserver.Status(%v) = %d, want %d", tc.err, got, tc.want)
		}
	}
}

func TestRequestDeadlineCancelsTheContext(t *testing.T) {
	t.Parallel()
	ended := make(chan error, 1)
	engine := httpserver.New(httpserver.Config{RequestDeadline: 20 * time.Millisecond, ReadyPingTimeout: time.Second}, slog.New(slog.DiscardHandler), pinger{}, func(r gin.IRouter) {
		r.GET("/slow", func(c *gin.Context) {
			select {
			case <-c.Request.Context().Done():
				ended <- c.Request.Context().Err()
			case <-time.After(5 * time.Second):
				ended <- nil
			}
		})
	}).Handler
	engine.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/slow", nil))
	if err := <-ended; !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("context ended with %v, want %v", err, context.DeadlineExceeded)
	}
}

func TestNewSetsConnectionTimeouts(t *testing.T) {
	t.Parallel()
	srv := httpserver.New(httpserver.Config{RequestDeadline: time.Second, ReadyPingTimeout: time.Second}, slog.New(slog.DiscardHandler), pinger{}, func(gin.IRouter) {})
	if srv.ReadHeaderTimeout <= 0 || srv.IdleTimeout <= 0 {
		t.Fatalf("ReadHeaderTimeout %v, IdleTimeout %v, want both positive", srv.ReadHeaderTimeout, srv.IdleTimeout)
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
func serve(t *testing.T, srv *httpserver.Server) string {
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
	t.Parallel()
	url := serve(t, httpserver.New(httpserver.Config{RequestDeadline: time.Second, ReadyPingTimeout: time.Second}, slog.New(slog.DiscardHandler), pinger{err: errors.New("connection refused")}, func(gin.IRouter) {}))
	if got := get(t, url+"/livez"); got != 200 {
		t.Errorf("/livez = %d, want 200", got)
	}
	if got := get(t, url+"/readyz"); got != 503 {
		t.Errorf("/readyz = %d, want 503", got)
	}
}

func TestReadyzWithTheDatabaseUp(t *testing.T) {
	t.Parallel()
	url := serve(t, httpserver.New(httpserver.Config{RequestDeadline: time.Second, ReadyPingTimeout: time.Second}, slog.New(slog.DiscardHandler), pinger{}, func(gin.IRouter) {}))
	if got := get(t, url+"/readyz"); got != 200 {
		t.Errorf("/readyz = %d, want 200", got)
	}
}

func TestReadyzBeforeTheListenerOpens(t *testing.T) {
	t.Parallel()
	srv := httpserver.New(httpserver.Config{RequestDeadline: time.Second, ReadyPingTimeout: time.Second}, slog.New(slog.DiscardHandler), pinger{}, func(gin.IRouter) {})
	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if w.Code != 503 {
		t.Errorf("/readyz before Serve = %d, want 503", w.Code)
	}
}

func TestReadyzWhenThePingOutlastsItsTimeout(t *testing.T) {
	t.Parallel()
	url := serve(t, httpserver.New(httpserver.Config{RequestDeadline: 5 * time.Second, ReadyPingTimeout: 50 * time.Millisecond}, slog.New(slog.DiscardHandler), pinger{block: true}, func(gin.IRouter) {}))
	start := time.Now()
	if got := get(t, url+"/readyz"); got != 503 {
		t.Errorf("/readyz = %d, want 503", got)
	}
	if took := time.Since(start); took > time.Second {
		t.Errorf("/readyz took %v, want it to end at the 50ms ping timeout", took)
	}
}

// start serves handler at GET /work through ServeUntil on a free port and returns its address, a
// function that triggers the stop, and the channel ServeUntil's result arrives on.
func start(t *testing.T, drain time.Duration, handler http.HandlerFunc) (addr string, trigger func(), done <-chan error) {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	srv := httpserver.New(serverConfig, slog.New(slog.DiscardHandler), pinger{}, func(r gin.IRouter) { r.GET("/work", gin.WrapF(handler)) })
	result := make(chan error, 1)
	go func() { result <- srv.ServeUntil(ctx, func() {}, l, drain) }()
	t.Cleanup(cancel)
	return l.Addr().String(), cancel, result
}

func TestStopFinishesASlowRequest(t *testing.T) {
	t.Parallel()
	began := make(chan struct{})
	addr, trigger, done := start(t, 5*time.Second, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(began)
		time.Sleep(300 * time.Millisecond)
		io.WriteString(w, "done")
	}))
	type answer struct {
		status int
		body   string
		err    error
	}
	answered := make(chan answer, 1)
	go func() {
		resp, err := http.Get("http://" + addr + "/work")
		if err != nil {
			answered <- answer{err: err}
			return
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		answered <- answer{resp.StatusCode, string(body), err}
	}()
	<-began
	trigger()
	if a := <-answered; a.err != nil || a.status != 200 || a.body != "done" {
		t.Fatalf("slow request = %d %q %v, want 200 \"done\"", a.status, a.body, a.err)
	}
	if err := <-done; err != nil {
		t.Fatalf("ServeUntil = %v, want nil", err)
	}
	if conn, err := net.Dial("tcp", addr); err == nil {
		conn.Close()
		t.Fatal("a new connection was accepted after the stop")
	}
}

func TestStopCancelsARequestPastTheDrain(t *testing.T) {
	t.Parallel()
	began := make(chan struct{})
	ended := make(chan error, 1)
	addr, trigger, done := start(t, 100*time.Millisecond, http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		close(began)
		select {
		case <-r.Context().Done():
			ended <- r.Context().Err()
		case <-time.After(5 * time.Second):
			ended <- nil
		}
	}))
	go func() {
		if resp, err := http.Get("http://" + addr + "/work"); err == nil {
			resp.Body.Close()
		}
	}()
	<-began
	trigger()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("ServeUntil = %v, want nil", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("ServeUntil still running 2s after a 100ms drain")
	}
	if err := <-ended; !errors.Is(err, context.Canceled) {
		t.Fatalf("request context ended with %v, want %v", err, context.Canceled)
	}
}
