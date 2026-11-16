package api_test

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/KOCEAN33/savetab/apps/server/internal/api"
)

type opIn struct {
	ID   string `json:"id"`
	Data []byte `json:"data"`
}

func pushOps(t *testing.T, s *server, m member, ops ...opIn) reply {
	t.Helper()
	return call(t, s, "POST", "/v2/ops", m.access, map[string]any{"ops": ops})
}

func listOps(t *testing.T, s *server, m member, query string) api.OpList {
	t.Helper()
	return readJSON[api.OpList](t, must(t, "list ops"+query, call(t, s, "GET", "/v2/ops"+query, m.access, nil), http.StatusOK))
}

// pushMany pushes n ops in pushes of at most 500, the contract's maxItems.
func pushMany(t *testing.T, s *server, m member, n int) {
	t.Helper()
	for n > 0 {
		batch := make([]opIn, min(n, 500))
		for i := range batch {
			batch[i] = opIn{uuid.NewString(), []byte("x")}
		}
		must(t, "push", pushOps(t, s, m, batch...), http.StatusOK)
		n -= len(batch)
	}
}

func TestPushedOpsAreListedOldestFirstWithTheirDevice(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	a := newMember(t, s)
	b := a.another(t, s, "second")
	ids := []string{uuid.NewString(), uuid.NewString(), uuid.NewString()}
	before := time.Now()
	r := pushOps(t, s, a, opIn{ids[0], []byte("first")}, opIn{ids[1], []byte("second")})
	if wantStatus(t, "push", r, http.StatusOK) {
		if got := readJSON[api.PushOpsResponse](t, r).ServerTime; got.Before(before.Add(-5*time.Second)) || got.After(time.Now().Add(5*time.Second)) {
			t.Errorf("server_time %v is not within 5 s of now", got)
		}
	}
	must(t, "push", pushOps(t, s, b, opIn{ids[2], []byte("third")}), http.StatusOK)
	after := time.Now()

	got := listOps(t, s, a.another(t, s, "third"), "")
	want := []struct{ id, device, data string }{{ids[0], a.device, "first"}, {ids[1], a.device, "second"}, {ids[2], b.device, "third"}}
	if len(got.Ops) != len(want) {
		t.Fatalf("listed %d ops, want %d", len(got.Ops), len(want))
	}
	for i, w := range want {
		g := got.Ops[i]
		if g.Id.String() != w.id || g.DeviceId.String() != w.device || string(g.Data) != w.data {
			t.Errorf("op %d = %+v, want id %s device %s data %q", i, g, w.id, w.device, w.data)
		}
		if i > 0 && g.Seq <= got.Ops[i-1].Seq {
			t.Errorf("op %d has seq %d after seq %d, want oldest first", i, g.Seq, got.Ops[i-1].Seq)
		}
		// The database stamps the time, so allow for its clock differing from this machine's.
		if g.ReceivedAt.Before(before.Add(-5*time.Second)) || g.ReceivedAt.After(after.Add(5*time.Second)) {
			t.Errorf("op %d received_at %v is not within 5 s of the push", i, g.ReceivedAt)
		}
	}
	if got.More {
		t.Error("more = true, want false")
	}
	rest := listOps(t, s, a, fmt.Sprintf("?after=%d", got.Ops[0].Seq))
	if len(rest.Ops) != 2 || rest.Ops[0].Id.String() != ids[1] || rest.Ops[1].Id.String() != ids[2] {
		t.Errorf("after the first seq listed %+v, want the second and third ops", rest.Ops)
	}
}

func TestRepeatedOpIDIsSkippedAndThePushSucceeds(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	m := newMember(t, s)
	one, two := uuid.NewString(), uuid.NewString()
	must(t, "first push", pushOps(t, s, m, opIn{one, []byte("one")}), http.StatusOK)
	wantStatus(t, "push repeating an op id", pushOps(t, s, m, opIn{one, []byte("one again")}, opIn{two, []byte("two")}), http.StatusOK)

	got := listOps(t, s, m, "").Ops
	if len(got) != 2 || got[0].Id.String() != one || string(got[0].Data) != "one" || got[1].Id.String() != two || string(got[1].Data) != "two" {
		t.Errorf("listed %+v, want %q once, then %q", got, "one", "two")
	}
}

