package db

import (
	"context"
	"embed"
	"io/fs"
	"sort"

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
