// Package db is the server's Postgres access.
package db

import (
	"context"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool *pgxpool.Pool
}

// Options are the pool's limits. Each timeout is a setting of every connection the pool opens,
// so it holds whatever the role's own defaults are.
type Options struct {
	MaxConns         int32
	StatementTimeout time.Duration
	IdleInTxTimeout  time.Duration
}

// Open connects a pool and pings it once within ctx.
func Open(ctx context.Context, url string, opts Options) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, MapError(ctx, "open database", err)
	}
	cfg.MaxConns = opts.MaxConns
	params := cfg.ConnConfig.RuntimeParams
	params["statement_timeout"] = strconv.FormatInt(opts.StatementTimeout.Milliseconds(), 10)
	params["idle_in_transaction_session_timeout"] = strconv.FormatInt(opts.IdleInTxTimeout.Milliseconds(), 10)
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
