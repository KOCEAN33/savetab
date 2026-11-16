package httpserver_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/KOCEAN33/savetab/apps/server/internal/httpserver"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
)

type problemAnswer struct {
	Type    string `json:"type"`
	Title   string `json:"title"`
	Status  int    `json:"status"`
	Detail  string `json:"detail"`
	TraceID string `json:"trace_id"`
	Errors  []struct {
		Detail string `json:"detail"`
	} `json:"errors"`
}

// problemServer serves register's routes behind the whole engine.
func problemServer(deadline time.Duration, register func(gin.IRouter)) http.Handler {
	return httpserver.New(httpserver.Config{RequestDeadline: deadline, ReadyPingTimeout: time.Second}, slog.New(slog.DiscardHandler), pinger{}, register).Handler
}

func readProblem(t *testing.T, what string, w *httptest.ResponseRecorder, status int, typ string) problemAnswer {
	t.Helper()
	var p problemAnswer
	if got := w.Header().Get("Content-Type"); got != "application/problem+json" {
		t.Errorf("%s: Content-Type %q, want application/problem+json", what, got)
	}
	if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil {
		t.Fatalf("%s: body %q is not a problem: %v", what, w.Body.String(), err)
	}
	if w.Code != status || p.Status != status || p.Type != typ {
		t.Errorf("%s: status %d, body status %d, type %q, want %d and %q", what, w.Code, p.Status, p.Type, status, typ)
	}
	if len(p.TraceID) != 32 {
		t.Errorf("%s: trace_id %q, want 32 hex characters", what, p.TraceID)
	}
	if p.Title == "" {
		t.Errorf("%s: no title", what)
	}
	return p
}

func TestProblemOfEachKind(t *testing.T) {
	t.Parallel()
	cases := []struct {
		kind   errs.Kind
		status int
		typ    string
		detail string
	}{
		{errs.Invalid, 400, "/problems/invalid", "the caller may read this"},
		{errs.Unauthenticated, 401, "/problems/unauthenticated", "the caller may read this"},
		{errs.Forbidden, 403, "/problems/forbidden", "the caller may read this"},
		{errs.NotFound, 404, "/problems/not-found", "the caller may read this"},
		{errs.Conflict, 409, "/problems/conflict", "the caller may read this"},
		{errs.RateLimited, 429, "/problems/rate-limited", "the caller may read this"},
		{errs.Cancelled, 499, "/problems/cancelled", "the caller may read this"},
		// What failed inside the service is not the caller's to read.
		{errs.Unavailable, 503, "/problems/unavailable", ""},
		{errs.Internal, 500, "/problems/internal", ""},
	}
	for _, tc := range cases {
		handler := problemServer(time.Second, func(r gin.IRouter) {
			r.GET("/v2/things", func(c *gin.Context) {
				httpserver.Problem(c, errs.Wrap(tc.kind, "get thing", "the caller may read this", errors.New("the cause")))
			})
		})
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v2/things", nil))
		p := readProblem(t, tc.typ, w, tc.status, tc.typ)
		if p.Detail != tc.detail {
			t.Errorf("%s: detail %q, want %q", tc.typ, p.Detail, tc.detail)
		}
		if strings.Contains(w.Body.String(), "the cause") {
			t.Errorf("%s: the body %q holds the cause", tc.typ, w.Body.String())
		}
	}
}

func TestProblemOfAnErrorWithoutAKindIsInternal(t *testing.T) {
	t.Parallel()
	handler := problemServer(time.Second, func(r gin.IRouter) {
		r.GET("/v2/things", func(c *gin.Context) { httpserver.Problem(c, errors.New("a secret of the service")) })
	})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v2/things", nil))
	readProblem(t, "no kind", w, 500, "/problems/internal")
	if strings.Contains(w.Body.String(), "secret") {
		t.Errorf("the body %q holds the error's text", w.Body.String())
	}
}

