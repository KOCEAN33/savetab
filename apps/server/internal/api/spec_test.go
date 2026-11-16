package api_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/gorillamux"
	"github.com/jackc/pgx/v5"

	"github.com/KOCEAN33/savetab/apps/server/internal/api"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/fakeoidc"
)

// The /v2 tests take every expected value from api/openapi.yaml, and every /v2 response they
// receive is held to it by conform.

var contract = sync.OnceValues(func() (*openapi3.T, error) {
	doc, err := api.GetSpec()
	if err != nil {
		return nil, err
	}
	doc.Servers = nil
	// The contract declares text/html for viewShare, which kin-openapi decodes only once told how.
	openapi3filter.RegisterBodyDecoder("text/html", openapi3filter.PlainBodyDecoder)
	return doc, nil
})

var contractRouter = sync.OnceValues(func() (routers.Router, error) {
	doc, err := contract()
	if err != nil {
		return nil, err
	}
	return gorillamux.NewRouter(doc)
})

// undeclaredStatuses are the problems the contract lets every operation answer without listing them.
var undeclaredStatuses = []int{404, 405, 413, 499, 500, 503}

var problemKinds = map[int]string{
	400: "invalid", 401: "unauthenticated", 403: "forbidden", 404: "not-found",
	405: "method-not-allowed", 409: "conflict", 413: "content-too-large",
}

type reply struct {
	method, target string
	status         int
	header         http.Header
	body           []byte
}

func (r reply) String() string {
	body := string(r.body)
	if len(body) > 400 {
		body = body[:400] + "..."
	}
	return fmt.Sprintf("%s %s answered %d %s", r.method, r.target, r.status, body)
}

var noRedirects = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

// send does req without following a redirect and, when it is a /v2 request, holds the answer
// to the contract.
func send(t *testing.T, req *http.Request) reply {
	t.Helper()
	res, err := noRedirects.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	r := reply{method: req.Method, target: req.URL.RequestURI(), status: res.StatusCode, header: res.Header, body: body}
	if strings.HasPrefix(req.URL.String(), srv.URL+"/v2/") {
		conform(t, req, r)
	}
	return r
}

// call sends a /v2 request. body is nil for none, []byte for a raw body, and anything else
// for its JSON.
func call(t *testing.T, method, path, token string, body any) reply {
	t.Helper()
	var raw []byte
	switch b := body.(type) {
	case nil:
	case []byte:
		raw = b
	default:
		var err error
		if raw, err = json.Marshal(b); err != nil {
			t.Fatal(err)
		}
	}
	req, err := http.NewRequest(method, srv.URL+path, bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return send(t, req)
}

func conform(t *testing.T, req *http.Request, r reply) {
	t.Helper()
	doc, err := contract()
	if err != nil {
		t.Fatal(err)
	}
	router, err := contractRouter()
	if err != nil {
		t.Fatal(err)
	}
	route, params, findErr := router.FindRoute(req)
	undeclared := slices.Contains(undeclaredStatuses, r.status)
	switch {
	case findErr == nil && (!undeclared || route.Operation.Responses.Status(r.status) != nil):
		opts := &openapi3filter.Options{IncludeResponseStatus: true, AuthenticationFunc: openapi3filter.NoopAuthenticationFunc}
		input := &openapi3filter.ResponseValidationInput{
			RequestValidationInput: &openapi3filter.RequestValidationInput{Request: req, PathParams: params, Route: route, Options: opts},
			Status:                 r.status,
			Header:                 r.header,
			Options:                opts,
		}
		input.SetBodyBytes(r.body)
		if err := openapi3filter.ValidateResponse(context.Background(), input); err != nil {
			t.Errorf("%s, which breaks the contract: %v", r, err)
		}
	case undeclared:
		if got := mediaType(r.header); got != "application/problem+json" {
			t.Errorf("%s with Content-Type %q, want application/problem+json", r, got)
		}
		var v any
		if err := json.Unmarshal(r.body, &v); err != nil {
			t.Errorf("%s, not JSON: %v", r, err)
		} else if err := doc.Components.Schemas["Problem"].Value.VisitJSON(v); err != nil {
			t.Errorf("%s, not a Problem: %v", r, err)
		}
	default:
		t.Errorf("%s, a status no operation of the contract answers here: %v", r, findErr)
	}
	if r.status/100 == 2 && mediaType(r.header) == "application/json" {
		var v any
		if err := json.Unmarshal(r.body, &v); err == nil {
			checkTimes(t, r, v)
		}
	}
}

func mediaType(h http.Header) string {
	mt, _, _ := mime.ParseMediaType(h.Get("Content-Type"))
	return mt
}

// checkTimes holds every time member (named *_at or *_time) of a body to RFC 3339 in UTC.
func checkTimes(t *testing.T, r reply, v any) {
	t.Helper()
	switch v := v.(type) {
	case []any:
		for _, item := range v {
			checkTimes(t, r, item)
		}
	case map[string]any:
		for k, item := range v {
			if strings.HasSuffix(k, "_at") || strings.HasSuffix(k, "_time") {
				s, _ := item.(string)
				if !isUTC(s) {
					t.Errorf("%s: %s = %v, want an RFC 3339 string in UTC", r, k, item)
				}
				continue
			}
			checkTimes(t, r, item)
		}
	}
}

func isUTC(s string) bool {
	parsed, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return false
	}
	_, offset := parsed.Zone()
	return offset == 0 && (strings.HasSuffix(s, "Z") || strings.HasSuffix(s, "+00:00"))
}

