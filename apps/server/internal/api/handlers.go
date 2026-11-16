// Package api is the server's HTTP surface: /v2 as api/openapi.yaml declares it.
package api

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"regexp"
	"strings"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/KOCEAN33/savetab/apps/server/internal/bus"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/logline"
)

// maxMessageBytes bounds a wrapped key and a pairing message, which the contract's schema bounds
// only as base64 text.
const maxMessageBytes = 1024

// The extensions of api/openapi.yaml this package reads.
const (
	extBodyLimit   = "x-body-limit-bytes"
	extPageSizeMax = "x-page-size-maximum"
)

// Handlers serves the /v2 operations of api/openapi.yaml. A request reaches one only after the
// validator has held it to that contract, and an error one returns becomes the problem of its
// kind.
type Handlers struct {
	bus   *bus.Bus
	login *Login
	// The page sizes of the three lists, as spec states them.
	opsPage, devicesPage, pairingsPage pageSize
}

var _ StrictServerInterface = (*Handlers)(nil)

// NewHandlers reads each list's page sizes from spec.
func NewHandlers(b *bus.Bus, login *Login, spec *openapi3.T) *Handlers {
	return &Handlers{
		bus: b, login: login,
		opsPage: pageSizeOf(spec, "/v2/ops"), devicesPage: pageSizeOf(spec, "/v2/devices"), pairingsPage: pageSizeOf(spec, "/v2/pairings"),
	}
}

// pageSizeOf reads the default and the maximum of the page_size of GET path. It panics when
// spec declares none, since the handler of that list would then serve empty pages.
func pageSizeOf(spec *openapi3.T, path string) pageSize {
	schema := spec.Paths.Find(path).Get.Parameters.GetByInAndName(openapi3.ParameterInQuery, "page_size").Schema.Value
	return pageSize{initial: int(schema.Default.(float64)), max: int(schema.Extensions[extPageSizeMax].(float64))}
}

var pathParam = regexp.MustCompile(`\{([^}]+)\}`)

// BodyLimits returns the most bytes each operation of spec takes as its body, keyed by method,
// a space, and the route as gin names it.
func BodyLimits(spec *openapi3.T) map[string]int64 {
	limits := map[string]int64{}
	for path, item := range spec.Paths.Map() {
		for method, op := range item.Operations() {
			if limit, ok := op.Extensions[extBodyLimit].(float64); ok {
				limits[routeKey(method, path)] = int64(limit)
			}
		}
	}
	return limits
}

// routeKey names an operation as a request shows it: the method, a space, and the path as gin
// names its route.
func routeKey(method, specPath string) string {
	return method + " " + pathParam.ReplaceAllString(specPath, ":$1")
}

type pageSize struct {
	initial int
	max     int
}

// of is the page size a request gets: the default for none or zero, at most the maximum.
func (p pageSize) of(requested *int32) int {
	if requested == nil || *requested == 0 {
		return p.initial
	}
	return min(int(*requested), p.max)
}

// pageToken is what a page_token holds: where the page before ended, and which list of which
// caller it belongs to.
type pageToken struct {
	Time time.Time `json:"t"`
	ID   uuid.UUID `json:"i"`
	List []byte    `json:"l"`
}

// listHash binds a page token to one list of one caller, the only filters a list has.
func listHash(list string, userID uuid.UUID) []byte {
	sum := sha256.Sum256(append([]byte(list+" "), userID[:]...))
	return sum[:]
}

// cursorOf reads the position a request's page_token holds, the start of the list for none. A
// token of another list or caller is Invalid.
func cursorOf(token *string, list string, userID uuid.UUID) (bus.Cursor, error) {
	if token == nil {
		return bus.Cursor{}, nil
	}
	var t pageToken
	raw, err := base64.RawURLEncoding.DecodeString(*token)
	if err == nil {
		err = json.Unmarshal(raw, &t)
	}
	if err != nil || string(t.List) != string(listHash(list, userID)) {
		return bus.Cursor{}, errs.Wrap(errs.Invalid, "read page token", "page_token is not one this list gave this caller", err)
	}
	return bus.Cursor{Time: t.Time, ID: t.ID}, nil
}

// nextToken is the next_page_token of a page that ended at next, nil for the last page.
func nextToken(next *bus.Cursor, list string, userID uuid.UUID) *string {
	if next == nil {
		return nil
	}
	// A struct of a time, a UUID, and bytes always marshals.
	raw, _ := json.Marshal(pageToken{Time: next.Time, ID: next.ID, List: listHash(list, userID)})
	token := base64.RawURLEncoding.EncodeToString(raw)
	return &token
}

type callerKey struct{}

// Authenticate resolves the bearer token of a request to an operation that takes one by spec,
// and ends such a request without a working token through fail.
func Authenticate(b *bus.Bus, spec *openapi3.T, fail func(*gin.Context, error)) MiddlewareFunc {
	open := map[string]bool{}
	for path, item := range spec.Paths.Map() {
		for method, op := range item.Operations() {
			// An operation without a security of its own takes the document's, the bearer token.
			open[routeKey(method, path)] = op.Security != nil && len(*op.Security) == 0
		}
	}
	return func(c *gin.Context) {
		if open[c.Request.Method+" "+c.FullPath()] {
			return
		}
		token, ok := strings.CutPrefix(c.GetHeader("Authorization"), "Bearer ")
		if !ok || token == "" {
			fail(c, errs.New(errs.Unauthenticated, "authenticate", "the request carries no bearer token"))
			return
		}
		caller, err := b.Authenticate(c.Request.Context(), token)
		if err != nil {
			fail(c, err)
			return
		}
		logline.SetUser(c.Request.Context(), caller.UserID.String())
		c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), callerKey{}, caller))
	}
}

// callerOf returns the caller Authenticate resolved. Every operation that calls it takes a
// bearer token, so a request without one never reaches it.
func callerOf(ctx context.Context) bus.Caller {
	return ctx.Value(callerKey{}).(bus.Caller)
}
