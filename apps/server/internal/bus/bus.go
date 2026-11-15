// Package bus holds the use cases. A use case opens its transaction, holds the rules, and
// calls db for SQL and row conversion.
package bus

import "github.com/KOCEAN33/savetab/apps/server/internal/db"

type Bus struct {
	store *db.Store
}

func New(store *db.Store) *Bus { return &Bus{store: store} }

// Caller is the device and user an access token stands for.
type Caller struct {
	DeviceID string
	UserID   string
}
