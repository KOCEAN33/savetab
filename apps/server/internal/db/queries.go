package db

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// DBTX is what a statement runs on: the pool, or a transaction InTx opened.
type DBTX interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Queries runs the package's statements on one DBTX.
type Queries struct {
	db DBTX
}

func New(db DBTX) *Queries { return &Queries{db: db} }

// Queries runs each statement on the pool, outside any transaction.
func (s *Store) Queries() *Queries { return New(s.pool) }
