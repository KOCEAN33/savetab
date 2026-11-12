package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	AccessTTL  = time.Hour
	RefreshTTL = 90 * 24 * time.Hour
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

// CreateLogin stores the login and returns the state to send to the issuer. It also clears
// expired logins.
func (s *Store) CreateLogin(ctx context.Context, l Login, ttl time.Duration) (state string, err error) {
	if state, err = randomToken(); err != nil {
		return "", err
	}
	_, err = s.pool.Exec(ctx, `
		WITH gone AS (DELETE FROM logins WHERE expires_at <= now())
		INSERT INTO logins (state_hash, redirect_uri, client_state, code_challenge, nonce, issuer_verifier, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))`,
		hashToken(state), l.RedirectURI, l.ClientState, l.CodeChallenge, l.Nonce, l.IssuerVerifier, ttl.Seconds())
	return state, err
}

// PendingLogin returns the login the state belongs to. An expired login and one the issuer
// already answered give ErrNotFound.
func (s *Store) PendingLogin(ctx context.Context, state string) (l Login, err error) {
	err = s.pool.QueryRow(ctx, `
		SELECT redirect_uri, client_state, code_challenge, nonce, issuer_verifier
		FROM logins WHERE state_hash = $1 AND code_hash IS NULL AND expires_at > now()`,
		hashToken(state)).Scan(&l.RedirectURI, &l.ClientState, &l.CodeChallenge, &l.Nonce, &l.IssuerVerifier)
	if errors.Is(err, pgx.ErrNoRows) {
		return Login{}, ErrNotFound
	}
	return l, err
}

// CompleteLogin records who the issuer says logged in, making the user on a first login,
// and returns the code the client redeems.
func (s *Store) CompleteLogin(ctx context.Context, state, issuer, subject string) (code string, err error) {
	if code, err = randomToken(); err != nil {
		return "", err
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// Two first logins of one identity at once would each make a user.
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1 || ' ' || $2, 0))`, issuer, subject); err != nil {
			return err
		}
		var userID string
		err := tx.QueryRow(ctx, `SELECT user_id FROM identities WHERE issuer = $1 AND subject = $2`, issuer, subject).Scan(&userID)
		if errors.Is(err, pgx.ErrNoRows) {
			err = tx.QueryRow(ctx, `
				WITH u AS (INSERT INTO users DEFAULT VALUES RETURNING id)
				INSERT INTO identities (issuer, subject, user_id) SELECT $1, $2, id FROM u RETURNING user_id`,
				issuer, subject).Scan(&userID)
		}
		if err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
			UPDATE logins SET code_hash = $2, user_id = $3
			WHERE state_hash = $1 AND code_hash IS NULL AND expires_at > now()`,
			hashToken(state), hashToken(code), userID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	})
	return code, err
}

// Tokens is what a device holds after a login or a refresh.
type Tokens struct {
	Access   string
	Refresh  string
	DeviceID string
	UserID   string
}

func issueTokens(ctx context.Context, tx pgx.Tx, deviceID, userID string) (t Tokens, err error) {
	t.DeviceID, t.UserID = deviceID, userID
	if t.Access, err = issueSession(ctx, tx, deviceID, Access, AccessTTL); err != nil {
		return Tokens{}, err
	}
	if t.Refresh, err = issueSession(ctx, tx, deviceID, Refresh, RefreshTTL); err != nil {
		return Tokens{}, err
	}
	return t, nil
}

// RedeemLogin trades a login code for a new device and its tokens. The code is spent by any
// attempt, so a wrong challenge also gives ErrNotFound on the next try with the right one.
func (s *Store) RedeemLogin(ctx context.Context, code, codeChallenge, deviceName string) (t Tokens, err error) {
	var userID, challenge string
	err = s.pool.QueryRow(ctx,
		`DELETE FROM logins WHERE code_hash = $1 AND expires_at > now() RETURNING user_id, code_challenge`,
		hashToken(code)).Scan(&userID, &challenge)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && challenge != codeChallenge) {
		return Tokens{}, ErrNotFound
	}
	if err != nil {
		return Tokens{}, err
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var deviceID string
		if err := tx.QueryRow(ctx, `INSERT INTO devices (user_id, name) VALUES ($1, $2) RETURNING id`, userID, deviceName).Scan(&deviceID); err != nil {
			return err
		}
		t, err = issueTokens(ctx, tx, deviceID, userID)
		return err
	})
	return t, err
}

// RefreshSession spends a refresh token and returns a new pair. A spent or expired token,
// an access token, and a token of a revoked device all give ErrNoSession.
func (s *Store) RefreshSession(ctx context.Context, refreshToken string) (t Tokens, err error) {
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var deviceID, userID string
		err := tx.QueryRow(ctx, `
			DELETE FROM sessions s USING devices d
			WHERE s.token_hash = $1 AND s.kind = 'refresh' AND s.expires_at > now()
				AND d.id = s.device_id AND d.revoked_at IS NULL
			RETURNING d.id, d.user_id`,
			hashToken(refreshToken)).Scan(&deviceID, &userID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNoSession
		}
		if err != nil {
			return err
		}
		t, err = issueTokens(ctx, tx, deviceID, userID)
		return err
	})
	return t, err
}
