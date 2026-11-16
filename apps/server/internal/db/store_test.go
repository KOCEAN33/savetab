package db_test

import (
	"context"
	"testing"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/jackc/pgx/v5"
)

func TestOpenSetsTheTimeoutsOnEveryConnection(t *testing.T) {
	t.Parallel()
	url := emptyDatabase(t)
	ctx := context.Background()
	store, err := db.Open(ctx, url, db.Options{MaxConns: 1, StatementTimeout: 3 * time.Second, IdleInTxTimeout: 7 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.Close)
	for setting, want := range map[string]string{"statement_timeout": "3s", "idle_in_transaction_session_timeout": "7s"} {
		var got string
		err := store.InTx(ctx, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, "SELECT current_setting($1)", setting).Scan(&got)
		})
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Errorf("%s = %q, want %q", setting, got, want)
		}
	}
}
