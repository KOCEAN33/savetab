package db

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"io/fs"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Migrate applies every embedded migration not yet recorded, in file name order.
func (s *Store) Migrate(ctx context.Context) error {
	names, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return MapError(ctx, "migrate", err)
	}
	sort.Strings(names)
	return s.InTx(ctx, func(tx pgx.Tx) error {
		if err := lockMigrations(ctx, tx); err != nil {
			return err
		}
		for _, name := range names {
			done, err := migrationApplied(ctx, tx, name)
			if err != nil {
				return err
			}
			if done {
				continue
			}
			sql, err := migrations.ReadFile(name)
			if err != nil {
				return MapError(ctx, "migrate", err)
			}
			if err := applyMigration(ctx, tx, name, string(sql)); err != nil {
				return err
			}
		}
		return nil
	})
}

// MigrationsHash changes when the name or the text of an embedded migration does.
func MigrationsHash() (string, error) {
	names, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return "", err
	}
	sort.Strings(names)
	h := sha256.New()
	for _, name := range names {
		sql, err := migrations.ReadFile(name)
		if err != nil {
			return "", err
		}
		h.Write([]byte(name))
		h.Write([]byte{0})
		h.Write(sql)
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// MigrateURL applies the embedded migrations to the database at url, which no server is using.
func MigrateURL(ctx context.Context, url string) error {
	store, err := Open(ctx, url, Options{MaxConns: 1, StatementTimeout: time.Minute, IdleInTxTimeout: time.Minute})
	if err != nil {
		return err
	}
	defer store.Close()
	return store.Migrate(ctx)
}
