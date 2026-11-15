package api_test

import (
	"bytes"
	"fmt"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/KOCEAN33/savetab/apps/server/internal/api"
)

func openPairing(t *testing.T, m member, id string, commitment []byte) reply {
	t.Helper()
	return call(t, "POST", "/v2/pairings", m.access, map[string]any{"id": id, "commitment": commitment})
}

// newPairing opens a pairing on m, the new device, and returns its id.
func newPairing(t *testing.T, m member) string {
	t.Helper()
	id := uuid.NewString()
	must(t, "open a pairing", openPairing(t, m, id, sha256Of(id)), http.StatusCreated)
	return id
}

func readPairing(t *testing.T, m member, id string) api.Pairing {
	t.Helper()
	return readJSON[api.Pairing](t, must(t, "read the pairing", call(t, "GET", "/v2/pairings/"+id, m.access, nil), http.StatusOK))
}

func sendMessage(t *testing.T, m member, id, field string, value []byte) reply {
	t.Helper()
	return call(t, "PUT", "/v2/pairings/"+id, m.access, map[string]any{field: value})
}

func listPairingIDs(t *testing.T, m member) []string {
	t.Helper()
	var ids []string
	query := url.Values{}
	for range 100 {
		page := readJSON[api.PairingList](t, must(t, "list pairings", call(t, "GET", "/v2/pairings?"+query.Encode(), m.access, nil), http.StatusOK))
		for _, p := range page.Pairings {
			ids = append(ids, p.Id.String())
		}
		if page.NextPageToken == nil {
			return ids
		}
		query.Set("page_token", *page.NextPageToken)
	}
	t.Fatal("the pairing pages do not end")
	return nil
}

func message(p api.Pairing, field string) []byte {
	ptr := map[string]*[]byte{"old_public": p.OldPublic, "new_public": p.NewPublic, "wrapped_key": p.WrappedKey}[field]
	if ptr == nil {
		return nil
	}
	return *ptr
}

func TestPairingRelaysTheMessagesInOrderToBothSides(t *testing.T) {
	signedIn := newMember(t)
	fresh := signedIn.another(t, "new phone")
	id := uuid.NewString()
	commitment := sha256Of("new public")
	r := openPairing(t, fresh, id, commitment)
	if !wantStatus(t, "open", r, http.StatusCreated) {
		return
	}
	opened := readJSON[api.Pairing](t, r)
	if opened.Id.String() != id || opened.NewDeviceId.String() != fresh.device || opened.NewDeviceName != "new phone" || !bytes.Equal(opened.Commitment, commitment) {
		t.Errorf("opened %+v, want id %s from device %s %q with the commitment", opened, id, fresh.device, "new phone")
	}
	if opened.OldPublic != nil || opened.NewPublic != nil || opened.WrappedKey != nil {
		t.Errorf("a new pairing holds messages: %+v", opened)
	}
	if !opened.ExpiresAt.After(time.Now()) {
		t.Errorf("expires_at %v is not in the future", opened.ExpiresAt)
	}

	steps := []struct {
		from  member
		field string
		value []byte
	}{
		{signedIn, "old_public", []byte("old public")},
		{fresh, "new_public", []byte("new public")},
		{signedIn, "wrapped_key", []byte("wrapped key")},
	}
	for i, step := range steps {
		wantStatus(t, step.field, sendMessage(t, step.from, id, step.field, step.value), http.StatusNoContent)
		for _, reader := range []member{signedIn, fresh} {
			got := readPairing(t, reader, id)
			for j, s := range steps {
				want := s.value
				if j > i {
					want = nil
				}
				if g := message(got, s.field); !bytes.Equal(g, want) {
					t.Errorf("after %s, device %s reads %s = %q, want %q", step.field, reader.device, s.field, g, want)
				}
			}
		}
	}
}

