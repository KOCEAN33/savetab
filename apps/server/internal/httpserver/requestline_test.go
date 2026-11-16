package httpserver_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/KOCEAN33/savetab/apps/server/internal/httpserver"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/logline"
)

var traceIDPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

// logged returns the whole engine with register's routes, and the buffer its lines go to.
func logged(register func(gin.IRouter)) (http.Handler, *bytes.Buffer) {
	var out bytes.Buffer
	logger := logline.NewLogger(&out, logline.FormatJSON, slog.LevelInfo, logline.Process{
		Service: "savetab-server", Version: "1.2.3", Commit: "abc123", Instance: "pod-1",
	})
	return httpserver.New(serverConfig, logger, pinger{}, register).Handler, &out
}

// lines parses out as one JSON object per line.
func lines(t *testing.T, out *bytes.Buffer) []map[string]any {
	t.Helper()
	var parsed []map[string]any
	for _, raw := range strings.Split(strings.TrimSuffix(out.String(), "\n"), "\n") {
		if raw == "" {
			continue
		}
		var line map[string]any
		if err := json.Unmarshal([]byte(raw), &line); err != nil {
			t.Fatalf("line %q is not one JSON object: %v", raw, err)
		}
		parsed = append(parsed, line)
	}
	return parsed
}

// oneLine serves r and returns the answer and the single line the request wrote.
func oneLine(t *testing.T, engine http.Handler, out *bytes.Buffer, r *http.Request) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, r)
	got := lines(t, out)
	if len(got) != 1 {
		t.Fatalf("the request wrote %d lines, want exactly 1: %s", len(got), out)
	}
	return w, got[0]
}

func TestRequestLineCarriesTheRequestFields(t *testing.T) {
	t.Parallel()
	engine, out := logged(func(r gin.IRouter) {
		r.GET("/users/:id", func(c *gin.Context) {
			logline.SetUser(c.Request.Context(), "user-7")
			c.Status(http.StatusCreated)
		})
	})
	_, line := oneLine(t, engine, out, httptest.NewRequest(http.MethodGet, "/users/42", nil))
	for key, want := range map[string]any{
		"event": "http.request", "level": "INFO",
		"service": "savetab-server", "version": "1.2.3", "commit": "abc123", "instance": "pod-1",
		"http.request.method": "GET", "http.route": "/users/:id", "http.response.status_code": float64(201),
		"outcome": "success", "user.id": "user-7",
	} {
		if line[key] != want {
			t.Errorf("%s = %v, want %v", key, line[key], want)
		}
	}
	if _, ok := line["duration_ms"].(float64); !ok {
		t.Errorf("duration_ms = %v, want a number", line["duration_ms"])
	}
	for _, key := range []string{"time", "request_id", "trace_id"} {
		if s, _ := line[key].(string); s == "" {
			t.Errorf("%s is missing", key)
		}
	}
	if strings.Contains(out.String(), "/users/42") {
		t.Errorf("the line holds the raw path: %s", out)
	}
	for _, key := range []string{"error.type", "db.query_count"} {
		if _, ok := line[key]; ok {
			t.Errorf("%s = %v on a request with no error and no query", key, line[key])
		}
	}
}

func TestRequestLineOfAHandlerThatFails(t *testing.T) {
	t.Parallel()
	engine, out := logged(func(r gin.IRouter) {
		r.GET("/down", func(c *gin.Context) {
			logline.SetError(c.Request.Context(), errs.Wrap(errs.Unavailable, "list devices", "", errors.New("connection refused")))
			c.Status(http.StatusServiceUnavailable)
		})
	})
	_, line := oneLine(t, engine, out, httptest.NewRequest(http.MethodGet, "/down", nil))
	if line["outcome"] != "error" || line["error.type"] != "unavailable" || line["level"] != "ERROR" {
		t.Errorf("outcome %v, error.type %v, level %v, want error, unavailable, ERROR", line["outcome"], line["error.type"], line["level"])
	}
	if msg, _ := line["error.message"].(string); !strings.Contains(msg, "connection refused") {
		t.Errorf("error.message = %q, want it to hold the cause", msg)
	}
}

