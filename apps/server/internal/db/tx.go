package db

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// InTx runs fn in one transaction, committed when fn returns nil and rolled back otherwise.
func (s *Store) InTx(ctx context.Context, opts pgx.TxOptions, fn func(tx pgx.Tx) error) error {
	return pgx.BeginTxFunc(ctx, s.pool, opts, fn)
}
