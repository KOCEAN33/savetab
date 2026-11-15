package bus

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
	"github.com/jackc/pgx/v5"
)

const loginTTL = 10 * time.Minute

// Login is one OIDC login in flight. The client's values go back to it at the end, the
// nonce and IssuerVerifier bind the issuer's answer to this login.
type Login struct {
	RedirectURI    string
	ClientState    string
	CodeChallenge  string
	Nonce          string
	IssuerVerifier string
}

// StartLogin stores the login and returns the state to send to the issuer. It also clears
// expired logins.
func (b *Bus) StartLogin(ctx context.Context, l Login) (state string, err error) {
	if state, err = randomToken(); err != nil {
		return "", err
	}
	return state, b.store.Queries().InsertLogin(ctx, hashToken(state), db.Login(l), loginTTL)
}

// PendingLogin returns the login the state belongs to. An expired login and one the issuer
// already answered give a NotFound error.
func (b *Bus) PendingLogin(ctx context.Context, state string) (Login, error) {
	l, err := b.store.Queries().PendingLogin(ctx, hashToken(state))
	return Login(l), err
}

// CompleteLogin records who the issuer says logged in, making the user on a first login,
// and returns the code the client redeems.
func (b *Bus) CompleteLogin(ctx context.Context, state, issuer, subject string) (code string, err error) {
	if code, err = randomToken(); err != nil {
		return "", err
	}
	err = b.store.InTx(ctx, func(tx pgx.Tx) error {
		q := db.New(tx)
		// Two first logins of one identity at once would each make a user.
		if err := q.LockIdentity(ctx, issuer, subject); err != nil {
			return err
		}
		userID, err := q.IdentityUser(ctx, issuer, subject)
		if errs.KindOf(err) == errs.NotFound {
			userID, err = q.InsertUser(ctx, issuer, subject)
		}
		if err != nil {
			return err
		}
		pending, err := q.SetLoginCode(ctx, hashToken(state), hashToken(code), userID)
		if err != nil {
			return err
		}
		if !pending {
			return errs.New(errs.NotFound, "complete login", "not found")
		}
		return nil
	})
	return code, err
}

// RedeemLogin trades a login code and the verifier of its S256 code challenge for a new device
// and its tokens. The code is spent by any attempt, so a wrong verifier also gives a NotFound
// error on the next try with the right one.
func (b *Bus) RedeemLogin(ctx context.Context, code, codeVerifier, deviceName string) (t Tokens, err error) {
	userID, challenge, err := b.store.Queries().TakeLogin(ctx, hashToken(code))
	if err != nil {
		return Tokens{}, err
	}
	sum := sha256.Sum256([]byte(codeVerifier))
	if challenge != base64.RawURLEncoding.EncodeToString(sum[:]) {
		return Tokens{}, errs.New(errs.NotFound, "redeem login", "not found")
	}
	err = b.store.InTx(ctx, func(tx pgx.Tx) error {
		q := db.New(tx)
		deviceID, err := q.InsertDevice(ctx, db.InsertDeviceParams{UserID: userID, Name: deviceName})
		if err != nil {
			return err
		}
		t, err = issueTokens(ctx, q, deviceID, userID)
		return err
	})
	return t, err
}
