package db_test

import (
	"context"
	"testing"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/testdb"
	"github.com/jackc/pgx/v5"
)

// emptyDatabase gives the test a database of its own with no schema.
func emptyDatabase(t *testing.T) string {
	t.Helper()
	return testdb.New(t,
		func() (string, error) { return "empty", nil },
		func(context.Context, string) error { return nil },
	)
}

func TestMigrateBuildsTheSchemaOnceAndKeepsItsRows(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store, err := db.Open(ctx, emptyDatabase(t), db.Options{MaxConns: 1, StatementTimeout: 5 * time.Second, IdleInTxTimeout: 10 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.Close)
	if err := store.Migrate(ctx); err != nil {
		t.Fatalf("Migrate on an empty database: %v", err)
	}
	const id = "01900000-0000-7000-8000-000000000002"
	if err := store.InTx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO users (id) VALUES ($1)`, id)
		return err
	}); err != nil {
		t.Fatalf("a row of the migrated schema: %v", err)
	}
	if err := store.Migrate(ctx); err != nil {
		t.Fatalf("Migrate on a migrated database: %v", err)
	}
	var n int
	if err := store.InTx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM users WHERE id = $1`, id).Scan(&n)
	}); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("found %d rows of the user after the second Migrate, want 1", n)
	}
}
