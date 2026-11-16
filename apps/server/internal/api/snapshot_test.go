package api_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/KOCEAN33/savetab/apps/server/internal/api"
)

func putSnapshot(t *testing.T, s *server, m member, seq int64, data string) reply {
	t.Helper()
	return call(t, s, "PUT", "/v2/snapshot", m.access, api.Snapshot{Seq: seq, Data: []byte(data)})
}

func TestSnapshotReplacesTheOpsItHolds(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	m := newMember(t, s)
	wantProblem(t, "read before any snapshot", call(t, s, "GET", "/v2/snapshot", m.access, nil), http.StatusNotFound)
	pushMany(t, s, m, 3)
	ops := listOps(t, s, m, "").Ops
	if len(ops) != 3 {
		t.Fatalf("listed %d ops, want 3", len(ops))
	}

	wantStatus(t, "snapshot through the second op", putSnapshot(t, s, m, ops[1].Seq, "through 2"), http.StatusNoContent)
	got := readJSON[api.Snapshot](t, must(t, "read", call(t, s, "GET", "/v2/snapshot", m.another(t, s, "second").access, nil), http.StatusOK))
	if got.Seq != ops[1].Seq || string(got.Data) != "through 2" {
		t.Errorf("read seq %d %q, want seq %d %q", got.Seq, got.Data, ops[1].Seq, "through 2")
	}

	for _, after := range []int64{0, ops[0].Seq} {
		wantProblem(t, fmt.Sprintf("list after %d, which the snapshot replaced", after), call(t, s, "GET", fmt.Sprintf("/v2/ops?after=%d", after), m.access, nil), http.StatusConflict)
	}
	if rest := listOps(t, s, m, fmt.Sprintf("?after=%d", ops[1].Seq)).Ops; len(rest) != 1 || rest[0].Id != ops[2].Id {
		t.Errorf("after the snapshot's seq listed %+v, want the third op", rest)
	}
}

func TestSnapshotSeqMustBeInsideTheLogAndAfterTheStoredOne(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	m := newMember(t, s)
	wantProblem(t, "seq 1 of an empty log", putSnapshot(t, s, m, 1, "x"), http.StatusBadRequest)
	pushMany(t, s, m, 3)
	ops := listOps(t, s, m, "").Ops
	if len(ops) != 3 {
		t.Fatalf("listed %d ops, want 3", len(ops))
	}
	last := ops[2].Seq

	wantProblem(t, "seq past the end of the log", putSnapshot(t, s, m, last+1, "ahead"), http.StatusBadRequest)
	must(t, "seq of the second op", putSnapshot(t, s, m, ops[1].Seq, "through 2"), http.StatusNoContent)
	wantProblem(t, "the same seq again", putSnapshot(t, s, m, ops[1].Seq, "same"), http.StatusConflict)
	wantProblem(t, "an earlier seq", putSnapshot(t, s, m, ops[0].Seq, "older"), http.StatusConflict)
	if got := readJSON[api.Snapshot](t, must(t, "read", call(t, s, "GET", "/v2/snapshot", m.access, nil), http.StatusOK)); got.Seq != ops[1].Seq || string(got.Data) != "through 2" {
		t.Errorf("after refused puts read seq %d %q, want seq %d %q", got.Seq, got.Data, ops[1].Seq, "through 2")
	}
	wantStatus(t, "the last seq", putSnapshot(t, s, m, last, "through 3"), http.StatusNoContent)
	if got := readJSON[api.Snapshot](t, must(t, "read", call(t, s, "GET", "/v2/snapshot", m.access, nil), http.StatusOK)); got.Seq != last || string(got.Data) != "through 3" {
		t.Errorf("read seq %d %q, want seq %d %q", got.Seq, got.Data, last, "through 3")
	}
}

func TestSnapshotOfOneUserIsHiddenFromAnother(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	owner, other := newMember(t, s), newMember(t, s)
	pushMany(t, s, owner, 1)
	ops := listOps(t, s, owner, "").Ops
	if len(ops) != 1 {
		t.Fatalf("listed %d ops, want 1", len(ops))
	}
	must(t, "owner stores", putSnapshot(t, s, owner, ops[0].Seq, "owner's"), http.StatusNoContent)
	wantProblem(t, "another user reads", call(t, s, "GET", "/v2/snapshot", other.access, nil), http.StatusNotFound)
	wantProblem(t, "another user's log is empty", putSnapshot(t, s, other, ops[0].Seq, "other's"), http.StatusBadRequest)
}

func TestMalformedSnapshotIsInvalid(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	m := newMember(t, s)
	pushMany(t, s, m, 1)
	for name, body := range map[string]any{
		"seq 0":      map[string]any{"seq": 0, "data": []byte("x")},
		"no seq":     map[string]any{"data": []byte("x")},
		"empty data": map[string]any{"seq": 1, "data": ""},
		"no data":    map[string]any{"seq": 1},
	} {
		wantProblem(t, name, call(t, s, "PUT", "/v2/snapshot", m.access, body), http.StatusBadRequest)
	}
	wantProblem(t, "read after refused puts", call(t, s, "GET", "/v2/snapshot", m.access, nil), http.StatusNotFound)
}
