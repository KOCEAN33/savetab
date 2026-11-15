// Package bus holds the use cases. A use case opens its transaction, holds the rules, and
// calls db for SQL and row conversion.
package bus

import (
	"context"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/google/uuid"
)

type Bus struct {
	store *db.Store
}

func New(store *db.Store) *Bus { return &Bus{store: store} }

func (b *Bus) Ping(ctx context.Context) error { return b.store.Ping(ctx) }

// Cursor is a position in a list ordered by a time, then an id: the row a page ended at. The
// zero Cursor is before every row.
type Cursor struct {
	Time time.Time
	ID   uuid.UUID
}

// Caller is the device and user an access token stands for.
type Caller struct {
	DeviceID uuid.UUID
	UserID   uuid.UUID
}
