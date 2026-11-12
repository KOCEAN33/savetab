package api_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"
)

type snapshot struct {
	Seq  int64  `json:"seq"`
	Data []byte `json:"data"`
}

func pushN(t *testing.T, d device, from, to int) {
	t.Helper()
	for i := from; i <= to; i++ {
		push(t, d, op{opID(i), []byte{byte(i)}})
	}
}

// storedOps counts the user's op rows. No endpoint shows a row below the snapshot, so only the
// table tells a dropped op from a hidden one.
func storedOps(t *testing.T, userID string) int {
	t.Helper()
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	var n int
	if err := conn.QueryRow(ctx, `SELECT count(*) FROM ops WHERE user_id = $1`, userID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestSnapshotDropsOlderOpsAndStaleAfterGets409(t *testing.T) {
	user, otherUser := newUser(t), newUser(t)
	a, b := newDevice(t, user), newDevice(t, user)
	other := newDevice(t, otherUser)
	pushN(t, a, 1, 5)
	pushN(t, other, 1, 5)

	expect(t, "get before any put", request(t, "GET", "/v1/snapshot", a.token, nil), http.StatusNotFound, "no_snapshot")
	expect(t, "put", request(t, "PUT", "/v1/snapshot", a.token, snapshot{3, []byte("state")}), http.StatusNoContent, "")

	res := request(t, "GET", "/v1/snapshot", b.token, nil)
	expect(t, "get", res, http.StatusOK, "")
	if got := decode[snapshot](t, res); got.Seq != 3 || string(got.Data) != "state" {
		t.Errorf("snapshot = seq %d %q, want seq 3 %q", got.Seq, got.Data, "state")
	}

	if n := storedOps(t, user); n != 2 {
		t.Errorf("%d ops stored after a snapshot at seq 3 of 5, want 2", n)
	}
	for _, query := range []string{"", "?after=0", "?after=2"} {
		expect(t, "pull "+query, request(t, "GET", "/v1/ops"+query, b.token, nil), http.StatusConflict, "snapshot_required")
	}
	got := pull(t, b, "?after=3")
	if len(got.Ops) != 2 || got.Ops[0].Seq != 4 || got.Ops[1].Seq != 5 {
		t.Errorf("pull after=3: got %+v, want seq 4 and 5", got.Ops)
	}

	push(t, b, op{opID(6), []byte("six")})
	if got := pull(t, a, "?after=5"); len(got.Ops) != 1 || got.Ops[0].Seq != 6 {
		t.Errorf("push after a snapshot: got %+v, want one op at seq 6", got.Ops)
	}

	expect(t, "get by another user", request(t, "GET", "/v1/snapshot", other.token, nil), http.StatusNotFound, "no_snapshot")
	if got := pull(t, other, ""); len(got.Ops) != 5 {
		t.Errorf("another user's log has %d ops after the snapshot, want 5", len(got.Ops))
	}
}

func TestSnapshotSeqMustStayInsideTheLog(t *testing.T) {
	d := newDevice(t, newUser(t))
	put := func(seq int64, data string) *http.Response {
		return request(t, "PUT", "/v1/snapshot", d.token, snapshot{seq, []byte(data)})
	}
	expect(t, "seq 1 on an empty log", put(1, "x"), http.StatusConflict, "snapshot_ahead")
	pushN(t, d, 1, 5)

	expect(t, "seq 6 of 5", put(6, "ahead"), http.StatusConflict, "snapshot_ahead")
	expect(t, "seq 4", put(4, "four"), http.StatusNoContent, "")
	expect(t, "seq 3 below the snapshot at 4", put(3, "three"), http.StatusConflict, "stale_snapshot")
	if got := decode[snapshot](t, request(t, "GET", "/v1/snapshot", d.token, nil)); got.Seq != 4 || string(got.Data) != "four" {
		t.Errorf("snapshot after rejected puts = seq %d %q, want seq 4 %q", got.Seq, got.Data, "four")
	}
	if got := pull(t, d, "?after=4"); len(got.Ops) != 1 || got.Ops[0].Seq != 5 {
		t.Errorf("pull after rejected puts: got %+v, want seq 5", got.Ops)
	}

	expect(t, "seq 5", put(5, "five"), http.StatusNoContent, "")
	if got := decode[snapshot](t, request(t, "GET", "/v1/snapshot", d.token, nil)); got.Seq != 5 || string(got.Data) != "five" {
		t.Errorf("snapshot = seq %d %q, want seq 5 %q", got.Seq, got.Data, "five")
	}
	expect(t, "pull after=4", request(t, "GET", "/v1/ops?after=4", d.token, nil), http.StatusConflict, "snapshot_required")
}

func TestMalformedSnapshotGets400(t *testing.T) {
	d := newDevice(t, newUser(t))
	pushN(t, d, 1, 2)
	for name, body := range map[string]snapshot{
		"seq 0":      {0, []byte("x")},
		"seq -1":     {-1, []byte("x")},
		"empty data": {1, nil},
	} {
		expect(t, name, request(t, "PUT", "/v1/snapshot", d.token, body), http.StatusBadRequest, "bad_request")
	}
	if got := pull(t, d, ""); len(got.Ops) != 2 {
		t.Errorf("a rejected snapshot left %d ops, want 2", len(got.Ops))
	}
}
