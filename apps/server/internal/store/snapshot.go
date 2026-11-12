package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

var (
	ErrSnapshotAhead = errors.New("the snapshot seq is above the log's last seq")
	ErrStaleSnapshot = errors.New("the user has a snapshot at a higher seq")
)

// Snapshot is the encrypted state of a user's records after every op up to Seq.
type Snapshot struct {
	Seq        int64
	Ciphertext []byte
}

// PutSnapshot replaces the user's snapshot and deletes the ops it covers.
func (s *Store) PutSnapshot(ctx context.Context, userID string, snap Snapshot) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// The same row lock a push takes, so no op lands at or below snap.Seq after the check.
		var next int64
		if err := tx.QueryRow(ctx, `SELECT next_seq FROM users WHERE id = $1 FOR UPDATE`, userID).Scan(&next); err != nil {
			return err
		}
		if snap.Seq >= next {
			return ErrSnapshotAhead
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO snapshots (user_id, seq, ciphertext) VALUES ($1, $2, $3)
			ON CONFLICT (user_id) DO UPDATE SET seq = EXCLUDED.seq, ciphertext = EXCLUDED.ciphertext, created_at = now()
			WHERE snapshots.seq <= EXCLUDED.seq`,
			userID, snap.Seq, snap.Ciphertext)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrStaleSnapshot
		}
		_, err = tx.Exec(ctx, `DELETE FROM ops WHERE user_id = $1 AND seq <= $2`, userID, snap.Seq)
		return err
	})
}

func (s *Store) Snapshot(ctx context.Context, userID string) (snap Snapshot, err error) {
	err = s.pool.QueryRow(ctx, `SELECT seq, ciphertext FROM snapshots WHERE user_id = $1`, userID).Scan(&snap.Seq, &snap.Ciphertext)
	if errors.Is(err, pgx.ErrNoRows) {
		return Snapshot{}, ErrNotFound
	}
	return snap, err
}
