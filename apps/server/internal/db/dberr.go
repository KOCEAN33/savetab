package db

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"

	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// MapError gives a driver error its kind, reading the SQLSTATE code and never the message. An
// error that already carries a kind, such as a rule a transaction broke, keeps it. op names the
// failed operation.
func MapError(ctx context.Context, op string, err error) error {
	if err == nil {
		return nil
	}
	if _, ok := errors.AsType[*errs.Error](err); ok {
		return err
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return errs.Wrap(errs.Cancelled, op, "the request was cancelled", err)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return errs.Wrap(errs.NotFound, op, "not found", err)
	}
	if pgErr, ok := errors.AsType[*pgconn.PgError](err); ok {
		switch {
		case pgErr.Code == pgerrcode.UniqueViolation:
			return errs.Wrap(errs.Conflict, op, "already exists", err)
		case pgErr.Code == pgerrcode.SerializationFailure, pgErr.Code == pgerrcode.DeadlockDetected,
			pgErr.Code == pgerrcode.TooManyConnections, pgErr.Code == pgerrcode.AdminShutdown,
			pgErr.Code == pgerrcode.CannotConnectNow, pgErr.Code == pgerrcode.QueryCanceled,
			pgerrcode.IsConnectionException(pgErr.Code):
			return errs.Wrap(errs.Unavailable, op, "", err)
		}
	} else if lostConnection(err) {
		return errs.Wrap(errs.Unavailable, op, "", err)
	}
	return errs.Wrap(errs.Internal, op, "", fmt.Errorf("%v", err)) //nolint:errorlint // hide the driver error type
}

// lostConnection reports an error of a connection that broke or closed before Postgres
// answered, which carries no SQLSTATE.
func lostConnection(err error) bool {
	if _, ok := errors.AsType[net.Error](err); ok {
		return true
	}
	return pgconn.SafeToRetry(err) || errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF)
}