func TestInvalidProblemListsTheFailure(t *testing.T) {
	t.Parallel()
	handler := problemServer(time.Second, func(r gin.IRouter) {
		r.GET("/v2/things", func(c *gin.Context) { httpserver.InvalidProblem(c, errors.New("page_size is below 0\nSchema: {...}")) })
	})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v2/things", nil))
	p := readProblem(t, "invalid", w, 400, "/problems/invalid")
	if len(p.Errors) != 1 || p.Errors[0].Detail != "page_size is below 0" {
		t.Errorf("errors = %+v, want the one failure's first line", p.Errors)
	}
}

func TestProblemsBeforeAnyHandler(t *testing.T) {
	t.Parallel()
	handler := problemServer(time.Second, func(r gin.IRouter) {
		r.GET("/v2/things", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	})
	cases := []struct {
		method, path string
		status       int
		typ          string
	}{
		{http.MethodGet, "/v2/nothing", 404, "/problems/not-found"},
		{http.MethodGet, "/elsewhere", 404, "/problems/not-found"},
		{http.MethodDelete, "/v2/things", 405, "/problems/method-not-allowed"},
	}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		readProblem(t, tc.method+" "+tc.path, w, tc.status, tc.typ)
	}
}

func TestPanicAnswersTheInternalProblem(t *testing.T) {
	t.Parallel()
	handler := problemServer(time.Second, func(r gin.IRouter) {
		r.GET("/v2/things", func(*gin.Context) { panic("a secret of the service") })
	})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v2/things", nil))
	readProblem(t, "panic", w, 500, "/problems/internal")
	if strings.Contains(w.Body.String(), "secret") {
		t.Errorf("the body %q holds the panic value", w.Body.String())
	}
}

func TestBodyLimit(t *testing.T) {
	t.Parallel()
	var read string
	handler := problemServer(time.Second, func(r gin.IRouter) {
		limit := httpserver.BodyLimit(map[string]int64{"PUT /v2/things/:id": 8})
		put := func(c *gin.Context) {
			body, _ := io.ReadAll(c.Request.Body)
			read = string(body)
			c.Status(http.StatusNoContent)
		}
		r.PUT("/v2/things/:id", limit, put)
		r.PUT("/v2/others", limit, put)
	})

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/v2/things/1", strings.NewReader("12345678")))
	if w.Code != http.StatusNoContent || read != "12345678" {
		t.Errorf("a body at the limit: status %d, handler read %q, want 204 and the body", w.Code, read)
	}

	read = ""
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/v2/things/1", strings.NewReader("123456789")))
	readProblem(t, "one byte over", w, 413, "/problems/content-too-large")
	if read != "" {
		t.Errorf("the handler read %q of a body over the limit", read)
	}

	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/v2/others", strings.NewReader("1")))
	readProblem(t, "a route without a limit", w, 413, "/problems/content-too-large")
}

// A generated handler gets the gin context as its context, so the deadline has to reach it there.
func TestRequestDeadlineReachesTheGinContext(t *testing.T) {
	t.Parallel()
	ended := make(chan error, 1)
	handler := problemServer(20*time.Millisecond, func(r gin.IRouter) {
		r.GET("/v2/slow", func(c *gin.Context) {
			var ctx context.Context = c
			select {
			case <-ctx.Done():
				ended <- ctx.Err()
			case <-time.After(5 * time.Second):
				ended <- nil
			}
		})
	})
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/v2/slow", nil))
	if err := <-ended; !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("the gin context ended with %v, want %v", err, context.DeadlineExceeded)
	}
}

func TestPreflightOfAV2RouteIsAnswered(t *testing.T) {
	t.Parallel()
	handler := problemServer(time.Second, func(r gin.IRouter) {
		r.POST("/v2/things", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodOptions, "/v2/things", nil))
	if w.Code != http.StatusNoContent {
		t.Fatalf("OPTIONS /v2/things = %d, want 204", w.Code)
	}
	for header, want := range map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
		"Access-Control-Allow-Headers": "Authorization, Content-Type",
	} {
		if got := w.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v2/nothing", nil))
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("a 404 answer: Access-Control-Allow-Origin = %q, want * so the extension can read the status", got)
	}
}
