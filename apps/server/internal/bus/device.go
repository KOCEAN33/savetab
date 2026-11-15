package bus

import (
	"context"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
	"github.com/google/uuid"
)

type Device struct {
	ID        uuid.UUID
	Name      string
	CreatedAt time.Time
}

// Devices returns the user's devices that are not revoked, oldest first.
func (b *Bus) Devices(ctx context.Context, userID uuid.UUID) ([]Device, error) {
	rows, err := b.store.Queries().Devices(ctx, userID)
	if err != nil {
		return nil, err
	}
	devices := make([]Device, len(rows))
	for i, row := range rows {
		devices[i] = Device(row)
	}
	return devices, nil
}

// RevokeDevice revokes one of the user's devices, which ends its sessions. A device of another
// user and one already revoked give a NotFound error.
func (b *Bus) RevokeDevice(ctx context.Context, userID, deviceID uuid.UUID) error {
	revoked, err := b.store.Queries().RevokeDevice(ctx, userID, deviceID)
	if err != nil {
		return err
	}
	if !revoked {
		return errs.New(errs.NotFound, "revoke device", "not found")
	}
	return nil
}
