package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/platform/logline"
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

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// requestLine sends one request through the whole server, and returns the line the request wrote.
func requestLine(t *testing.T, s *server, method, path, token string) map[string]any {
	t.Helper()
	req, err := http.NewRequest(method, s.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	// The server shares its log among the requests of the test, and the trace id names this one's line.
	traceID := logline.NewTraceID()
	req.Header.Set("traceparent", "00-"+traceID+"-0000000000000001-01")
	send(t, s, req)
	// The line is written after the answer, so the client can be ahead of it.
	deadline := time.Now().Add(2 * time.Second)
	for {
		for raw := range strings.SplitSeq(s.log.String(), "\n") {
			if !strings.Contains(raw, traceID) {
				continue
			}
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

// wantQueryCount holds a list request to its exact SQL statement count over the fixture.
func wantQueryCount(t *testing.T, s *server, path, token string, want int) {
	t.Helper()
	line := requestLine(t, s, http.MethodGet, path, token)
	if line["http.response.status_code"] != float64(http.StatusOK) || line["db.query_count"] != float64(want) {
		t.Errorf("GET %s: status %v with db.query_count %v, want 200 with %d", path, line["http.response.status_code"], line["db.query_count"], want)
	}
}

func TestRequestLineCountsTheQueriesOfARequest(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	m := newMember(t, s)
	// One query finds the token's session and one lists the devices.
	line := requestLine(t, s, http.MethodGet, "/v2/devices", m.access)
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
	t.Parallel()
	s := newServer(t)
	m := newMember(t, s)
	line := requestLine(t, s, http.MethodDelete, "/v2/devices/00000000-0000-4000-8000-000000000000", m.access)
	if line["http.route"] != "/v2/devices/:device_id" {
		t.Errorf("http.route = %v, want /v2/devices/:device_id", line["http.route"])
	}
	if line["http.response.status_code"] != float64(404) || line["outcome"] != "client_error" {
		t.Errorf("status %v, outcome %v, want 404 and client_error", line["http.response.status_code"], line["outcome"])
	}
}

func TestRequestLineOfARequestWithoutATokenNamesNoUser(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	line := requestLine(t, s, http.MethodGet, "/v2/devices", "")
	if _, ok := line["user.id"]; ok {
		t.Errorf("user.id = %v on a request with no token", line["user.id"])
	}
	if _, ok := line["db.query_count"]; ok {
		t.Errorf("db.query_count = %v on a request that reached no query", line["db.query_count"])
	}
}
