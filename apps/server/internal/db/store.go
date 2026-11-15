// Package db is the server's Postgres access.
package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

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

// Queries runs each statement on the pool, outside any transaction.
func (s *Store) Queries() *Queries { return New(mapped{db: s.pool}) }

func (s *Store) Close() { s.pool.Close() }

func (s *Store) Ping(ctx context.Context) error {
	return MapError(ctx, "ping database", s.pool.Ping(ctx))
}
