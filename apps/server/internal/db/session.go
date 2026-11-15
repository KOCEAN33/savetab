package db

import (
	"context"
	"time"
)

type SessionKind string

const (
	Access  SessionKind = "access"
	Refresh SessionKind = "refresh"
)

func (q *Queries) InsertSession(ctx context.Context, tokenHash []byte, deviceID string, kind SessionKind, ttl time.Duration) error {
	_, err := q.db.Exec(ctx,
		`INSERT INTO sessions (token_hash, device_id, kind, expires_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
		tokenHash, deviceID, string(kind), ttl.Seconds())
	return MapError(ctx, "issue session", err)
}

// AccessSession returns the device and user of an access token's session. An expired session,
// a refresh session, and a session of a revoked device give a NotFound error.
func (q *Queries) AccessSession(ctx context.Context, tokenHash []byte) (deviceID, userID string, err error) {
	err = q.db.QueryRow(ctx, `
		SELECT d.id, d.user_id
		FROM sessions s JOIN devices d ON d.id = s.device_id
		WHERE s.token_hash = $1 AND s.kind = 'access' AND s.expires_at > now() AND d.revoked_at IS NULL`,
		tokenHash).Scan(&deviceID, &userID)
	return deviceID, userID, MapError(ctx, "authenticate", err)
}

// TakeRefreshSession deletes a refresh token's session and returns its device and user. An
// expired session, an access session, and a session of a revoked device give a NotFound error.
func (q *Queries) TakeRefreshSession(ctx context.Context, tokenHash []byte) (deviceID, userID string, err error) {
	err = q.db.QueryRow(ctx, `
		DELETE FROM sessions s USING devices d
		WHERE s.token_hash = $1 AND s.kind = 'refresh' AND s.expires_at > now()
			AND d.id = s.device_id AND d.revoked_at IS NULL
		RETURNING d.id, d.user_id`,
		tokenHash).Scan(&deviceID, &userID)
	return deviceID, userID, MapError(ctx, "refresh session", err)
}
