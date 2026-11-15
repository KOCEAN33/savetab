// Package logline holds the log schema: every key, the field set a unit of work collects on
// its context, and the builders of the attributes. A log key is written in no other package.
package logline

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
)

// The event names, one per kind of line.
const (
	EventRequest = "http.request"
	EventStart   = "server.start"
	EventStop    = "server.stop"
)

const (
	keyEvent        = "event"
	keyService      = "service"
	keyVersion      = "version"
	keyCommit       = "commit"
	keyInstance     = "instance"
	keyTraceID      = "trace_id"
	keyRequestID    = "request_id"
	keyMethod       = "http.request.method"
	keyRoute        = "http.route"
	keyStatus       = "http.response.status_code"
	keyDurationMS   = "duration_ms"
	keyOutcome      = "outcome"
	keyUserID       = "user.id"
	keyErrorType    = "error.type"
	keyErrorMessage = "error.message"
	keyErrorStack   = "error.stack"
	keyDBQueryCount = "db.query_count"
	keyDBDurationMS = "db.duration_ms"
	keyReason       = "reason"
	keyConfig       = "config"
	// A dependency's counters are its name with these suffixes, such as oidc.calls.
	suffixCalls      = ".calls"
	suffixDurationMS = ".duration_ms"
)

const (
	OutcomeSuccess     = "success"
	OutcomeClientError = "client_error"
	OutcomeError       = "error"
	OutcomeCancelled   = "cancelled"
)

const (
	ReasonSignal  = "signal"
	ReasonContext = "context_cancelled"
	ReasonError   = "error"
)

// maxMessageBytes cuts an error message, which can quote what a caller sent.
const maxMessageBytes = 512

const errorTypePanic = "panic"

// Fields is what one unit of work has collected for its line. The code under the unit adds to
// it through the context.
type Fields struct {
	traceID   string
	requestID string

	mu         sync.Mutex
	route      string
	userID     string
	errType    string
	errMessage string
	queries    int64
	dbTime     time.Duration
	calls      []dependency
}

type dependency struct {
	name  string
	calls int64
	time  time.Duration
}

type fieldsKey struct{}

var traceparentPattern = regexp.MustCompile(`^[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$`)

// NewContext starts a unit of work: it returns ctx carrying a new field set. The unit joins
// the trace that traceparent names, or starts one when the header is missing or invalid.
func NewContext(ctx context.Context, traceparent string) (context.Context, *Fields) {
	f := &Fields{traceID: parseTraceID(traceparent), requestID: randomHex(8)}
	if f.traceID == "" {
		f.traceID = NewTraceID()
	}
	return context.WithValue(ctx, fieldsKey{}, f), f
}

func parseTraceID(traceparent string) string {
	m := traceparentPattern.FindStringSubmatch(traceparent)
	// W3C Trace Context: version ff and an all-zero trace or parent id are invalid.
	if m == nil || strings.HasPrefix(traceparent, "ff") || strings.Trim(m[1], "0") == "" || strings.Trim(m[2], "0") == "" {
		return ""
	}
	return m[1]
}

// NewTraceID returns a trace id in the W3C form: 16 random bytes as hex.
func NewTraceID() string { return randomHex(16) }