func TestPairingMessageFromTheWrongSideIsForbidden(t *testing.T) {
	signedIn := newMember(t)
	fresh := signedIn.another(t, "new")
	id := newPairing(t, fresh)

	wantProblem(t, "old_public from the new device", sendMessage(t, fresh, id, "old_public", []byte("o")), http.StatusForbidden)
	must(t, "old_public", sendMessage(t, signedIn, id, "old_public", []byte("o")), http.StatusNoContent)
	wantProblem(t, "new_public from a signed-in device", sendMessage(t, signedIn, id, "new_public", []byte("n")), http.StatusForbidden)
	must(t, "new_public", sendMessage(t, fresh, id, "new_public", []byte("n")), http.StatusNoContent)
	wantProblem(t, "wrapped_key from the new device", sendMessage(t, fresh, id, "wrapped_key", []byte("w")), http.StatusForbidden)

	got := readPairing(t, signedIn, id)
	if string(message(got, "old_public")) != "o" || string(message(got, "new_public")) != "n" || got.WrappedKey != nil {
		t.Errorf("after refused messages the pairing holds %+v, want old_public o, new_public n, and no wrapped_key", got)
	}
}

func TestPairingMessageOutOfOrderOrAlreadySetIsAConflict(t *testing.T) {
	signedIn := newMember(t)
	fresh := signedIn.another(t, "new")
	id := newPairing(t, fresh)

	wantProblem(t, "new_public before old_public", sendMessage(t, fresh, id, "new_public", []byte("n")), http.StatusConflict)
	wantProblem(t, "wrapped_key before old_public", sendMessage(t, signedIn, id, "wrapped_key", []byte("w")), http.StatusConflict)
	must(t, "old_public", sendMessage(t, signedIn, id, "old_public", []byte("o")), http.StatusNoContent)
	wantProblem(t, "old_public again", sendMessage(t, signedIn, id, "old_public", []byte("o2")), http.StatusConflict)
	wantProblem(t, "wrapped_key before new_public", sendMessage(t, signedIn, id, "wrapped_key", []byte("w")), http.StatusConflict)
	must(t, "new_public", sendMessage(t, fresh, id, "new_public", []byte("n")), http.StatusNoContent)
	wantProblem(t, "new_public again", sendMessage(t, fresh, id, "new_public", []byte("n2")), http.StatusConflict)
	must(t, "wrapped_key", sendMessage(t, signedIn, id, "wrapped_key", []byte("w")), http.StatusNoContent)
	wantProblem(t, "wrapped_key again", sendMessage(t, signedIn, id, "wrapped_key", []byte("w2")), http.StatusConflict)

	got := readPairing(t, fresh, id)
	if string(message(got, "old_public")) != "o" || string(message(got, "new_public")) != "n" || string(message(got, "wrapped_key")) != "w" {
		t.Errorf("the pairing holds %+v, want the first value of each message", got)
	}
}

func TestPairingMessageIsExactlyOneMessageOfAtMost1024Bytes(t *testing.T) {
	signedIn := newMember(t)
	fresh := signedIn.another(t, "new")
	id := newPairing(t, fresh)
	for name, body := range map[string]any{
		"no message":       map[string]any{},
		"two messages":     map[string]any{"old_public": []byte("o"), "wrapped_key": []byte("w")},
		"unknown message":  map[string]any{"other": []byte("o")},
		"empty message":    map[string]any{"old_public": ""},
		"1025 bytes":       map[string]any{"old_public": sealedBytes(1025, 'o')},
		"message not text": map[string]any{"old_public": 5},
	} {
		wantProblem(t, name, call(t, "PUT", "/v2/pairings/"+id, signedIn.access, body), http.StatusBadRequest)
	}
	if got := readPairing(t, signedIn, id); got.OldPublic != nil || got.NewPublic != nil || got.WrappedKey != nil {
		t.Errorf("refused messages were stored: %+v", got)
	}
	wantStatus(t, "1024 bytes", sendMessage(t, signedIn, id, "old_public", sealedBytes(1024, 'o')), http.StatusNoContent)
	if got := message(readPairing(t, fresh, id), "old_public"); !bytes.Equal(got, sealedBytes(1024, 'o')) {
		t.Errorf("old_public holds %d bytes, want the 1024 sent", len(got))
	}
	wantProblem(t, "pairing id is not a uuid", sendMessage(t, signedIn, "nope", "old_public", []byte("o")), http.StatusBadRequest)
	wantProblem(t, "unknown pairing", sendMessage(t, signedIn, uuid.NewString(), "old_public", []byte("o")), http.StatusNotFound)
}

