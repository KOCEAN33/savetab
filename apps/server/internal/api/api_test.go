package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/api"
	"github.com/KOCEAN33/savetab/apps/server/internal/fakeoidc"
	"github.com/KOCEAN33/savetab/apps/server/internal/store"
	"github.com/KOCEAN33/savetab/apps/server/internal/testdb"
)

var (
	db    *store.Store
	srv   *httptest.Server
	dbURL string
)

func TestMain(m *testing.M) {
	os.Exit(run(m))
}

func run(m *testing.M) int {
	url, stop, err := testdb.Start()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stop()
	dbURL = url
	ctx := context.Background()
	if db, err = store.Open(ctx, url); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer db.Close()
	if err := db.Migrate(ctx); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	issuer = fakeoidc.New(clientID, clientSecret)
	defer issuer.Close()
	// The login needs the server's URL, which exists only once the server listens.
	var handler http.Handler
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { handler.ServeHTTP(w, r) }))
	defer srv.Close()
	login, err := api.NewLogin(ctx, api.LoginConfig{
		Issuer: issuer.URL, ClientID: clientID, ClientSecret: clientSecret,
		PublicURL: srv.URL, RedirectURIs: []string{extensionRedirect},
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	handler = api.New(db, login)
	return m.Run()
}

type device struct {
	id    string
	token string
}

func newUser(t *testing.T) string {
	t.Helper()
	id, err := db.CreateUser(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func newDevice(t *testing.T, userID string) device {
	t.Helper()
	ctx := context.Background()
	id, err := db.CreateDevice(ctx, userID, "test")
	if err != nil {
		t.Fatal(err)
	}
	token, err := db.IssueSession(ctx, id, store.Access, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	return device{id: id, token: token}
}

type op struct {
	ID   string `json:"id"`
	Data []byte `json:"data"`
}

type pulled struct {
	Seq        int64  `json:"seq"`
	ID         string `json:"id"`
	DeviceID   string `json:"deviceId"`
	Data       []byte `json:"data"`
	ReceivedAt int64  `json:"receivedAt"`
}

type pullResult struct {
	Ops        []pulled `json:"ops"`
	More       bool     `json:"more"`
	ServerTime int64    `json:"serverTime"`
}

// opID gives a distinct, valid op id per n.
func opID(n int) string {
	return fmt.Sprintf("01900000-0000-7000-8000-%012x", n)
}

func request(t *testing.T, method, path, token string, body any) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	req, err := http.NewRequest(method, srv.URL+path, &buf)
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
	t.Cleanup(func() { res.Body.Close() })
	return res
}

// expect checks the status and, when code is not empty, the error code in the body.
func expect(t *testing.T, what string, res *http.Response, status int, code string) {
	t.Helper()
	if res.StatusCode != status {
		t.Errorf("%s: status %d, want %d", what, res.StatusCode, status)
		return
	}
	if code == "" {
		return
	}
	if got := decode[map[string]string](t, res)["error"]; got != code {
		t.Errorf("%s: error %q, want %q", what, got, code)
	}
}

func decode[T any](t *testing.T, res *http.Response) T {
	t.Helper()
	var out T
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func push(t *testing.T, d device, ops ...op) {
	t.Helper()
	res := request(t, "POST", "/v1/ops", d.token, map[string]any{"ops": ops})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("push: status %d", res.StatusCode)
	}
}

func pull(t *testing.T, d device, query string) pullResult {
	t.Helper()
	res := request(t, "GET", "/v1/ops"+query, d.token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("pull: status %d", res.StatusCode)
	}
	var out pullResult
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestPushIsReadBackInOrderByAnotherDevice(t *testing.T) {
	user := newUser(t)
	a, b := newDevice(t, user), newDevice(t, user)
	before := time.Now().UnixMilli()
	push(t, a, op{opID(1), []byte("first")}, op{opID(2), []byte("second")})
	push(t, b, op{opID(3), []byte("third")})
	after := time.Now().UnixMilli()

	got := pull(t, b, "")
	want := []struct {
		id, device, data string
	}{{opID(1), a.id, "first"}, {opID(2), a.id, "second"}, {opID(3), b.id, "third"}}
	if len(got.Ops) != len(want) {
		t.Fatalf("got %d ops, want %d", len(got.Ops), len(want))
	}
	for i, w := range want {
		g := got.Ops[i]
		if g.Seq != int64(i+1) || g.ID != w.id || g.DeviceID != w.device || string(g.Data) != w.data {
			t.Errorf("op %d = %+v, want seq %d id %s device %s data %q", i, g, i+1, w.id, w.device, w.data)
		}
		// The database stamps the time, so allow for its clock differing from this machine's.
		if g.ReceivedAt < before-5000 || g.ReceivedAt > after+5000 {
			t.Errorf("op %d receivedAt %d not within 5 s of [%d, %d]", i, g.ReceivedAt, before, after)
		}
	}
	if got.More {
		t.Error("more = true, want false")
	}
	if got.ServerTime < before || got.ServerTime > time.Now().UnixMilli() {
		t.Errorf("serverTime %d is not the current time", got.ServerTime)
	}
}

func TestRepeatedPushIsStoredOnce(t *testing.T) {
	d := newDevice(t, newUser(t))
	push(t, d, op{opID(1), []byte("one")})
	push(t, d, op{opID(1), []byte("one again")}, op{opID(2), []byte("two")}, op{opID(2), []byte("two again")})

	got := pull(t, d, "")
	if len(got.Ops) != 2 {
		t.Fatalf("got %d ops, want 2", len(got.Ops))
	}
	if got.Ops[0].Seq != 1 || string(got.Ops[0].Data) != "one" || got.Ops[1].Seq != 2 || string(got.Ops[1].Data) != "two" {
		t.Errorf("got %+v, want seq 1 %q then seq 2 %q", got.Ops, "one", "two")
	}
}

func TestUsersDoNotShareALog(t *testing.T) {
	mine, theirs := newDevice(t, newUser(t)), newDevice(t, newUser(t))
	push(t, mine, op{opID(1), []byte("mine")})
	// The same op id under another user is a different op.
	push(t, theirs, op{opID(1), []byte("theirs")})

	got := pull(t, theirs, "")
	if len(got.Ops) != 1 || string(got.Ops[0].Data) != "theirs" || got.Ops[0].Seq != 1 {
		t.Errorf("got %+v, want only the caller's own op at seq 1", got.Ops)
	}
}

func TestPullPages(t *testing.T) {
	d := newDevice(t, newUser(t))
	for i := 1; i <= 5; i++ {
		push(t, d, op{opID(i), []byte{byte(i)}})
	}
	first := pull(t, d, "?limit=2")
	if len(first.Ops) != 2 || first.Ops[1].Seq != 2 || !first.More {
		t.Errorf("limit=2: got %d ops, more %v, want seq 1-2 and more", len(first.Ops), first.More)
	}
	last := pull(t, d, "?after=4&limit=2")
	if len(last.Ops) != 1 || last.Ops[0].Seq != 5 || last.More {
		t.Errorf("after=4: got %+v, more %v, want seq 5 and no more", last.Ops, last.More)
	}
	exact := pull(t, d, "?after=3&limit=2")
	if len(exact.Ops) != 2 || exact.More {
		t.Errorf("after=3 limit=2: got %d ops, more %v, want 2 and no more", len(exact.Ops), exact.More)
	}
}

func TestConcurrentPushesGiveGaplessSeq(t *testing.T) {
	user := newUser(t)
	const devices, perDevice = 8, 25
	var wg sync.WaitGroup
	for i := range devices {
		d := newDevice(t, user)
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range perDevice {
				res := request(t, "POST", "/v1/ops", d.token, map[string]any{"ops": []op{{opID(i*perDevice + j), []byte("x")}}})
				if res.StatusCode != http.StatusOK {
					t.Errorf("push: status %d", res.StatusCode)
				}
			}
		}()
	}
	wg.Wait()

	got := pull(t, newDevice(t, user), "")
	if len(got.Ops) != devices*perDevice {
		t.Fatalf("got %d ops, want %d", len(got.Ops), devices*perDevice)
	}
	for i, o := range got.Ops {
		if o.Seq != int64(i+1) {
			t.Fatalf("op %d has seq %d, want %d", i, o.Seq, i+1)
		}
	}
}

func TestRequestsWithoutAValidAccessTokenGet401(t *testing.T) {
	ctx := context.Background()
	user := newUser(t)
	d := newDevice(t, user)
	expired, err := db.IssueSession(ctx, d.id, store.Access, -time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	refresh, err := db.IssueSession(ctx, d.id, store.Refresh, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	revoked := newDevice(t, user)
	if err := db.RevokeDevice(ctx, revoked.id); err != nil {
		t.Fatal(err)
	}

	for name, token := range map[string]string{
		"no token":       "",
		"unknown token":  "not-a-token",
		"expired token":  expired,
		"refresh token":  refresh,
		"revoked device": revoked.token,
	} {
		for _, method := range []string{"GET", "POST"} {
			res := request(t, method, "/v1/ops", token, map[string]any{"ops": []op{{opID(1), []byte("x")}}})
			if res.StatusCode != http.StatusUnauthorized {
				t.Errorf("%s, %s: status %d, want 401", name, method, res.StatusCode)
			}
		}
	}
	for _, route := range []string{
		"GET /v1/key", "PUT /v1/key", "GET /v1/snapshot", "PUT /v1/snapshot",
		"POST /v1/pairings", "GET /v1/pairings", "GET /v1/pairings/" + opID(1), "PUT /v1/pairings/" + opID(1),
	} {
		method, path, _ := strings.Cut(route, " ")
		res := request(t, method, path, "", map[string]any{"data": []byte("x")})
		if res.StatusCode != http.StatusUnauthorized {
			t.Errorf("no token, %s: status %d, want 401", route, res.StatusCode)
		}
	}
	if got := pull(t, d, ""); len(got.Ops) != 0 {
		t.Errorf("a rejected push stored %d ops", len(got.Ops))
	}
}

func TestMalformedRequestsGet400(t *testing.T) {
	d := newDevice(t, newUser(t))
	tooMany := make([]op, 501)
	for i := range tooMany {
		tooMany[i] = op{opID(i), []byte("x")}
	}
	for name, ops := range map[string][]op{
		"op id is not a uuid": {{"nope", []byte("x")}},
		"empty data":          {{opID(1), nil}},
		"501 ops":             tooMany,
	} {
		res := request(t, "POST", "/v1/ops", d.token, map[string]any{"ops": ops})
		if res.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, res.StatusCode)
		}
	}
	for _, query := range []string{"?after=-1", "?after=x", "?limit=0", "?limit=501"} {
		res := request(t, "GET", "/v1/ops"+query, d.token, nil)
		if res.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", query, res.StatusCode)
		}
	}
	if got := pull(t, d, ""); len(got.Ops) != 0 {
		t.Errorf("a rejected push stored %d ops", len(got.Ops))
	}
}

// A browser extension calls the API from its own origin, so the browser asks first.
func TestBrowserOriginsMayCallTheAPI(t *testing.T) {
	req, err := http.NewRequest("OPTIONS", srv.URL+"/v1/ops", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", "chrome-extension://abcdefghijklmnopabcdefghijklmnop")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "authorization, content-type")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Errorf("preflight: status %d, want 204", res.StatusCode)
	}
	for header, want := range map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, POST, PUT",
		"Access-Control-Allow-Headers": "Authorization, Content-Type",
	} {
		if got := res.Header.Get(header); got != want {
			t.Errorf("preflight: %s = %q, want %q", header, got, want)
		}
	}

	res = request(t, "GET", "/v1/ops", "", nil)
	if got := res.Header.Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("a 401 answer: Access-Control-Allow-Origin = %q, want * so the extension can read the status", got)
	}
}