func randomHex(n int) string {
	b := make([]byte, n)
	// crypto/rand.Read never fails.
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func from(ctx context.Context) *Fields {
	f, _ := ctx.Value(fieldsKey{}).(*Fields)
	return f
}

// TraceID returns the trace id of the unit in ctx, empty outside a unit.
func TraceID(ctx context.Context) string {
	if f := from(ctx); f != nil {
		return f.traceID
	}
	return ""
}

// SetRoute records the matched route template of the unit in ctx.
func SetRoute(ctx context.Context, route string) {
	if f := from(ctx); f != nil {
		f.mu.Lock()
		f.route = route
		f.mu.Unlock()
	}
}

// SetUser records the authenticated caller of the unit in ctx.
func SetUser(ctx context.Context, id string) {
	if f := from(ctx); f != nil {
		f.mu.Lock()
		f.userID = id
		f.mu.Unlock()
	}
}

// SetError records err on the line of the unit in ctx. It is how an error is logged: the code
// that meets one records it here and writes no line.
func SetError(ctx context.Context, err error) {
	if f := from(ctx); f != nil {
		f.setError(kindNameOf(err), err.Error())
	}
}

// SetPanic records the value of a recovered panic on f.
func (f *Fields) SetPanic(v any) {
	f.setError(errorTypePanic, fmt.Sprint(v))
}

func (f *Fields) setError(typ, message string) {
	if len(message) > maxMessageBytes {
		message = strings.ToValidUTF8(message[:maxMessageBytes], "")
	}
	f.mu.Lock()
	f.errType, f.errMessage = typ, message
	f.mu.Unlock()
}

// AddQueries adds n database queries that took d in all to the unit in ctx.
func AddQueries(ctx context.Context, n int64, d time.Duration) {
	if f := from(ctx); f != nil {
		f.mu.Lock()
		f.queries += n
		f.dbTime += d
		f.mu.Unlock()
	}
}

func (f *Fields) addCall(name string, d time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := range f.calls {
		if f.calls[i].name == name {
			f.calls[i].calls++
			f.calls[i].time += d
			return
		}
	}
	f.calls = append(f.calls, dependency{name: name, calls: 1, time: d})
}

// Request holds what the middleware knows about a request when it ends.
type Request struct {
	Method string
	// Route is the template the router matched. A route the unit recorded with SetRoute wins.
	Route    string
	Status   int
	Duration time.Duration
	Outcome  string
	// Stack is the stack of a recovered panic.
	Stack []byte
}

// RequestAttrs returns the attributes of a request's line.
func (f *Fields) RequestAttrs(r Request) []slog.Attr {
	f.mu.Lock()
	defer f.mu.Unlock()
	route := r.Route
	if f.route != "" {
		route = f.route
	}
	attrs := []slog.Attr{
		slog.String(keyTraceID, f.traceID),
		slog.String(keyRequestID, f.requestID),
		slog.String(keyMethod, r.Method),
		slog.String(keyRoute, route),
		slog.Int(keyStatus, r.Status),
		durationMS(keyDurationMS, r.Duration),
		slog.String(keyOutcome, r.Outcome),
	}
	if f.userID != "" {
		attrs = append(attrs, slog.String(keyUserID, f.userID))
	}
	if f.errType != "" {
		attrs = append(attrs, slog.String(keyErrorType, f.errType), slog.String(keyErrorMessage, f.errMessage))
	}
	if r.Stack != nil {
		attrs = append(attrs, slog.String(keyErrorStack, string(r.Stack)))
	}
	if f.queries > 0 {
		attrs = append(attrs, slog.Int64(keyDBQueryCount, f.queries), durationMS(keyDBDurationMS, f.dbTime))
	}
	for _, d := range f.calls {
		attrs = append(attrs, slog.Int64(d.name+suffixCalls, d.calls), durationMS(d.name+suffixDurationMS, d.time))
	}
	return attrs
}

// slog.Duration would write nanoseconds in JSON.
func durationMS(key string, d time.Duration) slog.Attr {
	return slog.Int64(key, d.Milliseconds())
}

func kindNameOf(err error) string {
	switch errs.KindOf(err) {
	case errs.Internal:
		return "internal"
	case errs.Invalid:
		return "invalid"
	case errs.Unauthenticated:
		return "unauthenticated"
	case errs.Forbidden:
		return "forbidden"
	case errs.NotFound:
		return "not_found"
	case errs.Conflict:
		return "conflict"
	case errs.RateLimited:
		return "rate_limited"
	case errs.Cancelled:
		return "cancelled"
	case errs.Unavailable:
		return "unavailable"
	}
	return "internal"
}
