package db

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Login is one OIDC login in flight. The client's values go back to it at the end, the
// nonce and IssuerVerifier bind the issuer's answer to this login.
type Login struct {
	RedirectURI    string
	ClientState    string
	CodeChallenge  string
	Nonce          string
	IssuerVerifier string
}

// InsertLogin stores the login under the hash of its state and clears expired logins.
func (q *Queries) InsertLogin(ctx context.Context, stateHash []byte, l Login, ttl time.Duration) error {
	_, err := q.db.Exec(ctx, `
		WITH gone AS (DELETE FROM logins WHERE expires_at <= now())
		INSERT INTO logins (state_hash, redirect_uri, client_state, code_challenge, nonce, issuer_verifier, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))`,
		stateHash, l.RedirectURI, l.ClientState, l.CodeChallenge, l.Nonce, l.IssuerVerifier, ttl.Seconds())
	return MapError(ctx, "create login", err)
}

// PendingLogin returns the login the state hash belongs to. An expired login and one the
// issuer already answered give a NotFound error.
func (q *Queries) PendingLogin(ctx context.Context, stateHash []byte) (l Login, err error) {
	err = q.db.QueryRow(ctx, `
		SELECT redirect_uri, client_state, code_challenge, nonce, issuer_verifier
		FROM logins WHERE state_hash = $1 AND code_hash IS NULL AND expires_at > now()`,
		stateHash).Scan(&l.RedirectURI, &l.ClientState, &l.CodeChallenge, &l.Nonce, &l.IssuerVerifier)
	if err != nil {
		return Login{}, MapError(ctx, "get pending login", err)
	}
	return l, nil
}

// LockIdentity locks the identity until the transaction ends, whether or not it exists yet.
func (q *Queries) LockIdentity(ctx context.Context, issuer, subject string) error {
	_, err := q.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1 || ' ' || $2, 0))`, issuer, subject)
	return MapError(ctx, "lock identity", err)
}

// IdentityUser returns the user the identity belongs to. An unknown identity gives a NotFound
// error.
func (q *Queries) IdentityUser(ctx context.Context, issuer, subject string) (userID uuid.UUID, err error) {
	err = q.db.QueryRow(ctx, `SELECT user_id FROM identities WHERE issuer = $1 AND subject = $2`, issuer, subject).Scan(&userID)
	return userID, MapError(ctx, "get identity", err)
}

// InsertUser makes a user with the identity.
func (q *Queries) InsertUser(ctx context.Context, issuer, subject string) (userID uuid.UUID, err error) {
	err = q.db.QueryRow(ctx, `
		WITH u AS (INSERT INTO users DEFAULT VALUES RETURNING id)
		INSERT INTO identities (issuer, subject, user_id) SELECT $1, $2, id FROM u RETURNING user_id`,
		issuer, subject).Scan(&userID)
	return userID, MapError(ctx, "create user", err)
}

// SetLoginCode records the code and the user of a pending login, and reports whether the login
// was still pending.
func (q *Queries) SetLoginCode(ctx context.Context, stateHash, codeHash []byte, userID uuid.UUID) (bool, error) {
	tag, err := q.db.Exec(ctx, `
		UPDATE logins SET code_hash = $2, user_id = $3
		WHERE state_hash = $1 AND code_hash IS NULL AND expires_at > now()`,
		stateHash, codeHash, userID)
	if err != nil {
		return false, MapError(ctx, "complete login", err)
	}
	return tag.RowsAffected() == 1, nil
}

// TakeLogin deletes the unexpired login the code hash belongs to and returns its user and
// code challenge. An unknown code gives a NotFound error.
func (q *Queries) TakeLogin(ctx context.Context, codeHash []byte) (userID uuid.UUID, codeChallenge string, err error) {
	err = q.db.QueryRow(ctx,
		`DELETE FROM logins WHERE code_hash = $1 AND expires_at > now() RETURNING user_id, code_challenge`,
		codeHash).Scan(&userID, &codeChallenge)
	return userID, codeChallenge, MapError(ctx, "redeem login", err)
}
