package db

import (
	"context"

	"github.com/google/uuid"
)

// Snapshot is the encrypted state of a user's records after every op up to Seq.
type Snapshot struct {
	Seq        int64
	Ciphertext []byte
}

// UpsertSnapshot replaces the user's snapshot unless the stored one has a higher seq, and
// reports whether it stored snap.
func (q *Queries) UpsertSnapshot(ctx context.Context, userID uuid.UUID, snap Snapshot) (bool, error) {
	tag, err := q.db.Exec(ctx, `
		INSERT INTO snapshots (user_id, seq, ciphertext) VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO UPDATE SET seq = EXCLUDED.seq, ciphertext = EXCLUDED.ciphertext, created_at = now()
		WHERE snapshots.seq <= EXCLUDED.seq`,
		userID, snap.Seq, snap.Ciphertext)
	if err != nil {
		return false, MapError(ctx, "put snapshot", err)
	}
	return tag.RowsAffected() == 1, nil
}

// DeleteOpsThrough deletes the user's ops at or below seq.
func (q *Queries) DeleteOpsThrough(ctx context.Context, userID uuid.UUID, seq int64) error {
	_, err := q.db.Exec(ctx, `DELETE FROM ops WHERE user_id = $1 AND seq <= $2`, userID, seq)
	return MapError(ctx, "delete ops", err)
}

func (q *Queries) Snapshot(ctx context.Context, userID uuid.UUID) (snap Snapshot, err error) {
	err = q.db.QueryRow(ctx, `SELECT seq, ciphertext FROM snapshots WHERE user_id = $1`, userID).Scan(&snap.Seq, &snap.Ciphertext)
	return snap, MapError(ctx, "get snapshot", err)
}
