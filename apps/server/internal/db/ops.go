package db

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// StoredOp is an op as the log returns it.
type StoredOp struct {
	Seq        int64
	ID         uuid.UUID
	DeviceID   uuid.UUID
	Ciphertext []byte
	ReceivedAt time.Time
}

// LockNextSeq returns the seq the user's next op gets and locks the user's row until the
// transaction ends.
func (q *Queries) LockNextSeq(ctx context.Context, userID uuid.UUID) (next int64, err error) {
	err = q.db.QueryRow(ctx, `SELECT next_seq FROM users WHERE id = $1 FOR UPDATE`, userID).Scan(&next)
	return next, MapError(ctx, "lock next seq", err)
}

// InsertOps appends the ops in the given order from seq first on, skipping an op id the user
// already pushed. It returns how many it inserted.
func (q *Queries) InsertOps(ctx context.Context, userID, deviceID uuid.UUID, first int64, ids []uuid.UUID, ciphertexts [][]byte) (int64, error) {
	tag, err := q.db.Exec(ctx, `
		INSERT INTO ops (user_id, seq, op_id, device_id, ciphertext)
		SELECT $1, $2 + row_number() OVER (ORDER BY t.ord) - 1, t.op_id, $3, t.ciphertext
		FROM unnest($4::uuid[], $5::bytea[]) WITH ORDINALITY AS t(op_id, ciphertext, ord)
		WHERE NOT EXISTS (SELECT 1 FROM ops o WHERE o.user_id = $1 AND o.op_id = t.op_id)`,
		userID, first, deviceID, ids, ciphertexts)
	if err != nil {
		return 0, MapError(ctx, "insert ops", err)
	}
	return tag.RowsAffected(), nil
}

func (q *Queries) SetNextSeq(ctx context.Context, userID uuid.UUID, next int64) error {
	_, err := q.db.Exec(ctx, `UPDATE users SET next_seq = $2 WHERE id = $1`, userID, next)
	return MapError(ctx, "set next seq", err)
}

// SnapshotAbove reports whether the user has a snapshot at a seq above seq.
func (q *Queries) SnapshotAbove(ctx context.Context, userID uuid.UUID, seq int64) (above bool, err error) {
	err = q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM snapshots WHERE user_id = $1 AND seq > $2)`, userID, seq).Scan(&above)
	return above, MapError(ctx, "find snapshot above", err)
}

// OpsAfter returns up to limit of the user's ops with seq above after, in seq order.
func (q *Queries) OpsAfter(ctx context.Context, userID uuid.UUID, after int64, limit int) ([]StoredOp, error) {
	rows, err := q.db.Query(ctx, `
		SELECT seq, op_id, device_id, ciphertext, received_at
		FROM ops WHERE user_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
		userID, after, limit)
	if err != nil {
		return nil, MapError(ctx, "read ops", err)
	}
	ops, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (StoredOp, error) {
		var op StoredOp
		err := row.Scan(&op.Seq, &op.ID, &op.DeviceID, &op.Ciphertext, &op.ReceivedAt)
		return op, err
	})
	return ops, MapError(ctx, "read ops", err)
}
