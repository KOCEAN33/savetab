package api_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/KOCEAN33/savetab/apps/server/internal/api"
)

func createShare(t *testing.T, m member, id string, data []byte) reply {
	t.Helper()
	return call(t, "POST", "/v2/shares", m.access, map[string]any{"id": id, "data": data})
}

func TestCreatedShareIsReadWithoutAToken(t *testing.T) {
	m := newMember(t)
	id := uuid.NewString()
	r := createShare(t, m, id, []byte("sealed group"))
	if !wantStatus(t, "create", r, http.StatusCreated) {
		return
	}
	created := readJSON[api.ShareCreated](t, r)
	if created.Id.String() != id || !created.ExpiresAt.After(time.Now()) {
		t.Errorf("created %+v, want id %s and expires_at in the future", created, id)
	}
	got := readJSON[api.Share](t, must(t, "read", call(t, "GET", "/v2/shares/"+id, "", nil), http.StatusOK))
	if string(got.Data) != "sealed group" || !got.ExpiresAt.Equal(created.ExpiresAt) {
		t.Errorf("read %q expiring %v, want %q expiring %v", got.Data, got.ExpiresAt, "sealed group", created.ExpiresAt)
	}
}

func TestShareIDInUseIsAConflictAndStoresNoSecondShare(t *testing.T) {
	m := newMember(t)
	stranger := newMember(t)
	id := uuid.NewString()
	must(t, "create", createShare(t, m, id, []byte("first")), http.StatusCreated)

	wantProblem(t, "the same id again", createShare(t, m, id, []byte("second")), http.StatusConflict)
	wantProblem(t, "the same id by another user", createShare(t, stranger, id, []byte("stranger's")), http.StatusConflict)
	if got := readJSON[api.Share](t, must(t, "read", call(t, "GET", "/v2/shares/"+id, "", nil), http.StatusOK)); string(got.Data) != "first" {
		t.Errorf("read %q, want the first share's %q", got.Data, "first")
	}
	wantProblem(t, "another user deletes it", call(t, "DELETE", "/v2/shares/"+id, stranger.access, nil), http.StatusNotFound)
	wantStatus(t, "the owner deletes it", call(t, "DELETE", "/v2/shares/"+id, m.access, nil), http.StatusNoContent)
}

func TestShareIsDeletedOnlyByItsOwnersDevices(t *testing.T) {
	owner, other := newMember(t), newMember(t)
	id := uuid.NewString()
	must(t, "create", createShare(t, owner, id, []byte("x")), http.StatusCreated)

	wantProblem(t, "another user deletes", call(t, "DELETE", "/v2/shares/"+id, other.access, nil), http.StatusNotFound)
	wantStatus(t, "read after", call(t, "GET", "/v2/shares/"+id, "", nil), http.StatusOK)
	wantStatus(t, "another device of the owner deletes", call(t, "DELETE", "/v2/shares/"+id, owner.another(t, "second").access, nil), http.StatusNoContent)
	wantProblem(t, "read after delete", call(t, "GET", "/v2/shares/"+id, "", nil), http.StatusNotFound)
}

func TestExpiredShareIsNotFound(t *testing.T) {
	m := newMember(t)
	id := uuid.NewString()
	must(t, "create", createShare(t, m, id, []byte("x")), http.StatusCreated)
	if n := execSQL(t, `UPDATE shares SET expires_at = now() - interval '1 minute' WHERE id = $1`, id); n != 1 {
		t.Fatalf("expired %d shares, want 1", n)
	}
	wantProblem(t, "read", call(t, "GET", "/v2/shares/"+id, "", nil), http.StatusNotFound)
}

func TestMalformedShareRequestsAreInvalid(t *testing.T) {
	m := newMember(t)
	for name, body := range map[string]any{
		"no id":            map[string]any{"data": []byte("x")},
		"id is not a uuid": map[string]any{"id": "nope", "data": []byte("x")},
		"no data":          map[string]any{"id": uuid.NewString()},
		"empty data":       map[string]any{"id": uuid.NewString(), "data": ""},
	} {
		wantProblem(t, name, call(t, "POST", "/v2/shares", m.access, body), http.StatusBadRequest)
	}
	wantProblem(t, "read an id that is not a uuid", call(t, "GET", "/v2/shares/nope", "", nil), http.StatusBadRequest)
	wantProblem(t, "delete an id that is not a uuid", call(t, "DELETE", "/v2/shares/nope", m.access, nil), http.StatusBadRequest)
	wantProblem(t, "read an unknown share", call(t, "GET", "/v2/shares/"+uuid.NewString(), "", nil), http.StatusNotFound)
	wantProblem(t, "delete an unknown share", call(t, "DELETE", "/v2/shares/"+uuid.NewString(), m.access, nil), http.StatusNotFound)
}
