package bus

import (
	"context"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
	"github.com/google/uuid"
)

const shareTTL = 30 * 24 * time.Hour

// Share is a copy of a folder or group that anyone holding its URL can read until it expires.
type Share struct {
	ID         uuid.UUID
	Ciphertext []byte
	ExpiresAt  time.Time
}

// CreateShare stores a share of the user's. It also clears every user's expired shares, so
// none outlives the next share made on the server. id is the caller's choice, and an id a share
// already has gives a Conflict.
func (b *Bus) CreateShare(ctx context.Context, userID, id uuid.UUID, ciphertext []byte) (Share, error) {
	row, err := b.store.Queries().InsertShare(ctx, db.InsertShareParams{ID: id, UserID: userID, Ciphertext: ciphertext, TTLSeconds: shareTTL.Seconds()})
	return Share(row), err
}

// Share returns any user's share. An expired share gives a NotFound error.
func (b *Bus) Share(ctx context.Context, id uuid.UUID) (Share, error) {
	row, err := b.store.Queries().Share(ctx, id)
	return Share(row), err
}

// DeleteShare deletes one of the user's shares. An expired share gives a NotFound error.
func (b *Bus) DeleteShare(ctx context.Context, userID, id uuid.UUID) error {
	deleted, err := b.store.Queries().DeleteShare(ctx, db.DeleteShareParams{ID: id, UserID: userID})
	if err != nil {
		return err
	}
	if deleted == 0 {
		return errs.New(errs.NotFound, "delete share", "not found")
	}
	return nil
}
