package api_test

import (
	"bytes"
	"net/http"
	"testing"

	"github.com/KOCEAN33/savetab/apps/server/internal/api"
)

func readKey(t *testing.T, s *server, m member) []byte {
	t.Helper()
	return readJSON[api.Key](t, must(t, "read the key", call(t, s, "GET", "/v2/key", m.access, nil), http.StatusOK)).Data
}

func TestKeyIsStoredOnceAndReadByAnotherDevice(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	first := newMember(t, s)
	wantProblem(t, "read before any key", call(t, s, "GET", "/v2/key", first.access, nil), http.StatusNotFound)

	wrapped := sealedBytes(48, 'k')
	wantStatus(t, "store", call(t, s, "PUT", "/v2/key", first.access, api.Key{Data: wrapped}), http.StatusNoContent)
	if got := readKey(t, s, first.another(t, s, "second")); !bytes.Equal(got, wrapped) {
		t.Errorf("another device read %q, want %q", got, wrapped)
	}
	wantProblem(t, "store again", call(t, s, "PUT", "/v2/key", first.access, api.Key{Data: sealedBytes(48, 'x')}), http.StatusConflict)
	if got := readKey(t, s, first); !bytes.Equal(got, wrapped) {
		t.Errorf("after a refused second store the key is %q, want %q", got, wrapped)
	}
}

func TestKeyOfOneUserIsHiddenFromAnother(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	owner, other := newMember(t, s), newMember(t, s)
	must(t, "owner stores", call(t, s, "PUT", "/v2/key", owner.access, api.Key{Data: []byte("owner's")}), http.StatusNoContent)

	wantProblem(t, "another user reads", call(t, s, "GET", "/v2/key", other.access, nil), http.StatusNotFound)
	wantStatus(t, "another user stores their own", call(t, s, "PUT", "/v2/key", other.access, api.Key{Data: []byte("other's")}), http.StatusNoContent)
	if got := readKey(t, s, owner); string(got) != "owner's" {
		t.Errorf("the owner reads %q, want %q", got, "owner's")
	}
	if got := readKey(t, s, other); string(got) != "other's" {
		t.Errorf("the other user reads %q, want %q", got, "other's")
	}
}

func TestKeyHoldsAtMost1024Bytes(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	m := newMember(t, s)
	for name, body := range map[string]any{
		"1025 bytes":     api.Key{Data: sealedBytes(1025, 'k')},
		"empty data":     map[string]string{"data": ""},
		"no data":        map[string]string{},
		"data in base64": map[string]string{"data": "not base64!"},
	} {
		wantProblem(t, name, call(t, s, "PUT", "/v2/key", m.access, body), http.StatusBadRequest)
	}
	wantProblem(t, "read after refused stores", call(t, s, "GET", "/v2/key", m.access, nil), http.StatusNotFound)

	wantStatus(t, "1024 bytes", call(t, s, "PUT", "/v2/key", m.access, api.Key{Data: sealedBytes(1024, 'k')}), http.StatusNoContent)
	if got := readKey(t, s, m); !bytes.Equal(got, sealedBytes(1024, 'k')) {
		t.Errorf("read %d bytes, want the 1024 stored", len(got))
	}
}
