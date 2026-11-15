package db

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Pairing is one key exchange between a new device and a signed-in device of the same user.
// The server relays its messages and can read none of them.
type Pairing struct {
	ID            uuid.UUID
	NewDeviceID   uuid.UUID
	NewDeviceName string
	Commitment    []byte
	OldPublic     []byte
	NewPublic     []byte
	WrappedKey    []byte
	ExpiresAt     time.Time
}

// PairingMessage names the column a pairing message is stored in.
type PairingMessage string

const (
	OldPublic  PairingMessage = "old_public"
	NewPublic  PairingMessage = "new_public"
	WrappedKey PairingMessage = "wrapped_key"
)

// PairingState is which messages a pairing holds.
type PairingState struct {
	NewDeviceID uuid.UUID
	HasOld      bool
	HasNew      bool
	HasKey      bool
}

const pairingColumns = `p.id, p.new_device_id, d.name, p.commitment, p.old_public, p.new_public, p.wrapped_key, p.expires_at`

func scanPairing(row pgx.CollectableRow) (Pairing, error) {
	var p Pairing
	err := row.Scan(&p.ID, &p.NewDeviceID, &p.NewDeviceName, &p.Commitment, &p.OldPublic, &p.NewPublic, &p.WrappedKey, &p.ExpiresAt)
	return p, err
}

// CreatePairing opens a pairing for the device, which is the new one. It replaces a pairing the
// device still has open and clears the user's expired ones.
func (q *Queries) CreatePairing(ctx context.Context, userID, deviceID uuid.UUID, commitment []byte, ttl time.Duration) (Pairing, error) {
	rows, err := q.db.Query(ctx, `
		WITH gone AS (
			DELETE FROM pairings WHERE user_id = $1 AND (expires_at <= now() OR new_device_id = $2)
		), p AS (
			INSERT INTO pairings (user_id, new_device_id, commitment, expires_at)
			VALUES ($1, $2, $3, now() + make_interval(secs => $4))
			RETURNING *
		)
		SELECT `+pairingColumns+` FROM p JOIN devices d ON d.id = p.new_device_id`,
		userID, deviceID, commitment, ttl.Seconds())
	if err != nil {
		return Pairing{}, MapError(ctx, "create pairing", err)
	}
	p, err := pgx.CollectExactlyOneRow(rows, scanPairing)
	return p, MapError(ctx, "create pairing", err)
}

// Pairings returns the user's pairings that have not expired, oldest first.
func (q *Queries) Pairings(ctx context.Context, userID uuid.UUID) ([]Pairing, error) {
	rows, err := q.db.Query(ctx, `
		SELECT `+pairingColumns+` FROM pairings p JOIN devices d ON d.id = p.new_device_id
		WHERE p.user_id = $1 AND p.expires_at > now() ORDER BY p.expires_at, p.id`,
		userID)
	if err != nil {
		return nil, MapError(ctx, "list pairings", err)
	}
	ps, err := pgx.CollectRows(rows, scanPairing)
	return ps, MapError(ctx, "list pairings", err)
}

// Pairing returns one of the user's pairings. An expired pairing gives a NotFound error.
func (q *Queries) Pairing(ctx context.Context, userID, id uuid.UUID) (Pairing, error) {
	rows, err := q.db.Query(ctx, `
		SELECT `+pairingColumns+` FROM pairings p JOIN devices d ON d.id = p.new_device_id
		WHERE p.id = $1 AND p.user_id = $2 AND p.expires_at > now()`,
		id, userID)
	if err != nil {
		return Pairing{}, MapError(ctx, "get pairing", err)
	}
	p, err := pgx.CollectExactlyOneRow(rows, scanPairing)
	return p, MapError(ctx, "get pairing", err)
}

// LockPairing returns which messages one of the user's pairings holds and locks its row until
// the transaction ends. An expired pairing gives a NotFound error.
func (q *Queries) LockPairing(ctx context.Context, userID, id uuid.UUID) (s PairingState, err error) {
	err = q.db.QueryRow(ctx, `
		SELECT new_device_id, old_public IS NOT NULL, new_public IS NOT NULL, wrapped_key IS NOT NULL
		FROM pairings WHERE id = $1 AND user_id = $2 AND expires_at > now() FOR UPDATE`,
		id, userID).Scan(&s.NewDeviceID, &s.HasOld, &s.HasNew, &s.HasKey)
	return s, MapError(ctx, "lock pairing", err)
}

func (q *Queries) SetPairingMessage(ctx context.Context, id uuid.UUID, message PairingMessage, value []byte) error {
	_, err := q.db.Exec(ctx, `UPDATE pairings SET `+string(message)+` = $2 WHERE id = $1`, id, value)
	return MapError(ctx, "set pairing message", err)
}