func TestPairingCommitmentIs32Bytes(t *testing.T) {
	m := newMember(t)
	for name, body := range map[string]any{
		"31 byte commitment": map[string]any{"id": uuid.NewString(), "commitment": sealedBytes(31, 'c')},
		"33 byte commitment": map[string]any{"id": uuid.NewString(), "commitment": sealedBytes(33, 'c')},
		"no commitment":      map[string]any{"id": uuid.NewString()},
		"no id":              map[string]any{"commitment": sealedBytes(32, 'c')},
		"id is not a uuid":   map[string]any{"id": "nope", "commitment": sealedBytes(32, 'c')},
	} {
		wantProblem(t, name, call(t, "POST", "/v2/pairings", m.access, body), http.StatusBadRequest)
	}
	if got := listPairingIDs(t, m); len(got) != 0 {
		t.Errorf("refused requests opened pairings %v", got)
	}
	wantStatus(t, "32 byte commitment", openPairing(t, m, uuid.NewString(), sealedBytes(32, 'c')), http.StatusCreated)
}

func TestPairingIDInUseIsAConflictAndOpensNoSecondPairing(t *testing.T) {
	first := newMember(t)
	second := first.another(t, "second")
	stranger := newMember(t)
	id := uuid.NewString()
	must(t, "open", openPairing(t, first, id, sha256Of("first")), http.StatusCreated)

	wantProblem(t, "the same device again", openPairing(t, first, id, sha256Of("again")), http.StatusConflict)
	wantProblem(t, "another device of the user", openPairing(t, second, id, sha256Of("second")), http.StatusConflict)
	wantProblem(t, "another user", openPairing(t, stranger, id, sha256Of("stranger")), http.StatusConflict)

	if got := listPairingIDs(t, first); len(got) != 1 || got[0] != id {
		t.Errorf("the user lists pairings %v, want only %s", got, id)
	}
	if got := readPairing(t, first, id); !bytes.Equal(got.Commitment, sha256Of("first")) || got.NewDeviceId.String() != first.device {
		t.Errorf("the pairing is %+v, want the first request's", got)
	}
	if got := listPairingIDs(t, stranger); len(got) != 0 {
		t.Errorf("the other user lists pairings %v", got)
	}
}

func TestOpeningAnotherPairingReplacesTheDevicesOpenOne(t *testing.T) {
	m := newMember(t)
	first := newPairing(t, m)
	second := newPairing(t, m)
	if got := listPairingIDs(t, m); len(got) != 1 || got[0] != second {
		t.Errorf("listed %v, want only the second pairing %s", got, second)
	}
	wantProblem(t, "read the replaced pairing", call(t, "GET", "/v2/pairings/"+first, m.access, nil), http.StatusNotFound)
}

func TestExpiredPairingIsNotListed(t *testing.T) {
	m := newMember(t)
	expired := newPairing(t, m)
	live := newPairing(t, m.another(t, "second"))
	if n := execSQL(t, `UPDATE pairings SET expires_at = now() - interval '1 minute' WHERE id = $1`, expired); n != 1 {
		t.Fatalf("expired %d pairings, want 1", n)
	}
	if got := listPairingIDs(t, m); len(got) != 1 || got[0] != live {
		t.Errorf("listed %v, want only the live pairing %s", got, live)
	}
}

func TestPairingOfOneUserIsHiddenFromAnother(t *testing.T) {
	owner := newMember(t)
	id := newPairing(t, owner.another(t, "new"))
	other := newMember(t)

	wantProblem(t, "another user reads", call(t, "GET", "/v2/pairings/"+id, other.access, nil), http.StatusNotFound)
	wantProblem(t, "another user sends old_public", sendMessage(t, other, id, "old_public", []byte("o")), http.StatusNotFound)
	if got := listPairingIDs(t, other); len(got) != 0 {
		t.Errorf("another user lists %v", got)
	}
	if got := readPairing(t, owner, id); got.OldPublic != nil {
		t.Errorf("another user's message was stored: %+v", got)
	}
	wantProblem(t, "pairing id is not a uuid", call(t, "GET", "/v2/pairings/nope", owner.access, nil), http.StatusBadRequest)
	wantProblem(t, "unknown pairing", call(t, "GET", "/v2/pairings/"+uuid.NewString(), owner.access, nil), http.StatusNotFound)
}

