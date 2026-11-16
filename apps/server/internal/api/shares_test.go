package api_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/KOCEAN33/savetab/apps/server/internal/api"
)

func createShare(t *testing.T, s *server, m member, id string, data []byte) reply {
	t.Helper()
	return call(t, s, "POST", "/v2/shares", m.access, map[string]any{"id": id, "data": data})
}

func TestCreatedShareIsReadWithoutAToken(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	m := newMember(t, s)
	id := uuid.NewString()
	r := createShare(t, s, m, id, []byte("sealed group"))
	if !wantStatus(t, "create", r, http.StatusCreated) {
		return
	}
	created := readJSON[api.ShareCreated](t, r)
	if created.Id.String() != id || !created.ExpiresAt.After(time.Now()) {
		t.Errorf("created %+v, want id %s and expires_at in the future", created, id)
	}
	got := readJSON[api.Share](t, must(t, "read", call(t, s, "GET", "/v2/shares/"+id, "", nil), http.StatusOK))
	if string(got.Data) != "sealed group" || !got.ExpiresAt.Equal(created.ExpiresAt) {
		t.Errorf("read %q expiring %v, want %q expiring %v", got.Data, got.ExpiresAt, "sealed group", created.ExpiresAt)
	}
}

func TestShareIDInUseIsAConflictAndStoresNoSecondShare(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	m := newMember(t, s)
	stranger := newMember(t, s)
	id := uuid.NewString()
	must(t, "create", createShare(t, s, m, id, []byte("first")), http.StatusCreated)

	wantProblem(t, "the same id again", createShare(t, s, m, id, []byte("second")), http.StatusConflict)
	wantProblem(t, "the same id by another user", createShare(t, s, stranger, id, []byte("stranger's")), http.StatusConflict)
	if got := readJSON[api.Share](t, must(t, "read", call(t, s, "GET", "/v2/shares/"+id, "", nil), http.StatusOK)); string(got.Data) != "first" {
		t.Errorf("read %q, want the first share's %q", got.Data, "first")
	}
	wantProblem(t, "another user deletes it", call(t, s, "DELETE", "/v2/shares/"+id, stranger.access, nil), http.StatusNotFound)
	wantStatus(t, "the owner deletes it", call(t, s, "DELETE", "/v2/shares/"+id, m.access, nil), http.StatusNoContent)
}

func TestShareIsDeletedOnlyByItsOwnersDevices(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	owner, other := newMember(t, s), newMember(t, s)
	id := uuid.NewString()
	must(t, "create", createShare(t, s, owner, id, []byte("x")), http.StatusCreated)

	wantProblem(t, "another user deletes", call(t, s, "DELETE", "/v2/shares/"+id, other.access, nil), http.StatusNotFound)
	wantStatus(t, "read after", call(t, s, "GET", "/v2/shares/"+id, "", nil), http.StatusOK)
	wantStatus(t, "another device of the owner deletes", call(t, s, "DELETE", "/v2/shares/"+id, owner.another(t, s, "second").access, nil), http.StatusNoContent)
	wantProblem(t, "read after delete", call(t, s, "GET", "/v2/shares/"+id, "", nil), http.StatusNotFound)
}

func TestExpiredShareIsNotFound(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	m := newMember(t, s)
	id := uuid.NewString()
	must(t, "create", createShare(t, s, m, id, []byte("x")), http.StatusCreated)
	if n := execSQL(t, s, `UPDATE shares SET expires_at = now() - interval '1 minute' WHERE id = $1`, id); n != 1 {
		t.Fatalf("expired %d shares, want 1", n)
	}
	wantProblem(t, "read", call(t, s, "GET", "/v2/shares/"+id, "", nil), http.StatusNotFound)
}

func TestMalformedShareRequestsAreInvalid(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	m := newMember(t, s)
	for name, body := range map[string]any{
		"no id":            map[string]any{"data": []byte("x")},
		"id is not a uuid": map[string]any{"id": "nope", "data": []byte("x")},
		"no data":          map[string]any{"id": uuid.NewString()},
		"empty data":       map[string]any{"id": uuid.NewString(), "data": ""},
	} {
		wantProblem(t, name, call(t, s, "POST", "/v2/shares", m.access, body), http.StatusBadRequest)
	}
	wantProblem(t, "read an id that is not a uuid", call(t, s, "GET", "/v2/shares/nope", "", nil), http.StatusBadRequest)
	wantProblem(t, "delete an id that is not a uuid", call(t, s, "DELETE", "/v2/shares/nope", m.access, nil), http.StatusBadRequest)
	wantProblem(t, "read an unknown share", call(t, s, "GET", "/v2/shares/"+uuid.NewString(), "", nil), http.StatusNotFound)
	wantProblem(t, "delete an unknown share", call(t, s, "DELETE", "/v2/shares/"+uuid.NewString(), m.access, nil), http.StatusNotFound)
}

func viewShare(t *testing.T, s *server, id string) reply {
	t.Helper()
	return call(t, s, "GET", "/v2/shares/"+id+"/view", "", nil)
}

