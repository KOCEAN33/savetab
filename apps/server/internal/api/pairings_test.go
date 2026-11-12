package api_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"net/http"
	"testing"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/store"
)

type pairing struct {
	ID            string `json:"id"`
	NewDeviceID   string `json:"newDeviceId"`
	NewDeviceName string `json:"newDeviceName"`
	Commitment    []byte `json:"commitment"`
	OldPublic     []byte `json:"oldPublic"`
	NewPublic     []byte `json:"newPublic"`
	WrappedKey    []byte `json:"wrappedKey"`
	ExpiresAt     int64  `json:"expiresAt"`
}

type pairingList struct {
	Pairings []pairing `json:"pairings"`
}

func commitmentOf(public string) []byte {
	h := sha256.Sum256([]byte(public))
	return h[:]
}

func startPairing(t *testing.T, d device, commitment []byte) pairing {
	t.Helper()
	res := request(t, "POST", "/v1/pairings", d.token, map[string][]byte{"commitment": commitment})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("start pairing: status %d, want 201", res.StatusCode)
	}
	return decode[pairing](t, res)
}

func getPairing(t *testing.T, d device, id string) pairing {
	t.Helper()
	res := request(t, "GET", "/v1/pairings/"+id, d.token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("get pairing: status %d, want 200", res.StatusCode)
	}
	return decode[pairing](t, res)
}

func listPairings(t *testing.T, d device) []pairing {
	t.Helper()
	res := request(t, "GET", "/v1/pairings", d.token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list pairings: status %d, want 200", res.StatusCode)
	}
	return decode[pairingList](t, res).Pairings
}

func sendPairing(t *testing.T, d device, id, field, value string) *http.Response {
	t.Helper()
	return request(t, "PUT", "/v1/pairings/"+id, d.token, map[string][]byte{field: []byte(value)})
}

func TestPairingRelaysTheExchangeBetweenTwoDevices(t *testing.T) {
	user := newUser(t)
	signedIn, joining := newDevice(t, user), newDevice(t, user)
	commitment := commitmentOf("new-public")

	before := time.Now()
	started := startPairing(t, joining, commitment)
	after := time.Now()
	// The database stamps the time, so allow for its clock differing from this machine's.
	low, high := before.Add(5*time.Minute-5*time.Second).UnixMilli(), after.Add(5*time.Minute+5*time.Second).UnixMilli()
	if started.ExpiresAt < low || started.ExpiresAt > high {
		t.Errorf("expiresAt %d is not 5 minutes ahead, want within [%d, %d]", started.ExpiresAt, low, high)
	}

	open := listPairings(t, signedIn)
	if len(open) != 1 || open[0].ID != started.ID || open[0].NewDeviceID != joining.id || open[0].NewDeviceName != "test" {
		t.Fatalf("list = %+v, want the one pairing %s of device %s named %q", open, started.ID, joining.id, "test")
	}
	if got := getPairing(t, signedIn, started.ID); !bytes.Equal(got.Commitment, commitment) || got.OldPublic != nil || got.NewPublic != nil || got.WrappedKey != nil {
		t.Errorf("new pairing = %+v, want the commitment and no other message", got)
	}

	expect(t, "old public", sendPairing(t, signedIn, started.ID, "oldPublic", "old-public"), http.StatusNoContent, "")
	if got := getPairing(t, joining, started.ID); string(got.OldPublic) != "old-public" {
		t.Errorf("oldPublic = %q, want %q", got.OldPublic, "old-public")
	}
	expect(t, "new public", sendPairing(t, joining, started.ID, "newPublic", "new-public"), http.StatusNoContent, "")
	if got := getPairing(t, signedIn, started.ID); string(got.NewPublic) != "new-public" || !bytes.Equal(got.Commitment, commitment) {
		t.Errorf("newPublic = %q with commitment %x, want %q with %x", got.NewPublic, got.Commitment, "new-public", commitment)
	}
	expect(t, "wrapped key", sendPairing(t, signedIn, started.ID, "wrappedKey", "wrapped"), http.StatusNoContent, "")
	if got := getPairing(t, joining, started.ID); string(got.WrappedKey) != "wrapped" {
		t.Errorf("wrappedKey = %q, want %q", got.WrappedKey, "wrapped")
	}
}

