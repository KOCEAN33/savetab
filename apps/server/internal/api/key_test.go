package api_test

import (
	"bytes"
	"fmt"
	"net/http"
	"sync"
	"testing"
)

type blob struct {
	Data []byte `json:"data"`
}

func TestKeyIsSetOnceAndReadByAnotherDevice(t *testing.T) {
	user := newUser(t)
	a, b := newDevice(t, user), newDevice(t, user)
	other := newDevice(t, newUser(t))

	expect(t, "get before any put", request(t, "GET", "/v1/key", a.token, nil), http.StatusNotFound, "no_key")
	expect(t, "first put", request(t, "PUT", "/v1/key", a.token, blob{[]byte("wrapped")}), http.StatusNoContent, "")
	expect(t, "second put", request(t, "PUT", "/v1/key", b.token, blob{[]byte("replaced")}), http.StatusConflict, "key_exists")

	res := request(t, "GET", "/v1/key", b.token, nil)
	expect(t, "get", res, http.StatusOK, "")
	if got := decode[blob](t, res); string(got.Data) != "wrapped" {
		t.Errorf("key = %q, want the first put %q", got.Data, "wrapped")
	}
	expect(t, "get by another user", request(t, "GET", "/v1/key", other.token, nil), http.StatusNotFound, "no_key")
}

func TestConcurrentKeyPutsStoreOne(t *testing.T) {
	user := newUser(t)
	const devices = 8
	stored := make([]bool, devices)
	var wg sync.WaitGroup
	for i := range devices {
		d := newDevice(t, user)
		wg.Add(1)
		go func() {
			defer wg.Done()
			res := request(t, "PUT", "/v1/key", d.token, blob{fmt.Appendf(nil, "key-%d", i)})
			switch res.StatusCode {
			case http.StatusNoContent:
				stored[i] = true
			case http.StatusConflict:
			default:
				t.Errorf("put %d: status %d, want 204 or 409", i, res.StatusCode)
			}
		}()
	}
	wg.Wait()

	winner := -1
	for i, ok := range stored {
		if !ok {
			continue
		}
		if winner >= 0 {
			t.Fatalf("puts %d and %d both answered 204", winner, i)
		}
		winner = i
	}
	if winner < 0 {
		t.Fatal("no put answered 204")
	}
	got := decode[blob](t, request(t, "GET", "/v1/key", newDevice(t, user).token, nil))
	if want := fmt.Sprintf("key-%d", winner); string(got.Data) != want {
		t.Errorf("key = %q, want %q from the put that answered 204", got.Data, want)
	}
}

func TestMalformedKeyGets400(t *testing.T) {
	d := newDevice(t, newUser(t))
	for name, data := range map[string][]byte{
		"empty data":       nil,
		"over 1,024 bytes": bytes.Repeat([]byte("x"), 1025),
	} {
		expect(t, name, request(t, "PUT", "/v1/key", d.token, blob{data}), http.StatusBadRequest, "bad_request")
	}
	expect(t, "get after rejected puts", request(t, "GET", "/v1/key", d.token, nil), http.StatusNotFound, "no_key")
}
