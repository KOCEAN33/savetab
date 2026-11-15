package api_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/KOCEAN33/savetab/apps/server/internal/api"
)

// fillPath puts a fresh uuid in each path parameter of a contract path.
func fillPath(path string) string {
	for {
		start := strings.Index(path, "{")
		if start < 0 {
			return path
		}
		end := strings.Index(path, "}")
		path = path[:start] + uuid.NewString() + path[end+1:]
	}
}

func TestMalformedJSONIsAnInvalidProblemListingItsErrors(t *testing.T) {
	m := newMember(t)
	for name, c := range map[string]struct{ method, path, token, body string }{
		"POST /v2/ops":    {"POST", "/v2/ops", m.access, `{"ops": [`},
		"PUT /v2/key":     {"PUT", "/v2/key", m.access, "not json"},
		"POST /v2/tokens": {"POST", "/v2/tokens", "", "{"},
	} {
		p := wantProblem(t, name, call(t, c.method, c.path, c.token, []byte(c.body)), http.StatusBadRequest)
		if p.Errors == nil || len(*p.Errors) == 0 {
			t.Errorf("%s: problem without errors, want each failure listed", name)
			continue
		}
		for i, e := range *p.Errors {
			if e.Detail == "" {
				t.Errorf("%s: errors[%d] has no detail", name, i)
			}
		}
	}
}

func TestUnknownRouteUnderV2IsANotFoundProblem(t *testing.T) {
	m := newMember(t)
	for _, path := range []string{"/v2/nope", "/v2/ops/extra", "/v2/"} {
		wantProblem(t, "GET "+path, call(t, "GET", path, m.access, nil), http.StatusNotFound)
	}
}

func TestWrongMethodOnAKnownPathIsAMethodNotAllowedProblem(t *testing.T) {
	m := newMember(t)
	for _, route := range []string{"DELETE /v2/ops", "POST /v2/key", "PUT /v2/devices", "GET /v2/tokens", "POST /v2/shares/" + uuid.NewString()} {
		method, path, _ := strings.Cut(route, " ")
		wantProblem(t, route, call(t, method, path, m.access, nil), http.StatusMethodNotAllowed)
	}
}

func TestBodyOneByteOverItsOperationsLimitIsAContentTooLargeProblem(t *testing.T) {
	doc, err := contract()
	if err != nil {
		t.Fatal(err)
	}
	m := newMember(t)
	tested := 0
	for path, item := range doc.Paths.Map() {
		for method, op := range item.Operations() {
			limit, ok := bodyLimit(t, op)
			if !ok {
				continue
			}
			tested++
			r := call(t, method, fillPath(path), m.access, padTo(t, map[string]any{}, limit+1))
			wantProblem(t, method+" "+path+" with a body of its limit plus one byte", r, http.StatusRequestEntityTooLarge)
		}
	}
	if tested == 0 {
		t.Fatal("no operation of the contract has x-body-limit-bytes")
	}
}

func TestBodyExactlyAtItsLimitIsNotRefusedForItsSize(t *testing.T) {
	doc, err := contract()
	if err != nil {
		t.Fatal(err)
	}
	keyLimit, ok := bodyLimit(t, doc.Paths.Value("/v2/key").Put)
	if !ok {
		t.Fatal("PUT /v2/key has no x-body-limit-bytes")
	}
	tokensLimit, ok := bodyLimit(t, doc.Paths.Value("/v2/tokens").Post)
	if !ok {
		t.Fatal("POST /v2/tokens has no x-body-limit-bytes")
	}

	m := newMember(t)
	wrapped := sealedBytes(1024, 'k')
	wantStatus(t, "a valid key padded to the limit", call(t, "PUT", "/v2/key", m.access, padTo(t, api.Key{Data: wrapped}, keyLimit)), http.StatusNoContent)
	if got := readKey(t, m); string(got) != string(wrapped) {
		t.Errorf("read a key of %d bytes, want the 1024 stored", len(got))
	}
	wantProblem(t, "a token request without its refresh_token padded to the limit",
		call(t, "POST", "/v2/tokens", "", padTo(t, map[string]any{"grant_type": "refresh_token"}, tokensLimit)), http.StatusBadRequest)
}

