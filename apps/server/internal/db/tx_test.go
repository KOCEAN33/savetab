package db_test

import (
	"context"
	"testing"

	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/testdb"
	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// openStore gives the test a migrated database of its own and returns the store and its URL.
func openStore(t *testing.T) (*db.Store, string) {
	t.Helper()
	url, stop, err := testdb.Start()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(stop)
	ctx := context.Background()
	store, err := db.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.Close)
	if err := store.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	return store, url
}

// serializationFailure is a 40001 as a db function returns it, through the mapping function.
func serializationFailure(ctx context.Context) error {
	return db.MapError(ctx, "update", &pgconn.PgError{Code: pgerrcode.SerializationFailure})
}

func TestInTxRerunsTheClosureAfterASerializationFailure(t *testing.T) {
	store, _ := openStore(t)
	ctx := context.Background()
	const id = "01900000-0000-7000-8000-000000000001"
	runs := 0
	err := store.InTx(ctx, pgx.TxOptions{}, func(tx pgx.Tx) error {
		runs++
		if _, err := tx.Exec(ctx, `INSERT INTO users (id) VALUES ($1)`, id); err != nil {
			return err
		}
		if runs == 1 {
			return serializationFailure(ctx)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("InTx: %v", err)
	}
	if runs != 2 {
		t.Errorf("closure ran %d times, want 2", runs)
	}
	var n int
	if err := store.InTx(ctx, pgx.TxOptions{}, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM users WHERE id = $1`, id).Scan(&n)
	}); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("found %d rows of the user, want the second run's one", n)
	}
}

func TestInTxGivesUpAfterItsAttempts(t *testing.T) {
	store, _ := openStore(t)
	ctx := context.Background()
	runs := 0
	err := store.InTx(ctx, pgx.TxOptions{}, func(tx pgx.Tx) error {
		runs++
		return serializationFailure(ctx)
	})
	if errs.KindOf(err) != errs.Unavailable {
		t.Errorf("error %v has kind %d, want Unavailable", err, errs.KindOf(err))
	}
	if runs < 2 || runs > 10 {
		t.Errorf("closure ran %d times, want a few retries and then the error", runs)
	}
}

func TestInTxDoesNotRetryOtherErrors(t *testing.T) {
	store, _ := openStore(t)
	ctx := context.Background()
	runs := 0
	_ = store.InTx(ctx, pgx.TxOptions{}, func(tx pgx.Tx) error {
		runs++
		return errs.New(errs.Conflict, "update", "taken")
	})
	if runs != 1 {
		t.Errorf("closure ran %d times, want 1", runs)
	}
}
