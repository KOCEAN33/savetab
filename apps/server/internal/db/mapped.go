package db

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// mapped is the DBTX under every Queries. It returns each driver error as a kinded one, which
// the generated code hands on unchanged.
type mapped struct {
	db DBTX
}

// operation names a statement in an error: the name sqlc keeps on the first line of a
// generated query.
func operation(sql string) string {
	if rest, ok := strings.CutPrefix(sql, "-- name: "); ok {
		name, _, _ := strings.Cut(rest, " ")
		return name
	}
	return "query"
}

func (m mapped) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	tag, err := m.db.Exec(ctx, sql, args...)
	return tag, MapError(ctx, operation(sql), err)
}

func (m mapped) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	rows, err := m.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, MapError(ctx, operation(sql), err)
	}
	return mappedRows{Rows: rows, ctx: ctx, op: operation(sql)}, nil
}

func (m mapped) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return mappedRow{row: m.db.QueryRow(ctx, sql, args...), ctx: ctx, op: operation(sql)}
}

type mappedRows struct {
	pgx.Rows
	ctx context.Context
	op  string
}

func (r mappedRows) Scan(dest ...any) error { return MapError(r.ctx, r.op, r.Rows.Scan(dest...)) }
func (r mappedRows) Err() error             { return MapError(r.ctx, r.op, r.Rows.Err()) }

type mappedRow struct {
	row pgx.Row
	ctx context.Context
	op  string
}

func (r mappedRow) Scan(dest ...any) error { return MapError(r.ctx, r.op, r.row.Scan(dest...)) }

// mappedTx is the transaction a closure of InTx gets, so db.New(tx) maps errors as the pool's
// Queries does.
type mappedTx struct {
	pgx.Tx
	mapped mapped
}

func (t mappedTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return t.mapped.Exec(ctx, sql, args...)
}

func (t mappedTx) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return t.mapped.Query(ctx, sql, args...)
}

func (t mappedTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return t.mapped.QueryRow(ctx, sql, args...)
}