func TestPairingMessagesAreSetOnceInOrderByTheRightSide(t *testing.T) {
	user := newUser(t)
	signedIn, joining := newDevice(t, user), newDevice(t, user)
	id := startPairing(t, joining, commitmentOf("new-public")).ID
	send := func(d device, field, value string) *http.Response { return sendPairing(t, d, id, field, value) }

	expect(t, "old public from the new device", send(joining, "oldPublic", "x"), http.StatusForbidden, "forbidden")
	expect(t, "new public before old public", send(joining, "newPublic", "x"), http.StatusConflict, "pairing_conflict")
	expect(t, "wrapped key before the public keys", send(signedIn, "wrappedKey", "x"), http.StatusConflict, "pairing_conflict")

	expect(t, "old public", send(signedIn, "oldPublic", "old-public"), http.StatusNoContent, "")
	expect(t, "old public again", send(signedIn, "oldPublic", "swapped"), http.StatusConflict, "pairing_conflict")
	expect(t, "new public from the signed-in device", send(signedIn, "newPublic", "x"), http.StatusForbidden, "forbidden")
	expect(t, "wrapped key before new public", send(signedIn, "wrappedKey", "x"), http.StatusConflict, "pairing_conflict")

	expect(t, "new public", send(joining, "newPublic", "new-public"), http.StatusNoContent, "")
	expect(t, "new public again", send(joining, "newPublic", "swapped"), http.StatusConflict, "pairing_conflict")
	expect(t, "wrapped key from the new device", send(joining, "wrappedKey", "x"), http.StatusForbidden, "forbidden")

	expect(t, "wrapped key", send(signedIn, "wrappedKey", "wrapped"), http.StatusNoContent, "")
	expect(t, "wrapped key again", send(signedIn, "wrappedKey", "swapped"), http.StatusConflict, "pairing_conflict")

	got := getPairing(t, joining, id)
	if string(got.OldPublic) != "old-public" || string(got.NewPublic) != "new-public" || string(got.WrappedKey) != "wrapped" {
		t.Errorf("after rejected messages = %q, %q, %q, want the first value of each", got.OldPublic, got.NewPublic, got.WrappedKey)
	}
}

func TestPairingExpires(t *testing.T) {
	user := newUser(t)
	signedIn, joining := newDevice(t, user), newDevice(t, user)
	expired, err := db.CreatePairing(context.Background(), store.Caller{DeviceID: joining.id, UserID: user}, commitmentOf("x"), -time.Second)
	if err != nil {
		t.Fatal(err)
	}

	expect(t, "get", request(t, "GET", "/v1/pairings/"+expired.ID, signedIn.token, nil), http.StatusNotFound, "not_found")
	expect(t, "put", sendPairing(t, signedIn, expired.ID, "oldPublic", "old-public"), http.StatusNotFound, "not_found")
	if open := listPairings(t, signedIn); len(open) != 0 {
		t.Errorf("list = %+v, want no pairing", open)
	}
}

func TestPairingIsHiddenFromOtherUsers(t *testing.T) {
	user := newUser(t)
	joining := newDevice(t, user)
	stranger := newDevice(t, newUser(t))
	id := startPairing(t, joining, commitmentOf("x")).ID

	expect(t, "get", request(t, "GET", "/v1/pairings/"+id, stranger.token, nil), http.StatusNotFound, "not_found")
	expect(t, "put", sendPairing(t, stranger, id, "oldPublic", "theirs"), http.StatusNotFound, "not_found")
	if open := listPairings(t, stranger); len(open) != 0 {
		t.Errorf("another user's list = %+v, want no pairing", open)
	}
	if got := getPairing(t, joining, id); got.OldPublic != nil {
		t.Errorf("oldPublic = %q after another user's put, want none", got.OldPublic)
	}
}

func TestStartingAgainReplacesTheDevicesOpenPairing(t *testing.T) {
	user := newUser(t)
	signedIn, joining, alsoJoining := newDevice(t, user), newDevice(t, user), newDevice(t, user)
	first := startPairing(t, joining, commitmentOf("first"))
	others := startPairing(t, alsoJoining, commitmentOf("other device"))
	second := startPairing(t, joining, commitmentOf("second"))

	expect(t, "get the replaced pairing", request(t, "GET", "/v1/pairings/"+first.ID, signedIn.token, nil), http.StatusNotFound, "not_found")
	open := map[string]bool{}
	for _, p := range listPairings(t, signedIn) {
		open[p.ID] = true
	}
	if len(open) != 2 || !open[others.ID] || !open[second.ID] {
		t.Errorf("open pairings = %v, want %s and %s", open, others.ID, second.ID)
	}
}

func TestMalformedPairingRequestsGet400(t *testing.T) {
	user := newUser(t)
	signedIn, joining := newDevice(t, user), newDevice(t, user)
	for name, commitment := range map[string][]byte{
		"no commitment":      nil,
		"31-byte commitment": bytes.Repeat([]byte("x"), 31),
		"33-byte commitment": bytes.Repeat([]byte("x"), 33),
	} {
		expect(t, name, request(t, "POST", "/v1/pairings", joining.token, map[string][]byte{"commitment": commitment}), http.StatusBadRequest, "bad_request")
	}
	if open := listPairings(t, signedIn); len(open) != 0 {
		t.Fatalf("rejected starts left %d pairings", len(open))
	}

	id := startPairing(t, joining, commitmentOf("x")).ID
	for name, body := range map[string]map[string][]byte{
		"no message":       {},
		"two messages":     {"oldPublic": []byte("a"), "wrappedKey": []byte("b")},
		"over 1,024 bytes": {"oldPublic": bytes.Repeat([]byte("x"), 1025)},
	} {
		expect(t, name, request(t, "PUT", "/v1/pairings/"+id, signedIn.token, body), http.StatusBadRequest, "bad_request")
	}
	if got := getPairing(t, signedIn, id); got.OldPublic != nil || got.WrappedKey != nil {
		t.Errorf("rejected messages were stored: %+v", got)
	}
	expect(t, "id is not a uuid", request(t, "GET", "/v1/pairings/nope", signedIn.token, nil), http.StatusNotFound, "not_found")
}
