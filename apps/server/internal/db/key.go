package db

import (
	"context"

	"github.com/google/uuid"
)

// InsertKey stores the user's wrapped data key unless the user has one, and reports whether it
// stored it.
func (q *Queries) InsertKey(ctx context.Context, userID uuid.UUID, wrapped []byte) (bool, error) {
	tag, err := q.db.Exec(ctx,
		`INSERT INTO key_wraps (user_id, wrapped_key) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
		userID, wrapped)
	if err != nil {
		return false, MapError(ctx, "put key", err)
	}
	return tag.RowsAffected() == 1, nil
}

func (q *Queries) Key(ctx context.Context, userID uuid.UUID) (wrapped []byte, err error) {
	err = q.db.QueryRow(ctx, `SELECT wrapped_key FROM key_wraps WHERE user_id = $1`, userID).Scan(&wrapped)
	return wrapped, MapError(ctx, "get key", err)
}