// pairingFixture is a user with n devices that each opened a pairing, in the order opened.
func pairingFixture(t *testing.T, n int) (member, []string) {
	t.Helper()
	m := newMember(t)
	ids := []string{newPairing(t, m)}
	for i := 1; i < n; i++ {
		ids = append(ids, newPairing(t, m.another(t, fmt.Sprintf("device %d", i))))
	}
	return m, ids
}

func TestPairingPagesHoldEveryPairingOnceOldestFirst(t *testing.T) {
	m, want := pairingFixture(t, 7)
	var got []string
	query := url.Values{"page_size": {"3"}}
	for pages := 1; ; pages++ {
		if pages > len(want) {
			t.Fatal("the pages do not end")
		}
		page := readJSON[api.PairingList](t, must(t, "page", call(t, "GET", "/v2/pairings?"+query.Encode(), m.access, nil), http.StatusOK))
		if len(page.Pairings) > 3 {
			t.Errorf("page %d holds %d pairings, more than page_size 3", pages, len(page.Pairings))
		}
		for _, p := range page.Pairings {
			got = append(got, p.Id.String())
		}
		holdsLast := len(got) >= len(want)
		if (page.NextPageToken == nil) != holdsLast {
			t.Fatalf("page %d: next_page_token %v with %d of %d pairings read, want it absent only on the last page", pages, page.NextPageToken, len(got), len(want))
		}
		if page.NextPageToken == nil {
			break
		}
		query.Set("page_token", *page.NextPageToken)
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("the pages hold %v, want %v", got, want)
	}
}

func TestPairingPageSizeDefaultsTo50AndIsLoweredTo100(t *testing.T) {
	m, ids := pairingFixture(t, 101)
	for query, want := range map[string]int{"": 50, "?page_size=0": 50, "?page_size=101": 100, "?page_size=2147483647": 100} {
		page := readJSON[api.PairingList](t, must(t, query, call(t, "GET", "/v2/pairings"+query, m.access, nil), http.StatusOK))
		if len(page.Pairings) != want || page.NextPageToken == nil {
			t.Errorf("%q: %d pairings, next_page_token %v, want %d and a token", query, len(page.Pairings), page.NextPageToken, want)
			continue
		}
		for i, p := range page.Pairings {
			if p.Id.String() != ids[i] {
				t.Errorf("%q: pairing %d is %s, want %s", query, i, p.Id, ids[i])
				break
			}
		}
	}
}

func TestPairingPageRequestsThatDoNotHoldAreInvalid(t *testing.T) {
	m, _ := pairingFixture(t, 2)
	page := readJSON[api.PairingList](t, must(t, "first page", call(t, "GET", "/v2/pairings?page_size=1", m.access, nil), http.StatusOK))
	if page.NextPageToken == nil {
		t.Fatal("the first of two pages has no next_page_token")
	}
	stranger, _ := pairingFixture(t, 2)
	devicesPage := readJSON[api.DeviceList](t, must(t, "devices page", call(t, "GET", "/v2/devices?page_size=1", m.access, nil), http.StatusOK))
	if devicesPage.NextPageToken == nil {
		t.Fatal("the first of two device pages has no next_page_token")
	}
	for name, c := range map[string]struct {
		query string
		as    member
	}{
		"negative page_size":              {"?page_size=-1", m},
		"page_size not a number":          {"?page_size=x", m},
		"garbage page_token":              {"?page_token=garbage", m},
		"another user's page_token":       {"?" + url.Values{"page_token": {*page.NextPageToken}}.Encode(), stranger},
		"a page_token of GET /v2/devices": {"?" + url.Values{"page_token": {*devicesPage.NextPageToken}}.Encode(), m},
	} {
		wantProblem(t, name, call(t, "GET", "/v2/pairings"+c.query, c.as.access, nil), http.StatusBadRequest)
	}
}
