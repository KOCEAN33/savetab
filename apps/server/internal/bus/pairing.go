package bus

import (
	"context"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const pairingTTL = 5 * time.Minute

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

// PairingMessage is one message of the exchange.
type PairingMessage string

const (
	OldPublic  PairingMessage = PairingMessage(db.OldPublic)
	NewPublic  PairingMessage = PairingMessage(db.NewPublic)
	WrappedKey PairingMessage = PairingMessage(db.WrappedKey)
)

// StartPairing opens a pairing for the calling device, which is the new one. It replaces a
// pairing the device still has open and clears the user's expired ones. id is the caller's
// choice, and an id a pairing already has gives a Conflict.
func (b *Bus) StartPairing(ctx context.Context, c Caller, id uuid.UUID, commitment []byte) (Pairing, error) {
	row, err := b.store.Queries().CreatePairing(ctx, db.CreatePairingParams{
		ID: id, UserID: c.UserID, NewDeviceID: c.DeviceID, Commitment: commitment, TTLSeconds: pairingTTL.Seconds(),
	})
	return Pairing(row), err
}

// Pairings returns up to limit of the user's pairings that have not expired, oldest first, from
// the position after. next is where the page ended, nil when no pairing remains.
func (b *Bus) Pairings(ctx context.Context, userID uuid.UUID, after Cursor, limit int) (ps []Pairing, next *Cursor, err error) {
	rows, err := b.store.Queries().Pairings(ctx, db.PairingsParams{
		UserID: userID, AfterExpiresAt: after.Time, AfterID: after.ID, MaxRows: int32(limit + 1),
	})
	if err != nil {
		return nil, nil, err
	}
	ps = make([]Pairing, len(rows))
	for i, row := range rows {
		ps[i] = Pairing(row)
	}
	if len(ps) > limit {
		last := ps[limit-1]
		return ps[:limit], &Cursor{Time: last.ExpiresAt, ID: last.ID}, nil
	}
	return ps, nil, nil
}

// Pairing returns one of the user's pairings. An expired pairing gives a NotFound error.
func (b *Bus) Pairing(ctx context.Context, userID, id uuid.UUID) (Pairing, error) {
	row, err := b.store.Queries().Pairing(ctx, db.PairingParams{ID: id, UserID: userID})
	return Pairing(row), err
}

// SetPairingMessage stores one message of the exchange. The order is OldPublic from a signed-in
// device, NewPublic from the new device, then WrappedKey from a signed-in device. Each is set
// once, so a later request cannot swap a public key the other side has already read.
func (b *Bus) SetPairingMessage(ctx context.Context, c Caller, id uuid.UUID, message PairingMessage, value []byte) error {
	return b.store.InTx(ctx, func(tx pgx.Tx) error {
		q := db.New(tx)
		state, err := q.LockPairing(ctx, db.LockPairingParams{ID: id, UserID: c.UserID})
		if err != nil {
			return err
		}
		fromNew := c.DeviceID == state.NewDeviceID
		var ready bool
		switch message {
		case OldPublic:
			ready = !state.HasOld
		case NewPublic:
			ready = state.HasOld && !state.HasNew
		case WrappedKey:
			ready = state.HasNew && !state.HasKey
		}
		if fromNew != (message == NewPublic) {
			return errs.New(errs.Forbidden, "set pairing message", "the message belongs to the other side of the pairing")
		}
		if !ready {
			return errs.New(errs.Conflict, "set pairing message", "the message is out of order or already set")
		}
		return db.SetPairingMessage(ctx, tx, id, db.PairingMessage(message), value)
	})
}
