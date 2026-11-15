// Package db is the server's Postgres access.
package db

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrations embed.FS

// migrationLock is the advisory lock key that keeps two starting servers from migrating at once.
const migrationLock = 7283910455

type Store struct {
	pool *pgxpool.Pool
}

// Open connects a pool of at most maxConns connections and pings it once within ctx.
func Open(ctx context.Context, url string, maxConns int32) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, MapError(ctx, "open database", err)
	}
	cfg.MaxConns = maxConns
	cfg.ConnConfig.Tracer = tracer{}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, MapError(ctx, "open database", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, MapError(ctx, "open database", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() { s.pool.Close() }

func (s *Store) Ping(ctx context.Context) error {
	return MapError(ctx, "ping database", s.pool.Ping(ctx))
}

// Migrate applies every embedded migration not yet recorded, in file name order.
func (s *Store) Migrate(ctx context.Context) error {
	names, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return MapError(ctx, "migrate", err)
	}
	sort.Strings(names)
	return MapError(ctx, "migrate", s.InTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, migrationLock); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)`); err != nil {
			return err
		}
		for _, name := range names {
			var done bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = $1)`, name).Scan(&done); err != nil {
				return err
			}
			if done {
				continue
			}
			sql, err := migrations.ReadFile(name)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, string(sql)); err != nil {
				return fmt.Errorf("%s: %w", name, err)
			}
			if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (name) VALUES ($1)`, name); err != nil {
				return err
			}
		}
		return nil
	}))
}