// cspDirectives splits a Content-Security-Policy into its directives, name to sources.
func cspDirectives(policy string) map[string][]string {
	out := map[string][]string{}
	for d := range strings.SplitSeq(policy, ";") {
		fields := strings.Fields(d)
		if len(fields) == 0 {
			continue
		}
		out[strings.ToLower(fields[0])] = fields[1:]
	}
	return out
}

var (
	styleElement   = regexp.MustCompile(`(?is)<style\b[^>]*>(.*?)</style\s*>`)
	scriptElement  = regexp.MustCompile(`(?is)<script\b([^>]*)>(.*?)</script\s*>`)
	srcAttribute   = regexp.MustCompile(`(?i)(^|\s)src\s*=`)
	stylesheetLink = regexp.MustCompile(`(?i)<link\b[^>]*\brel\s*=\s*["']?[^"'>]*\bstylesheet`)
)

func inlineHash(text string) string {
	sum := sha256.Sum256([]byte(text))
	return "'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
}

func TestShareViewerIsOnePageForEveryShareWithoutAToken(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	m := newMember(t, s)
	stored := uuid.NewString()
	must(t, "create", createShare(t, s, m, stored, []byte("sealed group")), http.StatusCreated)

	first := must(t, "view a stored share", viewShare(t, s, stored), http.StatusOK)
	second := must(t, "view an id no share has", viewShare(t, s, uuid.NewString()), http.StatusOK)
	for _, r := range []reply{first, second} {
		if got := mediaType(r.header); got != "text/html" {
			t.Errorf("%s: Content-Type %q, want text/html", r, r.header.Get("Content-Type"))
		}
	}
	if !bytes.Equal(first.body, second.body) {
		t.Errorf("the page for %s differs from the page for another id", stored)
	}
	if bytes.Contains(first.body, []byte("sealed group")) {
		t.Errorf("the page carries the share's data")
	}
}

func TestShareViewerHeaders(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	r := must(t, "view", viewShare(t, s, uuid.NewString()), http.StatusOK)
	if got := r.header.Get("Referrer-Policy"); got != "no-referrer" {
		t.Errorf("Referrer-Policy %q, want no-referrer", got)
	}
	if got := r.header.Get("X-Robots-Tag"); got != "noindex" {
		t.Errorf("X-Robots-Tag %q, want noindex", got)
	}
	if r.header.Get("Content-Security-Policy") == "" {
		t.Errorf("no Content-Security-Policy")
	}
}

func TestShareViewerPolicyAdmitsOnlyItsInlineStyleAndScript(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	r := must(t, "view", viewShare(t, s, uuid.NewString()), http.StatusOK)
	policy := r.header.Get("Content-Security-Policy")
	csp := cspDirectives(policy)
	body := string(r.body)

	if !slices.Equal(csp["default-src"], []string{"'none'"}) {
		t.Errorf("default-src %v in %q, want 'none'", csp["default-src"], policy)
	}
	if !slices.Equal(csp["connect-src"], []string{"'self'"}) {
		t.Errorf("connect-src %v in %q, want 'self'", csp["connect-src"], policy)
	}
	if !slices.Equal(csp["frame-ancestors"], []string{"'none'"}) {
		t.Errorf("frame-ancestors %v in %q, want 'none'", csp["frame-ancestors"], policy)
	}
	for _, name := range []string{"script-src", "style-src"} {
		for _, banned := range []string{"'unsafe-inline'", "'self'"} {
			if slices.ContainsFunc(csp[name], func(s string) bool { return strings.EqualFold(s, banned) }) {
				t.Errorf("%s admits %s: %q", name, banned, policy)
			}
		}
	}

	scripts := scriptElement.FindAllStringSubmatch(body, -1)
	if len(scripts) == 0 {
		t.Fatalf("the page has no script element: %s", r)
	}
	for _, s := range scripts {
		if srcAttribute.MatchString(s[1]) {
			t.Errorf("a script element loads a src: <script%s>", s[1])
		}
		if h := inlineHash(s[2]); !slices.Contains(csp["script-src"], h) {
			t.Errorf("script-src %v lacks %s, the hash of an inline script", csp["script-src"], h)
		}
	}
	for _, s := range styleElement.FindAllStringSubmatch(body, -1) {
		if h := inlineHash(s[1]); !slices.Contains(csp["style-src"], h) {
			t.Errorf("style-src %v lacks %s, the hash of an inline style", csp["style-src"], h)
		}
	}
	if stylesheetLink.MatchString(body) {
		t.Errorf("the page links a stylesheet")
	}
}

func TestShareViewerOfAnIDThatIsNotAUUIDIsInvalid(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	wantProblem(t, "view", viewShare(t, s, "nope"), http.StatusBadRequest)
}

func TestOldShareViewerPathsAreGone(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	for _, path := range []string{"/s/" + uuid.NewString(), "/s/assets/share.js"} {
		wantProblem(t, path, call(t, s, "GET", path, "", nil), http.StatusNotFound)
	}
}
