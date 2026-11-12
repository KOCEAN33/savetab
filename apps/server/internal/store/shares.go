package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Share is a copy of a folder or group that anyone holding its URL can read until it expires.
type Share struct {
	ID         string
	Ciphertext []byte
	ExpiresAt  time.Time
}

// CreateShare stores a share of the user's that expires after ttl. It also clears every user's
// expired shares, so none outlives the next share made on the server.
func (s *Store) CreateShare(ctx context.Context, userID string, ciphertext []byte, ttl time.Duration) (Share, error) {
	sh := Share{Ciphertext: ciphertext}
	err := s.pool.QueryRow(ctx, `
		WITH gone AS (
			DELETE FROM shares WHERE expires_at <= now()
		)
		INSERT INTO shares (user_id, ciphertext, expires_at)
		VALUES ($1, $2, now() + make_interval(secs => $3))
		RETURNING id, expires_at`,
		userID, ciphertext, ttl.Seconds()).Scan(&sh.ID, &sh.ExpiresAt)
	return sh, err
}

// Share returns any user's share. An expired share gives ErrNotFound.
func (s *Store) Share(ctx context.Context, id string) (Share, error) {
	sh := Share{ID: id}
	err := s.pool.QueryRow(ctx, `SELECT ciphertext, expires_at FROM shares WHERE id = $1 AND expires_at > now()`,
		id).Scan(&sh.Ciphertext, &sh.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Share{}, ErrNotFound
	}
	return sh, err
}

// DeleteShare deletes one of the user's shares. An expired share gives ErrNotFound.
func (s *Store) DeleteShare(ctx context.Context, userID, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM shares WHERE id = $1 AND user_id = $2 AND expires_at > now()`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
