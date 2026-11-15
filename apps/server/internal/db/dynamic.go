package db

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// PairingMessage names the column a pairing message is stored in.
type PairingMessage string

const (
	OldPublic  PairingMessage = "old_public"
	NewPublic  PairingMessage = "new_public"
	WrappedKey PairingMessage = "wrapped_key"
)

// SetPairingMessage stores one message of a pairing, in the column the message names.
func SetPairingMessage(ctx context.Context, dbtx DBTX, id uuid.UUID, message PairingMessage, value []byte) error {
	column := pgx.Identifier{string(message)}.Sanitize()
	_, err := dbtx.Exec(ctx, `UPDATE pairings SET `+column+` = $2 WHERE id = $1`, id, value)
	return MapError(ctx, "set pairing message", err)
}
