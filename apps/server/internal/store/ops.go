package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// NewOp is an encrypted op as a device pushes it.
type NewOp struct {
	ID         string
	Ciphertext []byte
}

// StoredOp is an op as the log returns it.
type StoredOp struct {
	Seq        int64
	ID         string
	DeviceID   string
	Ciphertext []byte
	ReceivedAt time.Time
}

// AppendOps adds the ops to the caller's log in the given order. An op id the user already
// pushed is skipped, so a device can retry a push whose answer it lost.
func (s *Store) AppendOps(ctx context.Context, c Caller, ops []NewOp) error {
	ids := make([]string, 0, len(ops))
	blobs := make([][]byte, 0, len(ops))
	seen := make(map[string]bool, len(ops))
	for _, op := range ops {
		if seen[op.ID] {
			continue
		}
		seen[op.ID] = true
		ids = append(ids, op.ID)
		blobs = append(blobs, op.Ciphertext)
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// The row lock makes one user's pushes run one at a time, so a reader that has seen
		// seq n never later finds a new op at or below n.
		var next int64
		if err := tx.QueryRow(ctx, `SELECT next_seq FROM users WHERE id = $1 FOR UPDATE`, c.UserID).Scan(&next); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO ops (user_id, seq, op_id, device_id, ciphertext)
			SELECT $1, $2 + row_number() OVER (ORDER BY t.ord) - 1, t.op_id, $3, t.ciphertext
			FROM unnest($4::uuid[], $5::bytea[]) WITH ORDINALITY AS t(op_id, ciphertext, ord)
			WHERE NOT EXISTS (SELECT 1 FROM ops o WHERE o.user_id = $1 AND o.op_id = t.op_id)`,
			c.UserID, next, c.DeviceID, ids, blobs)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE users SET next_seq = $2 WHERE id = $1`, c.UserID, next+tag.RowsAffected())
		return err
	})
}

// ErrSnapshotRequired means the log no longer holds every op above the requested seq.
var ErrSnapshotRequired = errors.New("ops at or below the snapshot are gone")

// OpsAfter returns up to limit of the user's ops with seq above after, in seq order, and
// whether more remain. It gives ErrSnapshotRequired when after is below the snapshot's seq.
func (s *Store) OpsAfter(ctx context.Context, userID string, after int64, limit int) (ops []StoredOp, more bool, err error) {
	// One view for both reads, so a snapshot that lands between them cannot hide ops it deleted.
	view := pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}
	err = pgx.BeginTxFunc(ctx, s.pool, view, func(tx pgx.Tx) error {
		var stale bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM snapshots WHERE user_id = $1 AND seq > $2)`, userID, after).Scan(&stale); err != nil {
			return err
		}
		if stale {
			return ErrSnapshotRequired
		}
		rows, err := tx.Query(ctx, `
			SELECT seq, op_id, device_id, ciphertext, received_at
			FROM ops WHERE user_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
			userID, after, limit+1)
		if err != nil {
			return err
		}
		ops, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (StoredOp, error) {
			var op StoredOp
			err := row.Scan(&op.Seq, &op.ID, &op.DeviceID, &op.Ciphertext, &op.ReceivedAt)
			return op, err
		})
		return err
	})
	if err != nil {
		return nil, false, err
	}
	if len(ops) > limit {
		return ops[:limit], true, nil
	}
	return ops, false, nil
}