func TestRequestLineOfAHandlerThatPanics(t *testing.T) {
	t.Parallel()
	engine, out := logged(func(r gin.IRouter) {
		r.GET("/boom", func(*gin.Context) { panic("boom at the handler") })
	})
	w, line := oneLine(t, engine, out, httptest.NewRequest(http.MethodGet, "/boom", nil))
	if w.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", w.Code)
	}
	if line["outcome"] != "error" || line["error.type"] != "panic" || line["level"] != "ERROR" {
		t.Errorf("outcome %v, error.type %v, level %v, want error, panic, ERROR", line["outcome"], line["error.type"], line["level"])
	}
	if line["error.message"] != "boom at the handler" {
		t.Errorf("error.message = %v, want the panic value", line["error.message"])
	}
	if stack, _ := line["error.stack"].(string); !strings.Contains(stack, "TestRequestLineOfAHandlerThatPanics") {
		t.Errorf("error.stack = %q, want the stack of the panicking handler", stack)
	}
	if line["http.response.status_code"] != float64(500) {
		t.Errorf("http.response.status_code = %v, want 500", line["http.response.status_code"])
	}
}

type brokenHandler struct{ slog.Handler }

func (brokenHandler) Enabled(context.Context, slog.Level) bool  { return true }
func (brokenHandler) Handle(context.Context, slog.Record) error { panic("the log sink is gone") }

func TestAFailingLineLeavesTheAnswer(t *testing.T) {
	t.Parallel()
	engine := httpserver.New(serverConfig, slog.New(brokenHandler{slog.DiscardHandler}), pinger{}, func(r gin.IRouter) {
		r.GET("/ok", func(c *gin.Context) { c.String(http.StatusOK, "fine") })
	}).Handler
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/ok", nil))
	if w.Code != http.StatusOK || w.Body.String() != "fine" {
		t.Errorf("answer = %d %q, want 200 \"fine\"", w.Code, w.Body.String())
	}
}

func TestRequestLineLevelAndOutcome(t *testing.T) {
	t.Parallel()
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	cases := []struct {
		name    string
		ctx     context.Context
		handler gin.HandlerFunc
		level   string
		outcome string
	}{
		{"a 500", context.Background(), func(c *gin.Context) { c.Status(http.StatusInternalServerError) }, "ERROR", "error"},
		{"a 404", context.Background(), func(c *gin.Context) { c.Status(http.StatusNotFound) }, "INFO", "client_error"},
		// The handler of a caller that left often ends in a 5xx, which is not the service's failure.
		{"a caller that cancels", cancelled, func(c *gin.Context) { c.Status(http.StatusServiceUnavailable) }, "INFO", "cancelled"},
		{"a failure the handler recovered from", context.Background(), func(c *gin.Context) {
			logline.SetError(c.Request.Context(), errors.New("the issuer refused the code"))
			c.Redirect(http.StatusFound, "/elsewhere")
		}, "INFO", "success"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			engine, out := logged(func(r gin.IRouter) {
				r.GET("/x", tc.handler)
			})
			_, line := oneLine(t, engine, out, httptest.NewRequest(http.MethodGet, "/x", nil).WithContext(tc.ctx))
			if line["level"] != tc.level || line["outcome"] != tc.outcome {
				t.Errorf("level %v, outcome %v, want %s, %s", line["level"], line["outcome"], tc.level, tc.outcome)
			}
		})
	}
	t.Run("a recovered failure keeps its error fields", func(t *testing.T) {
		t.Parallel()
		engine, out := logged(func(r gin.IRouter) {
			r.GET("/x", cases[3].handler)
		})
		_, line := oneLine(t, engine, out, httptest.NewRequest(http.MethodGet, "/x", nil))
		if line["error.type"] != "internal" || line["error.message"] != "the issuer refused the code" {
			t.Errorf("error.type %v, error.message %v, want internal and the error's text", line["error.type"], line["error.message"])
		}
	})
}

