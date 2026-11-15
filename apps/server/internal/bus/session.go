package bus

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	AccessTTL  = time.Hour
	refreshTTL = 90 * 24 * time.Hour
)

// Tokens is what a device holds after a login or a refresh.
type Tokens struct {
	Access   string
	Refresh  string
	DeviceID uuid.UUID
	UserID   uuid.UUID
}

// hashToken is what the database stores of a token, so a read of the database gives no
// working token.
func hashToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

func randomToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", errs.Wrap(errs.Internal, "make token", "", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func issueSession(ctx context.Context, q *db.Queries, deviceID uuid.UUID, kind db.SessionKind, ttl time.Duration) (string, error) {
	token, err := randomToken()
	if err != nil {
		return "", err
	}
	return token, q.InsertSession(ctx, hashToken(token), deviceID, kind, ttl)
}

func issueTokens(ctx context.Context, q *db.Queries, deviceID, userID uuid.UUID) (t Tokens, err error) {
	t.DeviceID, t.UserID = deviceID, userID
	if t.Access, err = issueSession(ctx, q, deviceID, db.Access, AccessTTL); err != nil {
		return Tokens{}, err
	}
	if t.Refresh, err = issueSession(ctx, q, deviceID, db.Refresh, refreshTTL); err != nil {
		return Tokens{}, err
	}
	return t, nil
}

// Authenticate resolves an access token. An expired token, a refresh token, and a token of a
// revoked device all give an Unauthenticated error.
func (b *Bus) Authenticate(ctx context.Context, token string) (Caller, error) {
	var c Caller
	var err error
	c.DeviceID, c.UserID, err = b.store.Queries().AccessSession(ctx, hashToken(token))
	if errs.KindOf(err) == errs.NotFound {
		return Caller{}, errs.Wrap(errs.Unauthenticated, "authenticate", "no such session", err)
	}
	return c, err
}

// RefreshSession spends a refresh token and returns a new pair. A spent or expired token,
// an access token, and a token of a revoked device all give an Unauthenticated error.
func (b *Bus) RefreshSession(ctx context.Context, refreshToken string) (t Tokens, err error) {
	err = b.store.InTx(ctx, func(tx pgx.Tx) error {
		q := db.New(tx)
		deviceID, userID, err := q.TakeRefreshSession(ctx, hashToken(refreshToken))
		if errs.KindOf(err) == errs.NotFound {
			return errs.Wrap(errs.Unauthenticated, "refresh session", "no such session", err)
		}
		if err != nil {
			return err
		}
		t, err = issueTokens(ctx, q, deviceID, userID)
		return err
	})
	return t, err
}
