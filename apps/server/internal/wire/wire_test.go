package wire

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/KOCEAN33/savetab/apps/server/internal/httpserver"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/config"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/fakeoidc"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/testdb"
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
	srv := httpserver.New(httpserver.Config{RequestDeadline: 10 * time.Second, ReadyPingTimeout: time.Second}, slog.New(slog.DiscardHandler), pingOK{}, v1, func(gin.IRouter) {})
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
	if err := Run(context.Background(), cfg, Options{Log: io.Discard}); err == nil {
		t.Fatal("Run with an unreachable database = nil, want an error")
	}
	if conn, err := net.Dial("tcp", addr); err == nil {
		conn.Close()
		t.Fatal("Run left a listener open on", addr)
	}
}

type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// processLines returns the lines of out that are not request lines.
func processLines(t *testing.T, out string) []map[string]any {
	t.Helper()
	var parsed []map[string]any
	for _, raw := range strings.Split(strings.TrimSuffix(out, "\n"), "\n") {
		var line map[string]any
		if err := json.Unmarshal([]byte(raw), &line); err != nil {
			t.Fatalf("line %q is not one JSON object: %v", raw, err)
		}
		if line["event"] != "http.request" {
			parsed = append(parsed, line)
		}
	}
	return parsed
}

func TestRunWritesAStartLineAndAStopLine(t *testing.T) {
	dbURL, drop, err := testdb.Start()
	if err != nil {
		t.Fatal(err)
	}
	defer drop()
	issuer := fakeoidc.New("savetab")
	defer issuer.Close()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	cfg := config.Config{
		DatabaseURL: config.Secret(dbURL), DBPoolMax: 2, DBStatementTimeout: 3 * time.Second, DBIdleInTxTimeout: 4 * time.Second, ListenAddr: addr, PublicURL: "http://" + addr,
		OIDCIssuer: issuer.URL, OIDCClientID: "savetab", AuthRedirectURIs: []string{"https://a.example/"},
		StartWait: 10 * time.Second, RequestDeadline: 5 * time.Second, ReadyPingTimeout: time.Second,
		HTTPDrainTimeout: 6 * time.Second, ShutdownBudget: 7 * time.Second, LogFormat: "json",
	}
	var out lockedBuffer
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- Run(ctx, cfg, Options{Listener: l, Log: &out, Version: "1.2.3", Commit: "abc123"}) }()
	deadline := time.Now().Add(10 * time.Second)
	for {
		if resp, err := http.Get("http://" + addr + "/readyz"); err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatal("the server was not ready within 10s")
		}
		time.Sleep(20 * time.Millisecond)
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("Run = %v, want nil", err)
	}

	got := processLines(t, out.String())
	if len(got) != 2 {
		t.Fatalf("Run wrote %d process lines, want a start line and a stop line: %s", len(got), out.String())
	}
	start, stop := got[0], got[1]
	if start["event"] != "server.start" || stop["event"] != "server.stop" {
		t.Fatalf("events %v then %v, want server.start then server.stop", start["event"], stop["event"])
	}
	for _, line := range got {
		for key, want := range map[string]any{"service": "savetab-server", "version": "1.2.3", "commit": "abc123", "level": "INFO"} {
			if line[key] != want {
				t.Errorf("%v: %s = %v, want %v", line["event"], key, line[key], want)
			}
		}
	}
	if id, _ := start["trace_id"].(string); id == "" || stop["trace_id"] != id {
		t.Errorf("trace_id %v on the start line and %v on the stop line, want one id on both", start["trace_id"], stop["trace_id"])
	}
	shown, _ := start["config"].(map[string]any)
	for key, want := range map[string]any{
		"listen_addr": addr, "oidc_issuer": issuer.URL, "oidc_client_id": "savetab", "db_pool_max": float64(2),
		"db_statement_timeout_ms": float64(3000), "db_idle_in_tx_timeout_ms": float64(4000),
		"request_deadline_ms": float64(5000), "http_drain_timeout_ms": float64(6000), "log_format": "json", "log_level": "INFO",
	} {
		if shown[key] != want {
			t.Errorf("config.%s = %v, want %v", key, shown[key], want)
		}
	}
	if stop["reason"] != "context_cancelled" {
		t.Errorf("reason = %v, want context_cancelled", stop["reason"])
	}
	if strings.Contains(out.String(), dbURL) || strings.Contains(out.String(), "postgres://") {
		t.Errorf("the log holds the database URL: %s", out.String())
	}
}

func TestRunThatFailsToStartWritesAStopLineWithTheError(t *testing.T) {
	cfg := config.Config{
		DatabaseURL: "postgres://savetab:hunter2@127.0.0.1:1/savetab?connect_timeout=1",
		DBPoolMax:   1,
		ListenAddr:  "127.0.0.1:0",
		StartWait:   2 * time.Second,
	}
	var out lockedBuffer
	if err := Run(context.Background(), cfg, Options{Log: &out}); err == nil {
		t.Fatal("Run with an unreachable database = nil, want an error")
	}
	got := processLines(t, out.String())
	if len(got) != 1 {
		t.Fatalf("Run wrote %d process lines, want the stop line alone: %s", len(got), out.String())
	}
	stop := got[0]
	if stop["event"] != "server.stop" || stop["level"] != "ERROR" || stop["reason"] != "error" {
		t.Errorf("event %v, level %v, reason %v, want server.stop, ERROR, error", stop["event"], stop["level"], stop["reason"])
	}
	if typ, _ := stop["error.type"].(string); typ == "" {
		t.Error("error.type is missing")
	}
	if msg, _ := stop["error.message"].(string); msg == "" {
		t.Error("error.message is missing")
	}
	if strings.Contains(out.String(), "hunter2") {
		t.Errorf("the log holds the database password: %s", out.String())
	}
}
