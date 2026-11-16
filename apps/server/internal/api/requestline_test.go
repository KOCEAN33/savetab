package api_test

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/bus"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/logline"
	"github.com/KOCEAN33/savetab/apps/server/internal/wire"
)

type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

// requestLine sends one request through the whole server, and returns the line the request wrote.
func requestLine(t *testing.T, method, path, token string) map[string]any {
	t.Helper()
	var out lockedBuffer
	logger := logline.NewLogger(&out, logline.FormatJSON, slog.LevelInfo, logline.Process{})
	logged, err := wire.NewServer(serverConfig, logger, bus.New(store), login)
	if err != nil {
		t.Fatal(err)
	}
	whole := httptest.NewServer(logged.Handler)
	defer whole.Close()
	req, err := http.NewRequest(method, whole.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	// The line is written after the answer, so the client can be ahead of it.
	deadline := time.Now().Add(2 * time.Second)
	for {
		out.mu.Lock()
		raw := out.buf.String()
		out.mu.Unlock()
		if raw != "" {
			var line map[string]any
			if err := json.Unmarshal([]byte(raw), &line); err != nil {
				t.Fatalf("the request wrote %q, want one JSON object: %v", raw, err)
			}
			return line
		}
		if time.Now().After(deadline) {
			t.Fatal("the request wrote no line within 2s")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestRequestLineCountsTheQueriesOfARequest(t *testing.T) {
	m := newMember(t)
	// One query finds the token's session and one lists the devices.
	line := requestLine(t, http.MethodGet, "/v2/devices", m.access)
	if line["db.query_count"] != float64(2) {
		t.Errorf("db.query_count = %v, want 2", line["db.query_count"])
	}
	if _, ok := line["db.duration_ms"].(float64); !ok {
		t.Errorf("db.duration_ms = %v, want a number", line["db.duration_ms"])
	}
	if line["user.id"] != m.user {
		t.Errorf("user.id = %v, want %s", line["user.id"], m.user)
	}
	if line["http.route"] != "/v2/devices" {
		t.Errorf("http.route = %v, want /v2/devices", line["http.route"])
	}
}

func TestRequestLineNamesTheRouteTemplateOfARequest(t *testing.T) {
	m := newMember(t)
	line := requestLine(t, http.MethodDelete, "/v2/devices/00000000-0000-4000-8000-000000000000", m.access)
	if line["http.route"] != "/v2/devices/:device_id" {
		t.Errorf("http.route = %v, want /v2/devices/:device_id", line["http.route"])
	}
	if line["http.response.status_code"] != float64(404) || line["outcome"] != "client_error" {
		t.Errorf("status %v, outcome %v, want 404 and client_error", line["http.response.status_code"], line["outcome"])
	}
}

func TestRequestLineOfARequestWithoutATokenNamesNoUser(t *testing.T) {
	line := requestLine(t, http.MethodGet, "/v2/devices", "")
	if _, ok := line["user.id"]; ok {
		t.Errorf("user.id = %v on a request with no token", line["user.id"])
	}
	if _, ok := line["db.query_count"]; ok {
		t.Errorf("db.query_count = %v on a request that reached no query", line["db.query_count"])
	}
}
