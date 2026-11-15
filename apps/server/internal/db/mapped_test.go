package db_test

import (
	"context"
	"testing"

	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var nobody = uuid.MustParse("01900000-0000-7000-8000-0000000000aa")

func TestAGeneratedQueryReturnsAKindedError(t *testing.T) {
	store, _ := openStore(t)
	ctx := context.Background()

	if _, err := store.Queries().LockNextSeq(ctx, nobody); errs.KindOf(err) != errs.NotFound {
		t.Errorf("one row of a missing user: kind %d, want NotFound (%v)", errs.KindOf(err), err)
	}
	_, err := store.Queries().OpsAfter(cancelled(), db.OpsAfterParams{UserID: nobody, MaxOps: 1})
	if errs.KindOf(err) != errs.Cancelled {
		t.Errorf("many rows under a cancelled context: kind %d, want Cancelled (%v)", errs.KindOf(err), err)
	}
	err = store.Queries().SetNextSeq(cancelled(), db.SetNextSeqParams{UserID: nobody, NextSeq: 1})
	if errs.KindOf(err) != errs.Cancelled {
		t.Errorf("exec under a cancelled context: kind %d, want Cancelled (%v)", errs.KindOf(err), err)
	}
}

// A use case reads the kind inside its closure, before InTx maps what the closure returns.
func TestAGeneratedQueryInATransactionReturnsAKindedError(t *testing.T) {
	store, _ := openStore(t)
	ctx := context.Background()

	var inside error
	if err := store.InTx(ctx, func(tx pgx.Tx) error {
		_, inside = db.New(tx).LockNextSeq(ctx, nobody)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if errs.KindOf(inside) != errs.NotFound {
		t.Errorf("one row of a missing user: kind %d, want NotFound (%v)", errs.KindOf(inside), inside)
	}
}
