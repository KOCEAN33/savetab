package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

var (
	ErrForbidden       = errors.New("the message belongs to the other side of the pairing")
	ErrPairingConflict = errors.New("the message is out of order or already set")
)

// Pairing is one key exchange between a new device and a signed-in device of the same user.
// The server relays its messages and can read none of them.
type Pairing struct {
	ID            string
	NewDeviceID   string
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

const pairingColumns = `p.id, p.new_device_id, d.name, p.commitment, p.old_public, p.new_public, p.wrapped_key, p.expires_at`

func scanPairing(row pgx.CollectableRow) (Pairing, error) {
	var p Pairing
	err := row.Scan(&p.ID, &p.NewDeviceID, &p.NewDeviceName, &p.Commitment, &p.OldPublic, &p.NewPublic, &p.WrappedKey, &p.ExpiresAt)
	return p, err
}

// CreatePairing opens a pairing for the calling device, which is the new one. It replaces a
// pairing the device still has open and clears the user's expired ones.
func (s *Store) CreatePairing(ctx context.Context, c Caller, commitment []byte, ttl time.Duration) (Pairing, error) {
	rows, err := s.pool.Query(ctx, `
		WITH gone AS (
			DELETE FROM pairings WHERE user_id = $1 AND (expires_at <= now() OR new_device_id = $2)
		), p AS (
			INSERT INTO pairings (user_id, new_device_id, commitment, expires_at)
			VALUES ($1, $2, $3, now() + make_interval(secs => $4))
			RETURNING *
		)
		SELECT `+pairingColumns+` FROM p JOIN devices d ON d.id = p.new_device_id`,
		c.UserID, c.DeviceID, commitment, ttl.Seconds())
	if err != nil {
		return Pairing{}, err
	}
	return pgx.CollectExactlyOneRow(rows, scanPairing)
}

// Pairings returns the user's pairings that have not expired, oldest first.
func (s *Store) Pairings(ctx context.Context, userID string) ([]Pairing, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+pairingColumns+` FROM pairings p JOIN devices d ON d.id = p.new_device_id
		WHERE p.user_id = $1 AND p.expires_at > now() ORDER BY p.expires_at, p.id`,
		userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanPairing)
}

// Pairing returns one of the user's pairings. An expired pairing gives ErrNotFound.
func (s *Store) Pairing(ctx context.Context, userID, id string) (Pairing, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+pairingColumns+` FROM pairings p JOIN devices d ON d.id = p.new_device_id
		WHERE p.id = $1 AND p.user_id = $2 AND p.expires_at > now()`,
		id, userID)
	if err != nil {
		return Pairing{}, err
	}
	p, err := pgx.CollectExactlyOneRow(rows, scanPairing)
	if errors.Is(err, pgx.ErrNoRows) {
		return Pairing{}, ErrNotFound
	}
	return p, err
}

// SetPairingMessage stores one message of the exchange. The order is OldPublic from a signed-in
// device, NewPublic from the new device, then WrappedKey from a signed-in device. Each is set
// once, so a later request cannot swap a public key the other side has already read.
func (s *Store) SetPairingMessage(ctx context.Context, c Caller, id string, message PairingMessage, value []byte) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var newDeviceID string
		var hasOld, hasNew, hasKey bool
		err := tx.QueryRow(ctx, `
			SELECT new_device_id, old_public IS NOT NULL, new_public IS NOT NULL, wrapped_key IS NOT NULL
			FROM pairings WHERE id = $1 AND user_id = $2 AND expires_at > now() FOR UPDATE`,
			id, c.UserID).Scan(&newDeviceID, &hasOld, &hasNew, &hasKey)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		fromNew := c.DeviceID == newDeviceID
		var ready bool
		switch message {
		case OldPublic:
			ready = !hasOld
		case NewPublic:
			ready = hasOld && !hasNew
		case WrappedKey:
			ready = hasNew && !hasKey
		}
		if fromNew != (message == NewPublic) {
			return ErrForbidden
		}
		if !ready {
			return ErrPairingConflict
		}
		_, err = tx.Exec(ctx, `UPDATE pairings SET `+string(message)+` = $2 WHERE id = $1`, id, value)
		return err
	})
}