func TestOneUsersOpsAreNotListedToAnother(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	mine, theirs := newMember(t, s), newMember(t, s)
	id := uuid.NewString()
	must(t, "push mine", pushOps(t, s, mine, opIn{id, []byte("mine")}), http.StatusOK)
	must(t, "push theirs with the same op id", pushOps(t, s, theirs, opIn{id, []byte("theirs")}), http.StatusOK)

	if got := listOps(t, s, theirs, "").Ops; len(got) != 1 || string(got[0].Data) != "theirs" {
		t.Errorf("the other user listed %+v, want only their own op", got)
	}
	if got := listOps(t, s, mine, "").Ops; len(got) != 1 || string(got[0].Data) != "mine" {
		t.Errorf("the first user listed %+v, want only their own op", got)
	}
}

func TestOpsPageByAfterAndPageSize(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	m := newMember(t, s)
	pushMany(t, s, m, 5)
	all := listOps(t, s, m, "").Ops
	if len(all) != 5 {
		t.Fatalf("listed %d ops, want 5", len(all))
	}
	first := listOps(t, s, m, "?page_size=2")
	if len(first.Ops) != 2 || first.Ops[0].Id != all[0].Id || first.Ops[1].Id != all[1].Id || !first.More {
		t.Errorf("page_size=2: %d ops, more %v, want the first 2 and more", len(first.Ops), first.More)
	}
	next := listOps(t, s, m, fmt.Sprintf("?after=%d&page_size=2", first.Ops[1].Seq))
	if len(next.Ops) != 2 || next.Ops[0].Id != all[2].Id || next.Ops[1].Id != all[3].Id || !next.More {
		t.Errorf("the second page: %d ops, more %v, want the 3rd and 4th and more", len(next.Ops), next.More)
	}
	exact := listOps(t, s, m, fmt.Sprintf("?after=%d&page_size=2", all[2].Seq))
	if len(exact.Ops) != 2 || exact.Ops[1].Id != all[4].Id || exact.More {
		t.Errorf("the last two: %d ops, more %v, want 2 and no more", len(exact.Ops), exact.More)
	}
	if end := listOps(t, s, m, fmt.Sprintf("?after=%d", all[4].Seq)); len(end.Ops) != 0 || end.More {
		t.Errorf("after the last seq: %d ops, more %v, want none", len(end.Ops), end.More)
	}
}

func TestListingOpsRunsTheSameStatementsForAnyNumberOfOps(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	m := newMember(t, s)
	pushMany(t, s, m, 7)
	// One statement finds the token's session. The rest are one transaction: its begin, the
	// check against the snapshot, the ops, and its commit.
	wantQueryCount(t, s, "/v2/ops", m.access, 5)
	wantQueryCount(t, s, "/v2/ops?page_size=3", m.access, 5)
}

func TestOpsPageSizeDefaultsTo500AndIsLoweredTo500(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	m := newMember(t, s)
	pushMany(t, s, m, 501)
	for _, query := range []string{"", "?page_size=0", "?page_size=501", "?page_size=2147483647"} {
		got := listOps(t, s, m, query)
		if len(got.Ops) != 500 || !got.More {
			t.Errorf("%q: %d ops, more %v, want 500 and more", query, len(got.Ops), got.More)
		}
	}
}

func TestMalformedOpsRequestsAreInvalid(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	m := newMember(t, s)
	tooMany := make([]opIn, 501)
	for i := range tooMany {
		tooMany[i] = opIn{uuid.NewString(), []byte("x")}
	}
	for name, body := range map[string]any{
		"op id is not a uuid": map[string]any{"ops": []opIn{{"nope", []byte("x")}}},
		"empty data":          map[string]any{"ops": []opIn{{uuid.NewString(), []byte{}}}},
		"data is not base64":  map[string]any{"ops": []map[string]string{{"id": uuid.NewString(), "data": "not base64!"}}},
		"no ops":              map[string]any{},
		"501 ops":             map[string]any{"ops": tooMany},
	} {
		wantProblem(t, name, call(t, s, "POST", "/v2/ops", m.access, body), http.StatusBadRequest)
	}
	for _, query := range []string{"?after=-1", "?after=x", "?page_size=-1", "?page_size=x"} {
		wantProblem(t, query, call(t, s, "GET", "/v2/ops"+query, m.access, nil), http.StatusBadRequest)
	}
	if got := listOps(t, s, m, "").Ops; len(got) != 0 {
		t.Errorf("refused pushes stored %d ops", len(got))
	}
}
