package db

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type Device struct {
	ID        uuid.UUID
	Name      string
	CreatedAt time.Time
}

func (q *Queries) InsertDevice(ctx context.Context, userID uuid.UUID, name string) (deviceID uuid.UUID, err error) {
	err = q.db.QueryRow(ctx, `INSERT INTO devices (user_id, name) VALUES ($1, $2) RETURNING id`, userID, name).Scan(&deviceID)
	return deviceID, MapError(ctx, "create device", err)
}

// Devices returns the user's devices that are not revoked, oldest first.
func (q *Queries) Devices(ctx context.Context, userID uuid.UUID) ([]Device, error) {
	rows, err := q.db.Query(ctx, `
		SELECT id, name, created_at FROM devices
		WHERE user_id = $1 AND revoked_at IS NULL
		ORDER BY created_at, id`, userID)
	if err != nil {
		return nil, MapError(ctx, "list devices", err)
	}
	devices, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Device, error) {
		var d Device
		err := row.Scan(&d.ID, &d.Name, &d.CreatedAt)
		return d, err
	})
	return devices, MapError(ctx, "list devices", err)
}

// RevokeDevice revokes one of the user's devices that is not revoked yet, which ends its
// sessions, and reports whether it found one.
func (q *Queries) RevokeDevice(ctx context.Context, userID, deviceID uuid.UUID) (bool, error) {
	tag, err := q.db.Exec(ctx,
		`UPDATE devices SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
		deviceID, userID)
	if err != nil {
		return false, MapError(ctx, "revoke device", err)
	}
	return tag.RowsAffected() == 1, nil
}
