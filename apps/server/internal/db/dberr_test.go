package db_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func cancelled() context.Context {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	return ctx
}

func TestMapErrorGivesEachDriverErrorItsKind(t *testing.T) {
	t.Parallel()
	live := context.Background()
	pg := func(code string) error { return &pgconn.PgError{Code: code, ConstraintName: "some_constraint"} }
	for _, c := range []struct {
		name string
		ctx  context.Context
		err  error
		want errs.Kind
	}{
		{"unique violation", live, pg("23505"), errs.Conflict},
		{"unmapped constraint", live, pg("23503"), errs.Internal},
		{"serialization failure", live, pg("40001"), errs.Unavailable},
		{"deadlock", live, pg("40P01"), errs.Unavailable},
		{"too many connections", live, pg("53300"), errs.Unavailable},
		{"admin shutdown", live, pg("57P01"), errs.Unavailable},
		{"cannot connect now", live, pg("57P03"), errs.Unavailable},
		{"connection exception", live, pg("08006"), errs.Unavailable},
		{"query canceled, live context", live, pg("57014"), errs.Unavailable},
		{"query canceled, cancelled context", cancelled(), pg("57014"), errs.Cancelled},
		{"no row", live, pgx.ErrNoRows, errs.NotFound},
		{"other code", live, pg("42P01"), errs.Internal},
		{"no driver error", live, errors.New("boom"), errs.Internal},
		{"already kinded", live, fmt.Errorf("in tx: %w", errs.New(errs.Forbidden, "set message", "wrong side")), errs.Forbidden},
	} {
		got := db.MapError(c.ctx, "do thing", c.err)
		if k := errs.KindOf(got); k != c.want {
			t.Errorf("%s: kind %d, want %d", c.name, k, c.want)
		}
	}
	if db.MapError(live, "do thing", nil) != nil {
		t.Error("nil error: got an error, want nil")
	}
}

// An Internal error carries the driver's text but not its type, so no caller can unwrap to it.
func TestMapErrorHidesTheDriverTypeOfAnInternalError(t *testing.T) {
	t.Parallel()
	got := db.MapError(context.Background(), "do thing", &pgconn.PgError{Code: "42P01", Message: "relation does not exist"})
	if _, ok := errors.AsType[*pgconn.PgError](got); ok {
		t.Error("the mapped error unwraps to *pgconn.PgError")
	}
	if !strings.Contains(got.Error(), "relation does not exist") {
		t.Errorf("error text %q lost the driver message", got)
	}
}

func TestMapErrorOnARealDatabase(t *testing.T) {
	t.Parallel()
	store, url := openStore(t)
	ctx := context.Background()

	if _, err := store.Queries().Key(ctx, uuid.MustParse("01900000-0000-7000-8000-000000000001")); errs.KindOf(err) != errs.NotFound {
		t.Errorf("missing id: kind %d, want NotFound (%v)", errs.KindOf(err), err)
	}

	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	insert := `INSERT INTO users (id) VALUES ('01900000-0000-7000-8000-000000000002')`
	if _, err := conn.Exec(ctx, insert); err != nil {
		t.Fatal(err)
	}
	_, err = conn.Exec(ctx, insert)
	if k := errs.KindOf(db.MapError(ctx, "insert user", err)); k != errs.Conflict {
		t.Errorf("duplicate insert: kind %d, want Conflict (%v)", k, err)
	}

	if err := conn.Close(ctx); err != nil {
		t.Fatal(err)
	}
	_, err = conn.Exec(ctx, "SELECT 1")
	if k := errs.KindOf(db.MapError(ctx, "select", err)); k != errs.Unavailable {
		t.Errorf("closed connection, live context: kind %d, want Unavailable (%v)", k, err)
	}
	if k := errs.KindOf(db.MapError(cancelled(), "select", err)); k != errs.Cancelled {
		t.Errorf("closed connection, cancelled context: kind %d, want Cancelled (%v)", k, err)
	}
}
