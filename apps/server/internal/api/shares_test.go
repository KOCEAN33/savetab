package api_test

import (
	"bytes"
	"context"
	"io"
	"mime"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

type shareCreated struct {
	ID        string `json:"id"`
	ExpiresAt int64  `json:"expiresAt"`
}

type shareRead struct {
	Data      []byte `json:"data"`
	ExpiresAt int64  `json:"expiresAt"`
}

var uuidText = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func postShare(t *testing.T, d device, data []byte) shareCreated {
	t.Helper()
	res := request(t, "POST", "/v1/shares", d.token, map[string][]byte{"data": data})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("post share: status %d, want 201", res.StatusCode)
	}
	return decode[shareCreated](t, res)
}

// shareStored tells whether the share's row exists. An expired share answers 404 either way,
// so only the table tells a deleted share from a hidden one.
func shareStored(t *testing.T, id string) bool {
	t.Helper()
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	var n int
	if err := conn.QueryRow(ctx, `SELECT count(*) FROM shares WHERE id = $1`, id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n == 1
}

func TestShareIsReadBackWithoutAToken(t *testing.T) {
	d := newDevice(t, newUser(t))
	blob := []byte{0x01, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0xfe, 0xff}

	before := time.Now()
	created := postShare(t, d, blob)
	after := time.Now()
	if !uuidText.MatchString(created.ID) {
		t.Errorf("id %q is not a UUID", created.ID)
	}
	// The database stamps the time, so allow for its clock differing from this machine's.
	ttl := 30 * 24 * time.Hour
	low, high := before.Add(ttl-5*time.Second).UnixMilli(), after.Add(ttl+5*time.Second).UnixMilli()
	if created.ExpiresAt < low || created.ExpiresAt > high {
		t.Errorf("expiresAt %d is not 30 days ahead, want within [%d, %d]", created.ExpiresAt, low, high)
	}

	res := request(t, "GET", "/v1/shares/"+created.ID, "", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("get share: status %d, want 200", res.StatusCode)
	}
	got := decode[shareRead](t, res)
	if !bytes.Equal(got.Data, blob) || got.ExpiresAt != created.ExpiresAt {
		t.Errorf("share = %x expiring %d, want %x expiring %d", got.Data, got.ExpiresAt, blob, created.ExpiresAt)
	}
}

func TestExpiredShareAnswers404AndTheNextPostDeletesIt(t *testing.T) {
	user := newUser(t)
	owner := newDevice(t, user)
	expired, err := db.CreateShare(context.Background(), user, []byte("x"), -time.Second)
	if err != nil {
		t.Fatal(err)
	}

	expect(t, "get", request(t, "GET", "/v1/shares/"+expired.ID, "", nil), http.StatusNotFound, "not_found")
	expect(t, "delete", request(t, "DELETE", "/v1/shares/"+expired.ID, owner.token, nil), http.StatusNotFound, "not_found")
	if !shareStored(t, expired.ID) {
		t.Fatal("the expired share is gone before any post, want it kept until one")
	}
	postShare(t, newDevice(t, newUser(t)), []byte("y"))
	if shareStored(t, expired.ID) {
		t.Error("the expired share is still stored after another user's post, want it deleted")
	}
}

func TestShareIsDeletedOnlyByItsOwner(t *testing.T) {
	owner := newDevice(t, newUser(t))
	stranger := newDevice(t, newUser(t))
	id := postShare(t, owner, []byte("blob")).ID
	path := "/v1/shares/" + id

	expect(t, "delete by another user", request(t, "DELETE", path, stranger.token, nil), http.StatusNotFound, "not_found")
	expect(t, "get after the other user's delete", request(t, "GET", path, "", nil), http.StatusOK, "")

	expect(t, "delete by the owner", request(t, "DELETE", path, owner.token, nil), http.StatusNoContent, "")
	expect(t, "get after the owner's delete", request(t, "GET", path, "", nil), http.StatusNotFound, "not_found")
	expect(t, "delete again", request(t, "DELETE", path, owner.token, nil), http.StatusNotFound, "not_found")
}

func TestMalformedShareRequests(t *testing.T) {
	d := newDevice(t, newUser(t))

	expect(t, "get a malformed id", request(t, "GET", "/v1/shares/not-a-uuid", "", nil), http.StatusNotFound, "not_found")
	expect(t, "delete a malformed id", request(t, "DELETE", "/v1/shares/not-a-uuid", d.token, nil), http.StatusNotFound, "not_found")
	expect(t, "get an unknown id", request(t, "GET", "/v1/shares/01900000-0000-7000-8000-000000000000", "", nil), http.StatusNotFound, "not_found")
	expect(t, "post empty data", request(t, "POST", "/v1/shares", d.token, map[string][]byte{"data": {}}), http.StatusBadRequest, "bad_request")
	expect(t, "post no data", request(t, "POST", "/v1/shares", d.token, map[string]any{}), http.StatusBadRequest, "bad_request")
	expect(t, "post without a token", request(t, "POST", "/v1/shares", "", map[string][]byte{"data": []byte("x")}), http.StatusUnauthorized, "unauthorized")
}

func TestShareViewerAnswersCarryThePageHeaders(t *testing.T) {
	cases := []struct {
		path, mediaType string
	}{
		{"/s/01900000-0000-7000-8000-000000000001", "text/html"},
		{"/s/assets/share.js", "text/javascript"},
		{"/s/assets/share.css", "text/css"},
	}
	headers := map[string]string{
		"Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
		"Referrer-Policy":         "no-referrer",
		"X-Robots-Tag":            "noindex",
	}
	for _, c := range cases {
		res := request(t, "GET", c.path, "", nil)
		if res.StatusCode != http.StatusOK {
			t.Errorf("%s: status %d, want 200", c.path, res.StatusCode)
			continue
		}
		if got, _, err := mime.ParseMediaType(res.Header.Get("Content-Type")); err != nil || got != c.mediaType {
			t.Errorf("%s: Content-Type %q, want %s", c.path, res.Header.Get("Content-Type"), c.mediaType)
		}
		for name, want := range headers {
			if got := res.Header.Get(name); got != want {
				t.Errorf("%s: %s %q, want %q", c.path, name, got, want)
			}
		}
	}
}

func TestShareViewerPageIsTheSameForEveryID(t *testing.T) {
	page := func(id string) string {
		t.Helper()
		res := request(t, "GET", "/s/"+id, "", nil)
		body, err := io.ReadAll(res.Body)
		if err != nil {
			t.Fatal(err)
		}
		return string(body)
	}
	a, b := page("01900000-0000-7000-8000-000000000001"), page("01900000-0000-7000-8000-000000000002")
	if a != b || !strings.Contains(a, "share.js") || !strings.Contains(a, "share.css") {
		t.Errorf("page for two ids:\n%s\n---\n%s\nwant one page that loads share.js and share.css", a, b)
	}
}
