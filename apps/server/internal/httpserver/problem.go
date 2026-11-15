package httpserver

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/logline"
)

const problemContentType = "application/problem+json"

// problemType is the `type` of an RFC 9457 problem and its one fixed title.
type problemType struct {
	uri   string
	title string
}

// The problems the server writes before any use case runs.
var (
	methodNotAllowed = problemType{"/problems/method-not-allowed", "Method not allowed"}
	contentTooLarge  = problemType{"/problems/content-too-large", "Content too large"}
)

func problemTypeOf(kind errs.Kind) problemType {
	switch kind {
	case errs.Invalid:
		return problemType{"/problems/invalid", "Invalid request"}
	case errs.Unauthenticated:
		return problemType{"/problems/unauthenticated", "Unauthenticated"}
	case errs.Forbidden:
		return problemType{"/problems/forbidden", "Forbidden"}
	case errs.NotFound:
		return problemType{"/problems/not-found", "Not found"}
	case errs.Conflict:
		return problemType{"/problems/conflict", "Conflict"}
	case errs.RateLimited:
		return problemType{"/problems/rate-limited", "Rate limited"}
	case errs.Cancelled:
		return problemType{"/problems/cancelled", "Request cancelled"}
	case errs.Unavailable:
		return problemType{"/problems/unavailable", "Service unavailable"}
	case errs.Internal:
		return problemType{"/problems/internal", "Internal error"}
	}
	return problemType{"/problems/internal", "Internal error"}
}

type problemError struct {
	Detail string `json:"detail"`
}

type problemBody struct {
	Type    string         `json:"type"`
	Title   string         `json:"title"`
	Status  int            `json:"status"`
	Detail  string         `json:"detail,omitempty"`
	TraceID string         `json:"trace_id"`
	Errors  []problemError `json:"errors,omitempty"`
}

func writeProblem(c *gin.Context, status int, typ problemType, detail string, failures []string) {
	body := problemBody{Type: typ.uri, Title: typ.title, Status: status, Detail: detail, TraceID: logline.TraceID(c.Request.Context())}
	for _, f := range failures {
		body.Errors = append(body.Errors, problemError{Detail: f})
	}
	c.Abort()
	c.Header("Content-Type", problemContentType)
	c.Status(status)
	// A write fails when the caller is gone, which its request line shows as cancelled.
	_ = json.NewEncoder(c.Writer).Encode(body)
}

// Problem ends the request with the problem of err's kind and records err on the request's
// line. Every error of a /v2 request goes through it. The caller reads the message of a kinded
// error it can act on, and nothing of an error the service caused.
func Problem(c *gin.Context, err error) {
	problem(c, err, nil)
}

// InvalidProblem ends the request as Invalid: err says how the request differs from the
// contract, and its first line is the one entry of the problem's errors.
func InvalidProblem(c *gin.Context, err error) {
	failure, _, _ := strings.Cut(err.Error(), "\n")
	problem(c, errs.Wrap(errs.Invalid, "read request", "the request does not match the contract", err), []string{failure})
}

func problem(c *gin.Context, err error, failures []string) {
	logline.SetError(c.Request.Context(), err)
	kind := errs.KindOf(err)
	var detail string
	if e, ok := errors.AsType[*errs.Error](err); ok && kind != errs.Internal && kind != errs.Unavailable {
		detail = e.Message
	}
	writeProblem(c, Status(err), problemTypeOf(kind), detail, failures)
}

func noRoute(c *gin.Context) {
	writeProblem(c, http.StatusNotFound, problemTypeOf(errs.NotFound), "", nil)
}

func noMethod(c *gin.Context) {
	writeProblem(c, http.StatusMethodNotAllowed, methodNotAllowed, "", nil)
}

// BodyLimit reads the request body whole, so every later reader gets it from memory. limits
// holds the most bytes a route takes, keyed by method, a space, and the route as gin names it.
// A route without an entry takes no body. A longer body ends the request with the 413 problem.
func BodyLimit(limits map[string]int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, limits[c.Request.Method+" "+c.FullPath()]))
		if _, tooLarge := errors.AsType[*http.MaxBytesError](err); tooLarge {
			writeProblem(c, http.StatusRequestEntityTooLarge, contentTooLarge, "", nil)
			return
		}
		if err != nil {
			InvalidProblem(c, err)
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(body))
	}
}

// cors lets a browser extension call the API from its own origin. A request carries a bearer
// token and never a cookie, so an origin that holds no token gains nothing by asking.
func cors(c *gin.Context) {
	h := c.Writer.Header()
	h.Set("Access-Control-Allow-Origin", "*")
	if c.Request.Method == http.MethodOptions {
		h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE")
		h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		h.Set("Access-Control-Max-Age", "86400")
		c.AbortWithStatus(http.StatusNoContent)
	}
}
