// Package errs holds the service's error kinds: the one closed set every layer gives an error
// and every reader maps from. No other package declares a kind or an error status.
package errs

import (
	"errors"
	"time"
)

// Kind is what went wrong, as a caller acts on it. The zero value is Internal, the kind of an
// error that carries none.
type Kind int

const (
	Internal Kind = iota
	Invalid
	Unauthenticated
	Forbidden
	NotFound
	Conflict
	RateLimited
	Cancelled
	Unavailable
)

// Error is an error with a kind. A layer that gives an error a new meaning wraps it in a new
// Error, and readers take the outermost kind.
type Error struct {
	Kind Kind
	// Op names the failed operation, such as "put key".
	Op string
	// Message is the text a caller may read. It never holds the cause's text.
	Message string
	Err     error
	// RetryAfter is the earliest time a retry can succeed, zero when unknown.
	RetryAfter time.Time
}

func (e *Error) Error() string {
	s := e.Op
	if e.Message != "" {
		s += ": " + e.Message
	}
	if e.Err != nil {
		s += ": " + e.Err.Error()
	}
	return s
}

func (e *Error) Unwrap() error { return e.Err }

func New(kind Kind, op, message string) error {
	return &Error{Kind: kind, Op: op, Message: message}
}

func Wrap(kind Kind, op, message string, err error) error {
	return &Error{Kind: kind, Op: op, Message: message, Err: err}
}

// KindOf returns the outermost kind in err's chain, or Internal when the chain holds none.
func KindOf(err error) Kind {
	if e, ok := errors.AsType[*Error](err); ok {
		return e.Kind
	}
	return Internal
}