func wantStatus(t *testing.T, what string, r reply, status int) bool {
	t.Helper()
	if r.status != status {
		t.Errorf("%s: %s, want status %d", what, r, status)
		return false
	}
	return true
}

// must stops the test unless r has status: the steps after it would only report noise.
func must(t *testing.T, what string, r reply, status int) reply {
	t.Helper()
	if r.status != status {
		t.Fatalf("%s: %s, want status %d", what, r, status)
	}
	return r
}

// wantProblem checks r is the problem of status and returns it.
func wantProblem(t *testing.T, what string, r reply, status int) api.Problem {
	t.Helper()
	var p api.Problem
	if r.status != status {
		t.Errorf("%s: %s, want status %d", what, r, status)
		return p
	}
	if got := mediaType(r.header); got != "application/problem+json" {
		t.Errorf("%s: Content-Type %q, want application/problem+json", what, got)
	}
	if err := json.Unmarshal(r.body, &p); err != nil {
		t.Errorf("%s: %s, not a problem: %v", what, r, err)
		return p
	}
	if wantType := "/problems/" + problemKinds[status]; int(p.Status) != status || p.Type != wantType || p.TraceId == "" {
		t.Errorf("%s: problem %s, want status %d, type %s, and a trace_id", what, r.body, status, wantType)
	}
	return p
}

func readJSON[T any](t *testing.T, r reply) T {
	t.Helper()
	var out T
	if err := json.Unmarshal(r.body, &out); err != nil {
		t.Fatalf("%s: %v", r, err)
	}
	return out
}

