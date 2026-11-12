package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

var (
	ErrNotFound  = errors.New("not found")
	ErrKeyExists = errors.New("the user already has a wrapped key")
)

// PutKey stores the user's wrapped data key. A user's key is set once: a second device that
// replaced it would cut every other device off from the log.
func (s *Store) PutKey(ctx context.Context, userID string, wrapped []byte) error {
	tag, err := s.pool.Exec(ctx,
		`INSERT INTO key_wraps (user_id, wrapped_key) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
		userID, wrapped)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrKeyExists
	}
	return nil
}

func (s *Store) Key(ctx context.Context, userID string) (wrapped []byte, err error) {
	err = s.pool.QueryRow(ctx, `SELECT wrapped_key FROM key_wraps WHERE user_id = $1`, userID).Scan(&wrapped)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return wrapped, err
}
