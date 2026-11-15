package db

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Share is a copy of a folder or group that anyone holding its URL can read until it expires.
type Share struct {
	ID         uuid.UUID
	Ciphertext []byte
	ExpiresAt  time.Time
}

// InsertShare stores a share of the user's that expires after ttl. It also clears every user's
// expired shares, so none outlives the next share made on the server.
func (q *Queries) InsertShare(ctx context.Context, userID uuid.UUID, ciphertext []byte, ttl time.Duration) (Share, error) {
	sh := Share{Ciphertext: ciphertext}
	err := q.db.QueryRow(ctx, `
		WITH gone AS (
			DELETE FROM shares WHERE expires_at <= now()
		)
		INSERT INTO shares (user_id, ciphertext, expires_at)
		VALUES ($1, $2, now() + make_interval(secs => $3))
		RETURNING id, expires_at`,
		userID, ciphertext, ttl.Seconds()).Scan(&sh.ID, &sh.ExpiresAt)
	return sh, MapError(ctx, "create share", err)
}

// Share returns any user's share. An expired share gives a NotFound error.
func (q *Queries) Share(ctx context.Context, id uuid.UUID) (Share, error) {
	sh := Share{ID: id}
	err := q.db.QueryRow(ctx, `SELECT ciphertext, expires_at FROM shares WHERE id = $1 AND expires_at > now()`,
		id).Scan(&sh.Ciphertext, &sh.ExpiresAt)
	if err != nil {
		return Share{}, MapError(ctx, "get share", err)
	}
	return sh, nil
}

// DeleteShare deletes one of the user's unexpired shares and reports whether it found one.
func (q *Queries) DeleteShare(ctx context.Context, userID, id uuid.UUID) (bool, error) {
	tag, err := q.db.Exec(ctx, `DELETE FROM shares WHERE id = $1 AND user_id = $2 AND expires_at > now()`, id, userID)
	if err != nil {
		return false, MapError(ctx, "delete share", err)
	}
	return tag.RowsAffected() == 1, nil
}
