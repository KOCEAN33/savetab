package bus

import (
	"context"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
	"github.com/google/uuid"
)

type Device struct {
	ID        uuid.UUID
	Name      string
	CreatedAt time.Time
}

// Devices returns up to limit of the user's devices that are not revoked, oldest first, from
// the position after. next is where the page ended, nil when no device remains.
func (b *Bus) Devices(ctx context.Context, userID uuid.UUID, after Cursor, limit int) (devices []Device, next *Cursor, err error) {
	rows, err := b.store.Queries().Devices(ctx, db.DevicesParams{
		UserID: userID, AfterCreatedAt: after.Time, AfterID: after.ID, MaxRows: int32(limit + 1),
	})
	if err != nil {
		return nil, nil, err
	}
	devices = make([]Device, len(rows))
	for i, row := range rows {
		devices[i] = Device(row)
	}
	if len(devices) > limit {
		last := devices[limit-1]
		return devices[:limit], &Cursor{Time: last.CreatedAt, ID: last.ID}, nil
	}
	return devices, nil, nil
}

// RevokeDevice revokes one of the user's devices, which ends its sessions. A device of another
// user and one already revoked give a NotFound error.
func (b *Bus) RevokeDevice(ctx context.Context, userID, deviceID uuid.UUID) error {
	revoked, err := b.store.Queries().RevokeDevice(ctx, db.RevokeDeviceParams{UserID: userID, DeviceID: deviceID})
	if err != nil {
		return err
	}
	if revoked == 0 {
		return errs.New(errs.NotFound, "revoke device", "not found")
	}
	return nil
}
