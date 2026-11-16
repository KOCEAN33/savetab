package api

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/KOCEAN33/savetab/apps/server/internal/bus"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/logline"
)

type LoginConfig struct {
	Issuer   string
	ClientID string
	// PublicURL is the server's own base URL as the issuer and the clients reach it.
	PublicURL string
	// RedirectURIs are the client redirect URIs a login may end at, matched exactly.
	RedirectURIs []string
}

// Login runs the OIDC login against one issuer.
type Login struct {
	oauth        oauth2.Config
	verifier     *oidc.IDTokenVerifier
	issuer       *http.Client
	redirectURIs []string
}

// NewLogin reads the issuer's discovery document, so the issuer must be reachable.
func NewLogin(ctx context.Context, cfg LoginConfig) (*Login, error) {
	issuer := &http.Client{Transport: logline.Transport(http.DefaultTransport, "oidc")}
	provider, err := oidc.NewProvider(oidc.ClientContext(ctx, issuer), cfg.Issuer)
	if err != nil {
		return nil, err
	}
	oauth := func(callback string) oauth2.Config {
		return oauth2.Config{
			ClientID:    cfg.ClientID,
			Endpoint:    provider.Endpoint(),
			RedirectURL: strings.TrimSuffix(cfg.PublicURL, "/") + callback,
			Scopes:      []string{oidc.ScopeOpenID},
		}
	}
	return &Login{
		oauth:        oauth("/v2/authorizations/callback"),
		verifier:     provider.Verifier(&oidc.Config{ClientID: cfg.ClientID}),
		issuer:       issuer,
		redirectURIs: cfg.RedirectURIs,
	}, nil
}

func withQuery(base string, params map[string]string) string {
	u, err := url.Parse(base)
	if err != nil {
		return base
	}
	q := u.Query()
	for k, v := range params {
		q.Set(k, v)
	}
	u.RawQuery = q.Encode()
	return u.String()
}

// newLogin makes the login of one start request, with the nonce and the verifier that bind the
// issuer's answer to it.
func newLogin(redirectURI, state, challenge string) bus.Login {
	nonce := make([]byte, 16)
	// crypto/rand.Read never fails.
	_, _ = rand.Read(nonce)
	return bus.Login{
		RedirectURI: redirectURI, ClientState: state, CodeChallenge: challenge,
		Nonce: base64.RawURLEncoding.EncodeToString(nonce), IssuerVerifier: oauth2.GenerateVerifier(),
	}
}

// authURL is where the issuer takes the login, with the state StartLogin gave it.
func authURL(oauth *oauth2.Config, login bus.Login, issuerState string) string {
	return oauth.AuthCodeURL(issuerState, oidc.Nonce(login.Nonce), oauth2.S256ChallengeOption(login.IssuerVerifier))
}

// identify trades the issuer's code for an ID token and returns who it names.
func (l *Login) identify(ctx context.Context, oauth *oauth2.Config, login bus.Login, code string) (issuer, subject string, err error) {
	token, err := oauth.Exchange(context.WithValue(ctx, oauth2.HTTPClient, l.issuer), code, oauth2.VerifierOption(login.IssuerVerifier))
	if err != nil {
		return "", "", err
	}
	raw, ok := token.Extra("id_token").(string)
	if !ok {
		return "", "", errors.New("the issuer sent no id_token")
	}
	idToken, err := l.verifier.Verify(ctx, raw)
	if err != nil {
		return "", "", err
	}
	if idToken.Nonce != login.Nonce {
		return "", "", errors.New("the id_token nonce is not this login's")
	}
	return idToken.Issuer, idToken.Subject, nil
}

// StartAuthorization sends the browser to the issuer.
func (h *Handlers) StartAuthorization(ctx context.Context, req StartAuthorizationRequestObject) (StartAuthorizationResponseObject, error) {
	if !slices.Contains(h.login.redirectURIs, req.Params.RedirectUri) {
		return nil, errs.New(errs.Invalid, "start authorization", "redirect_uri is not one the server is configured with")
	}
	login := newLogin(req.Params.RedirectUri, req.Params.State, req.Params.CodeChallenge)
	issuerState, err := h.bus.StartLogin(ctx, login)
	if err != nil {
		return nil, err
	}
	return StartAuthorization302Response{Headers: StartAuthorization302ResponseHeaders{
		Location: authURL(&h.login.oauth, login, issuerState),
	}}, nil
}

// FinishAuthorization takes the issuer's answer. Once the state names a login, the client is
// known, so a failure goes back to it and closes its login window.
func (h *Handlers) FinishAuthorization(ctx context.Context, req FinishAuthorizationRequestObject) (FinishAuthorizationResponseObject, error) {
	login, err := h.bus.PendingLogin(ctx, req.Params.State)
	if errs.KindOf(err) == errs.NotFound {
		return nil, errs.Wrap(errs.Invalid, "finish authorization", "state names no login in flight", err)
	}
	if err != nil {
		return nil, err
	}
	back := func(key, value string) (FinishAuthorizationResponseObject, error) {
		return FinishAuthorization302Response{Headers: FinishAuthorization302ResponseHeaders{
			Location: withQuery(login.RedirectURI, map[string]string{key: value, "state": login.ClientState}),
		}}, nil
	}
	if req.Params.Error != nil && *req.Params.Error == "access_denied" {
		return back("error", "access_denied")
	}
	var issuerCode string
	if req.Params.Code != nil {
		issuerCode = *req.Params.Code
	}
	issuer, subject, err := h.login.identify(ctx, &h.login.oauth, login, issuerCode)
	if err != nil {
		logline.SetError(ctx, err)
		return back("error", "login_failed")
	}
	code, err := h.bus.CompleteLogin(ctx, req.Params.State, issuer, subject)
	if err != nil {
		logline.SetError(ctx, err)
		return back("error", "login_failed")
	}
	return back("code", code)
}

// CreateTokens trades a login code or a refresh token for a token pair.
func (h *Handlers) CreateTokens(ctx context.Context, req CreateTokensRequestObject) (CreateTokensResponseObject, error) {
	body := req.Body
	var tokens bus.Tokens
	var err error
	switch body.GrantType {
	case AuthorizationCode:
		if body.Code == nil || body.CodeVerifier == nil || body.DeviceName == nil {
			return nil, errs.New(errs.Invalid, "create tokens", "authorization_code takes code, code_verifier, and device_name")
		}
		tokens, err = h.bus.RedeemLogin(ctx, *body.Code, *body.CodeVerifier, *body.DeviceName)
		if errs.KindOf(err) == errs.NotFound {
			err = errs.Wrap(errs.Invalid, "create tokens", "the code is spent, expired, or not this verifier's", err)
		}
	case RefreshToken:
		if body.RefreshToken == nil {
			return nil, errs.New(errs.Invalid, "create tokens", "refresh_token takes refresh_token")
		}
		tokens, err = h.bus.RefreshSession(ctx, *body.RefreshToken)
	default:
		return nil, errs.New(errs.Invalid, "create tokens", "unknown grant_type")
	}
	if err != nil {
		return nil, err
	}
	return CreateTokens200JSONResponse{
		AccessToken: tokens.Access, RefreshToken: tokens.Refresh, ExpiresIn: int32(bus.AccessTTL.Seconds()),
		UserId: tokens.UserID, DeviceId: tokens.DeviceID,
	}, nil
}
