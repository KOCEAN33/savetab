package wire

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/httpserver"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/config"
)

type pingOK struct{}

func (pingOK) Ping(context.Context) error { return nil }

// start serves v1 through serve on a free port and returns its address, a function that
// triggers the stop, and the channel serve's result arrives on.
func start(t *testing.T, drain time.Duration, v1 http.Handler) (addr string, trigger func(), done <-chan error) {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	srv := httpserver.New(httpserver.Config{RequestDeadline: 10 * time.Second, ReadyPingTimeout: time.Second}, pingOK{}, v1)
	result := make(chan error, 1)
	go func() { result <- serve(ctx, func() {}, srv, l, drain) }()
	t.Cleanup(cancel)
	return l.Addr().String(), cancel, result
}

func TestStopFinishesASlowRequest(t *testing.T) {
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
		resp, err := http.Get("http://" + addr + "/v1/slow")
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
		t.Fatalf("serve = %v, want nil", err)
	}
	if conn, err := net.Dial("tcp", addr); err == nil {
		conn.Close()
		t.Fatal("a new connection was accepted after the stop")
	}
}

func TestStopCancelsARequestPastTheDrain(t *testing.T) {
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
		if resp, err := http.Get("http://" + addr + "/v1/stuck"); err == nil {
			resp.Body.Close()
		}
	}()
	<-began
	trigger()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("serve = %v, want nil", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("serve still running 2s after a 100ms drain")
	}
	if err := <-ended; !errors.Is(err, context.Canceled) {
		t.Fatalf("request context ended with %v, want %v", err, context.Canceled)
	}
}

func TestRunWithAnUnreachableDatabaseOpensNoListener(t *testing.T) {
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := probe.Addr().String()
	probe.Close()
	cfg := config.Config{
		DatabaseURL: "postgres://savetab@127.0.0.1:1/savetab?connect_timeout=1",
		DBPoolMax:   1,
		ListenAddr:  addr,
		StartWait:   2 * time.Second,
	}
	if err := Run(context.Background(), cfg, Options{}); err == nil {
		t.Fatal("Run with an unreachable database = nil, want an error")
	}
	if conn, err := net.Dial("tcp", addr); err == nil {
		conn.Close()
		t.Fatal("Run left a listener open on", addr)
	}
}