func TestBearerOperationsRefuseAMissingGarbageExpiredOrRefreshToken(t *testing.T) {
	doc, err := contract()
	if err != nil {
		t.Fatal(err)
	}
	m := newMember(t)
	bodies := map[string]any{
		"pushOps":           map[string]any{"ops": []opIn{{uuid.NewString(), []byte("x")}}},
		"putKey":            api.Key{Data: []byte("k")},
		"putSnapshot":       api.Snapshot{Seq: 1, Data: []byte("s")},
		"createPairing":     map[string]any{"id": uuid.NewString(), "commitment": sha256Of("c")},
		"putPairingMessage": map[string]any{"old_public": []byte("o")},
		"createShare":       map[string]any{"id": uuid.NewString(), "data": []byte("x")},
	}
	tokens := map[string]string{
		"no token":             "",
		"garbage token":        "garbage",
		"expired access token": staleAccessToken(t, m.device),
		"refresh token":        m.refresh,
	}
	tested := 0
	for path, item := range doc.Paths.Map() {
		for method, op := range item.Operations() {
			if op.Security != nil {
				continue
			}
			var body any
			if op.RequestBody != nil {
				var ok bool
				if body, ok = bodies[strings.ToLower(op.OperationID[:1])+op.OperationID[1:]]; !ok {
					t.Fatalf("no valid body for %s", op.OperationID)
				}
			}
			tested++
			for name, token := range tokens {
				wantProblem(t, name+", "+method+" "+path, call(t, method, fillPath(path), token, body), http.StatusUnauthorized)
			}
		}
	}
	if tested == 0 {
		t.Fatal("no operation of the contract takes a bearer token")
	}
	if got := listOps(t, m, "").Ops; len(got) != 0 {
		t.Errorf("refused pushes stored %d ops", len(got))
	}
	wantProblem(t, "the key after refused stores", call(t, "GET", "/v2/key", m.access, nil), http.StatusNotFound)
	wantProblem(t, "the snapshot after refused stores", call(t, "GET", "/v2/snapshot", m.access, nil), http.StatusNotFound)
	if got := listPairingIDs(t, m); len(got) != 0 {
		t.Errorf("refused requests opened pairings %v", got)
	}
}

func TestEveryTimeIsAnRFC3339StringInUTC(t *testing.T) {
	m := newMember(t)
	type times map[string]json.RawMessage
	check := func(what string, r reply, keys ...string) {
		t.Helper()
		var v times
		if err := json.Unmarshal(r.body, &v); err != nil {
			t.Fatalf("%s: %s: %v", what, r, err)
		}
		for _, k := range keys {
			var s string
			if err := json.Unmarshal(v[k], &s); err != nil || !isUTC(s) {
				t.Errorf("%s: %s = %s, want an RFC 3339 string in UTC", what, k, v[k])
			}
		}
	}
	first := func(what string, r reply, list string) reply {
		t.Helper()
		var v map[string]json.RawMessage
		var items []json.RawMessage
		if err := json.Unmarshal(r.body, &v); err != nil || json.Unmarshal(v[list], &items) != nil || len(items) == 0 {
			t.Fatalf("%s: %s, want a %s item", what, r, list)
		}
		return reply{body: items[0]}
	}

	check("push", must(t, "push", pushOps(t, m, opIn{uuid.NewString(), []byte("x")}), http.StatusOK), "server_time")
	listed := must(t, "list ops", call(t, "GET", "/v2/ops", m.access, nil), http.StatusOK)
	check("list ops", listed, "server_time")
	check("listed op", first("list ops", listed, "ops"), "received_at")
	check("devices", first("list devices", must(t, "list devices", call(t, "GET", "/v2/devices", m.access, nil), http.StatusOK), "devices"), "created_at")
	id := uuid.NewString()
	check("open pairing", must(t, "open pairing", openPairing(t, m, id, sha256Of(id)), http.StatusCreated), "expires_at")
	check("read pairing", must(t, "read pairing", call(t, "GET", "/v2/pairings/"+id, m.access, nil), http.StatusOK), "expires_at")
	check("listed pairing", first("list pairings", must(t, "list pairings", call(t, "GET", "/v2/pairings", m.access, nil), http.StatusOK), "pairings"), "expires_at")
	check("create share", must(t, "create share", createShare(t, m, id, []byte("x")), http.StatusCreated), "expires_at")
	check("read share", must(t, "read share", call(t, "GET", "/v2/shares/"+id, "", nil), http.StatusOK), "expires_at")
}
