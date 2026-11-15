package bus

import (
	"context"

	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
	"github.com/jackc/pgx/v5"
)

// Snapshot is the encrypted state of a user's records after every op up to Seq.
type Snapshot struct {
	Seq        int64
	Ciphertext []byte
}

// PutSnapshot replaces the user's snapshot and deletes the ops it covers. A seq at or above the
// log's next seq is Invalid, and one below the stored snapshot's seq is a Conflict.
func (b *Bus) PutSnapshot(ctx context.Context, userID string, snap Snapshot) error {
	return b.store.InTx(ctx, pgx.TxOptions{}, func(tx pgx.Tx) error {
		q := db.New(tx)
		// The same row lock a push takes, so no op lands at or below snap.Seq after the check.
		next, err := q.LockNextSeq(ctx, userID)
		if err != nil {
			return err
		}
		if snap.Seq >= next {
			return errs.New(errs.Invalid, "put snapshot", "the snapshot seq is above the log's last seq")
		}
		stored, err := q.UpsertSnapshot(ctx, userID, db.Snapshot(snap))
		if err != nil {
			return err
		}
		if !stored {
			return errs.New(errs.Conflict, "put snapshot", "the user has a snapshot at a higher seq")
		}
		return q.DeleteOpsThrough(ctx, userID, snap.Seq)
	})
}

func (b *Bus) Snapshot(ctx context.Context, userID string) (Snapshot, error) {
	row, err := b.store.Queries().Snapshot(ctx, userID)
	return Snapshot(row), err
}
