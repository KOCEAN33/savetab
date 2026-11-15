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
// it decides on inside the transaction and changes no state outside it. The error it returns
// carries a kind, and so does the error of each statement fn runs on tx.
func (s *Store) InTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	return s.inTx(ctx, pgx.TxOptions{}, fn)
}

// InSnapshot is InTx for reads that must agree with each other: fn sees one snapshot of the
// database and can write nothing.
func (s *Store) InSnapshot(ctx context.Context, fn func(tx pgx.Tx) error) error {
	return s.inTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, fn)
}

func (s *Store) inTx(ctx context.Context, opts pgx.TxOptions, fn func(tx pgx.Tx) error) error {
	var err error
	for range txAttempts {
		err = pgx.BeginTxFunc(ctx, s.pool, opts, func(tx pgx.Tx) error {
			return fn(mappedTx{Tx: tx, mapped: mapped{db: tx}})
		})
		if !retryable(err) {
			break
		}
	}
	return MapError(ctx, "transaction", err)
}

func retryable(err error) bool {
	pgErr, ok := errors.AsType[*pgconn.PgError](err)
	return ok && (pgErr.Code == pgerrcode.SerializationFailure || pgErr.Code == pgerrcode.DeadlockDetected)
}
