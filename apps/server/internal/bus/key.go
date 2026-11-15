package bus

import (
	"context"

	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
	"github.com/google/uuid"
)

// PutKey stores the user's wrapped data key. A user's key is set once: a second device that
// replaced it would cut every other device off from the log.
func (b *Bus) PutKey(ctx context.Context, userID uuid.UUID, wrapped []byte) error {
	inserted, err := b.store.Queries().InsertKey(ctx, userID, wrapped)
	if err != nil {
		return err
	}
	if !inserted {
		return errs.New(errs.Conflict, "put key", "the user already has a wrapped key")
	}
	return nil
}

func (b *Bus) Key(ctx context.Context, userID uuid.UUID) ([]byte, error) {
	return b.store.Queries().Key(ctx, userID)
}
