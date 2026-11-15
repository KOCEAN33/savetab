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
	return state, b.store.Queries().InsertLogin(ctx, db.InsertLoginParams{
		StateHash: hashToken(state), RedirectURI: l.RedirectURI, ClientState: l.ClientState, CodeChallenge: l.CodeChallenge,
		Nonce: l.Nonce, IssuerVerifier: l.IssuerVerifier, TTLSeconds: loginTTL.Seconds(),
	})
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
		if err := q.LockIdentity(ctx, db.LockIdentityParams{Issuer: issuer, Subject: subject}); err != nil {
			return err
		}
		userID, err := q.IdentityUser(ctx, db.IdentityUserParams{Issuer: issuer, Subject: subject})
		if errs.KindOf(err) == errs.NotFound {
			if userID, err = q.InsertUser(ctx); err == nil {
				err = q.InsertIdentity(ctx, db.InsertIdentityParams{Issuer: issuer, Subject: subject, UserID: userID})
			}
		}
		if err != nil {
			return err
		}
		pending, err := q.SetLoginCode(ctx, db.SetLoginCodeParams{StateHash: hashToken(state), CodeHash: hashToken(code), UserID: userID})
		if err != nil {
			return err
		}
		if pending == 0 {
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
	login, err := b.store.Queries().TakeLogin(ctx, hashToken(code))
	if err != nil {
		return Tokens{}, err
	}
	sum := sha256.Sum256([]byte(codeVerifier))
	if login.CodeChallenge != base64.RawURLEncoding.EncodeToString(sum[:]) {
		return Tokens{}, errs.New(errs.NotFound, "redeem login", "not found")
	}
	err = b.store.InTx(ctx, func(tx pgx.Tx) error {
		q := db.New(tx)
		deviceID, err := q.InsertDevice(ctx, db.InsertDeviceParams{UserID: login.UserID, Name: deviceName})
		if err != nil {
			return err
		}
		t, err = issueTokens(ctx, q, deviceID, login.UserID)
		return err
	})
	return t, err
}