func secret(t *testing.T) string {
	t.Helper()
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func challengeOf(verifier string) string {
	h := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

func authorizationPath(redirectURI, challenge, state string) string {
	return "/v2/authorizations?" + url.Values{"redirect_uri": {redirectURI}, "code_challenge": {challenge}, "state": {state}}.Encode()
}

// visit follows redirects from path the way the login window does, and returns the first
// answer that is not a redirect or that redirects to the extension.
func visit(t *testing.T, path string) reply {
	t.Helper()
	target := srv.URL + path
	for range 10 {
		req, err := http.NewRequest("GET", target, nil)
		if err != nil {
			t.Fatal(err)
		}
		r := send(t, req)
		location := r.header.Get("Location")
		if r.status != http.StatusFound || strings.HasPrefix(location, extensionRedirect) {
			return r
		}
		next, err := req.URL.Parse(location)
		if err != nil {
			t.Fatal(err)
		}
		target = next.String()
	}
	t.Fatalf("the login from %s redirects more than 10 times", path)
	return reply{}
}

// returned reads the query the login window ends with at the extension's redirect URI.
func returned(t *testing.T, r reply) url.Values {
	t.Helper()
	location := r.header.Get("Location")
	base, _, _ := strings.Cut(location, "?")
	if r.status != http.StatusFound || base != extensionRedirect {
		t.Fatalf("the login ended with %s at %q, want a redirect to %s", r, location, extensionRedirect)
	}
	u, err := url.Parse(location)
	if err != nil {
		t.Fatal(err)
	}
	return u.Query()
}

// loginCode runs the login window as subject and returns the code the extension receives with
// the verifier that redeems it.
func loginCode(t *testing.T, subject string) (code, verifier string) {
	t.Helper()
	issuer.Set(fakeoidc.Behavior{Subject: subject})
	verifier, state := secret(t), secret(t)
	got := returned(t, visit(t, authorizationPath(extensionRedirect, challengeOf(verifier), state)))
	if got.Get("state") != state || got.Get("code") == "" || got.Has("error") {
		t.Fatalf("the login returned %v, want a code and state %q", got, state)
	}
	return got.Get("code"), verifier
}

func codeGrant(code, verifier, deviceName string) map[string]any {
	return map[string]any{"grant_type": "authorization_code", "code": code, "code_verifier": verifier, "device_name": deviceName}
}

func refreshGrant(token string) map[string]any {
	return map[string]any{"grant_type": "refresh_token", "refresh_token": token}
}

func createTokens(t *testing.T, body any) reply {
	t.Helper()
	return call(t, "POST", "/v2/tokens", "", body)
}

// member is one signed-in device of a user.
type member struct {
	subject, user, device, access, refresh string
}

func signIn(t *testing.T, subject, deviceName string) member {
	t.Helper()
	code, verifier := loginCode(t, subject)
	got := readJSON[api.Tokens](t, must(t, "token for a login code", createTokens(t, codeGrant(code, verifier, deviceName)), http.StatusOK))
	return member{subject: subject, user: got.UserId.String(), device: got.DeviceId.String(), access: got.AccessToken, refresh: got.RefreshToken}
}

// newMember signs a new user in through a subject the issuer has not seen.
func newMember(t *testing.T) member {
	t.Helper()
	return signIn(t, "v2-"+secret(t), "first device")
}

// another signs the same user in on another device.
func (m member) another(t *testing.T, deviceName string) member {
	t.Helper()
	return signIn(t, m.subject, deviceName)
}

// execSQL writes a state no endpoint makes, such as an expired row.
func execSQL(t *testing.T, query string, args ...any) int64 {
	t.Helper()
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	tag, err := conn.Exec(ctx, query, args...)
	if err != nil {
		t.Fatal(err)
	}
	return tag.RowsAffected()
}

func staleAccessToken(t *testing.T, deviceID string) string {
	t.Helper()
	token := secret(t)
	hash := sha256.Sum256([]byte(token))
	execSQL(t, `INSERT INTO sessions (token_hash, device_id, kind, expires_at) VALUES ($1, $2, 'access', now() - interval '1 minute')`, hash[:], deviceID)
	return token
}

// padTo returns the JSON of v followed by spaces up to exactly size bytes.
func padTo(t *testing.T, v any, size int) []byte {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) > size {
		t.Fatalf("the JSON is %d bytes, more than %d", len(raw), size)
	}
	return append(raw, bytes.Repeat([]byte(" "), size-len(raw))...)
}

// bodyLimit is the x-body-limit-bytes of an operation of the contract.
func bodyLimit(t *testing.T, op *openapi3.Operation) (int, bool) {
	t.Helper()
	v, ok := op.Extensions["x-body-limit-bytes"]
	if !ok {
		return 0, false
	}
	n, err := strconv.ParseFloat(fmt.Sprint(v), 64)
	if err != nil {
		t.Fatalf("x-body-limit-bytes of %s is %v", op.OperationID, v)
	}
	return int(n), true
}

// sealedBytes stands in for a ciphertext of n bytes.
func sealedBytes(n int, fill byte) []byte { return bytes.Repeat([]byte{fill}, n) }

func sha256Of(s string) []byte {
	h := sha256.Sum256([]byte(s))
	return h[:]
}