func TestTraceIDComesFromTraceparentAndGoesOnOutboundCalls(t *testing.T) {
	t.Parallel()
	const sent = "4bf92f3577b34da6a3ce929d0e0e4736"
	cases := []struct {
		name, traceparent string
		// want is the trace id the line must carry, or empty for a new one.
		want string
	}{
		{"a valid traceparent", "00-" + sent + "-00f067aa0ba902b7-01", sent},
		{"a malformed traceparent", "not-a-traceparent", ""},
		{"an all-zero trace id", "00-00000000000000000000000000000000-00f067aa0ba902b7-01", ""},
		{"no traceparent", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var received string
			callee := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { received = r.Header.Get("traceparent") }))
			defer callee.Close()
			client := &http.Client{Transport: logline.Transport(http.DefaultTransport, "oidc")}

			engine, out := logged(func(r gin.IRouter) {
				r.GET("/x", func(c *gin.Context) {
					req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, callee.URL, nil)
					if err != nil {
						t.Error(err)
						return
					}
					resp, err := client.Do(req)
					if err != nil {
						t.Error(err)
						return
					}
					resp.Body.Close()
				})
			})
			r := httptest.NewRequest(http.MethodGet, "/x", nil)
			if tc.traceparent != "" {
				r.Header.Set("traceparent", tc.traceparent)
			}
			_, line := oneLine(t, engine, out, r)
			traceID, _ := line["trace_id"].(string)
			if tc.want != "" && traceID != tc.want {
				t.Errorf("trace_id = %q, want %q", traceID, tc.want)
			}
			if tc.want == "" && (!traceIDPattern.MatchString(traceID) || traceID == sent || strings.Trim(traceID, "0") == "") {
				t.Errorf("trace_id = %q, want a new 32-hex id", traceID)
			}
			if !regexp.MustCompile("^00-" + regexp.QuoteMeta(traceID) + "-[0-9a-f]{16}-01$").MatchString(received) {
				t.Errorf("the outbound call carried traceparent %q, want trace id %q in it", received, traceID)
			}
			if line["oidc.calls"] != float64(1) {
				t.Errorf("oidc.calls = %v, want 1", line["oidc.calls"])
			}
			if _, ok := line["oidc.duration_ms"].(float64); !ok {
				t.Errorf("oidc.duration_ms = %v, want a number", line["oidc.duration_ms"])
			}
		})
	}
}

func TestRequestLineHoldsNoCredentialAndNoBody(t *testing.T) {
	t.Parallel()
	engine, out := logged(func(r gin.IRouter) {
		r.POST("/v2/ops", func(c *gin.Context) { c.Status(http.StatusOK) })
	})
	r := httptest.NewRequest(http.MethodPost, "/v2/ops?code=qu3ry-c0de", strings.NewReader(`{"data":"b0dy-payload"}`))
	r.Header.Set("Authorization", "Bearer t0ken-value")
	r.Header.Set("Cookie", "session=c00kie-value")
	oneLine(t, engine, out, r)
	for _, secret := range []string{"t0ken-value", "c00kie-value", "b0dy-payload", "qu3ry-c0de"} {
		if strings.Contains(out.String(), secret) {
			t.Errorf("the line holds %q: %s", secret, out)
		}
	}
}

func TestAnUnmatchedRouteLogsNoPath(t *testing.T) {
	t.Parallel()
	engine, out := logged(func(gin.IRouter) {})
	_, line := oneLine(t, engine, out, httptest.NewRequest(http.MethodGet, "/no/such/place", nil))
	if line["http.route"] != "" || line["outcome"] != "client_error" {
		t.Errorf("http.route %q, outcome %v, want an empty route and client_error", line["http.route"], line["outcome"])
	}
}
