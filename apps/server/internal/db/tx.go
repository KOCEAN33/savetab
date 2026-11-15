package db

import (
	"context"
	"errors"

	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// txAttempts caps how often InTx runs a closure that keeps losing a serialization or deadlock
// race. Raise it when requests fail as Unavailable on a 40001 or 40P01 under normal load.
const txAttempts = 3

// InTx runs fn in one transaction, committed when fn returns nil and rolled back otherwise. A
// serialization failure or a deadlock reruns fn in a new transaction, so fn reads every value
// it decides on inside the transaction and changes no state outside it.
func (s *Store) InTx(ctx context.Context, opts pgx.TxOptions, fn func(tx pgx.Tx) error) error {
	var err error
	for range txAttempts {
		if err = pgx.BeginTxFunc(ctx, s.pool, opts, fn); !retryable(err) {
			return err
		}
	}
	return err
}

func retryable(err error) bool {
	pgErr, ok := errors.AsType[*pgconn.PgError](err)
	return ok && (pgErr.Code == pgerrcode.SerializationFailure || pgErr.Code == pgerrcode.DeadlockDetected)
}
