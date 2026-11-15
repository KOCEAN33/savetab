package bus

import (
	"context"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
)

const shareTTL = 30 * 24 * time.Hour

// Share is a copy of a folder or group that anyone holding its URL can read until it expires.
type Share struct {
	ID         string
	Ciphertext []byte
	ExpiresAt  time.Time
}

// CreateShare stores a share of the user's. It also clears every user's expired shares, so
// none outlives the next share made on the server.
func (b *Bus) CreateShare(ctx context.Context, userID string, ciphertext []byte) (Share, error) {
	row, err := b.store.Queries().InsertShare(ctx, userID, ciphertext, shareTTL)
	return Share(row), err
}

// Share returns any user's share. An expired share gives a NotFound error.
func (b *Bus) Share(ctx context.Context, id string) (Share, error) {
	row, err := b.store.Queries().Share(ctx, id)
	return Share(row), err
}

// DeleteShare deletes one of the user's shares. An expired share gives a NotFound error.
func (b *Bus) DeleteShare(ctx context.Context, userID, id string) error {
	deleted, err := b.store.Queries().DeleteShare(ctx, userID, id)
	if err != nil {
		return err
	}
	if !deleted {
		return errs.New(errs.NotFound, "delete share", "not found")
	}
	return nil
}
