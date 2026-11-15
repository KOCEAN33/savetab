package bus

import (
	"context"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// NewOp is an encrypted op as a device pushes it.
type NewOp struct {
	ID         uuid.UUID
	Ciphertext []byte
}

// StoredOp is an op as the log returns it.
type StoredOp struct {
	Seq        int64
	ID         uuid.UUID
	DeviceID   uuid.UUID
	Ciphertext []byte
	ReceivedAt time.Time
}

// PushOps adds the ops to the caller's log in the given order. An op id the user already
// pushed is skipped, so a device can retry a push whose answer it lost.
func (b *Bus) PushOps(ctx context.Context, c Caller, ops []NewOp) error {
	ids := make([]uuid.UUID, 0, len(ops))
	ciphertexts := make([][]byte, 0, len(ops))
	seen := make(map[uuid.UUID]bool, len(ops))
	for _, op := range ops {
		if seen[op.ID] {
			continue
		}
		seen[op.ID] = true
		ids = append(ids, op.ID)
		ciphertexts = append(ciphertexts, op.Ciphertext)
	}
	return b.store.InTx(ctx, func(tx pgx.Tx) error {
		q := db.New(tx)
		// The row lock makes one user's pushes run one at a time, so a reader that has seen
		// seq n never later finds a new op at or below n.
		next, err := q.LockNextSeq(ctx, c.UserID)
		if err != nil {
			return err
		}
		inserted, err := q.InsertOps(ctx, db.InsertOpsParams{
			UserID: c.UserID, DeviceID: c.DeviceID, FirstSeq: next, OpIDs: ids, Ciphertexts: ciphertexts,
		})
		if err != nil {
			return err
		}
		return q.SetNextSeq(ctx, db.SetNextSeqParams{UserID: c.UserID, NextSeq: next + inserted})
	})
}

// PullOps returns up to limit of the user's ops with seq above after, in seq order, and
// whether more remain. It gives a Conflict when after is below the snapshot's seq, since the
// log no longer holds every op above it.
func (b *Bus) PullOps(ctx context.Context, userID uuid.UUID, after int64, limit int) (ops []StoredOp, more bool, err error) {
	// One view for both reads, so a snapshot that lands between them cannot hide ops it deleted.
	err = b.store.InSnapshot(ctx, func(tx pgx.Tx) error {
		q := db.New(tx)
		stale, err := q.SnapshotAbove(ctx, db.SnapshotAboveParams{UserID: userID, Seq: after})
		if err != nil {
			return err
		}
		if stale {
			return errs.New(errs.Conflict, "pull ops", "ops at or below the snapshot are gone")
		}
		rows, err := q.OpsAfter(ctx, db.OpsAfterParams{UserID: userID, AfterSeq: after, MaxOps: int32(limit + 1)})
		if err != nil {
			return err
		}
		ops = make([]StoredOp, len(rows))
		for i, row := range rows {
			ops[i] = StoredOp(row)
		}
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	if len(ops) > limit {
		return ops[:limit], true, nil
	}
	return ops, false, nil
}
