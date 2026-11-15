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

// migrationLock is the advisory lock key that keeps two starting servers from migrating at once.
const migrationLock = 7283910455

// lockMigrations makes the transaction the only one migrating, and makes sure the table of
// applied migrations exists. No migration creates that table, so sqlc cannot check its queries.
func lockMigrations(ctx context.Context, dbtx DBTX) error {
	if _, err := dbtx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, migrationLock); err != nil {
		return MapError(ctx, "lock migrations", err)
	}
	_, err := dbtx.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)`)
	return MapError(ctx, "lock migrations", err)
}

func migrationApplied(ctx context.Context, dbtx DBTX, name string) (done bool, err error) {
	err = dbtx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = $1)`, name).Scan(&done)
	return done, MapError(ctx, "find migration "+name, err)
}

// applyMigration runs the statements of a migration file and records it as applied.
func applyMigration(ctx context.Context, dbtx DBTX, name, statements string) error {
	if _, err := dbtx.Exec(ctx, statements); err != nil {
		return MapError(ctx, "apply migration "+name, err)
	}
	_, err := dbtx.Exec(ctx, `INSERT INTO schema_migrations (name) VALUES ($1)`, name)
	return MapError(ctx, "apply migration "+name, err)
}
