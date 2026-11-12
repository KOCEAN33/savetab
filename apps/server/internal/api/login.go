package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/KOCEAN33/savetab/apps/server/internal/store"
)

const (
	loginTTL         = 10 * time.Minute
	maxStateBytes    = 512
	maxDeviceNameLen = 100
)

// An S256 code challenge is 32 bytes as unpadded base64url.
var challengePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

type LoginConfig struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	// PublicURL is the server's own base URL as the issuer and the clients reach it.
	PublicURL string
	// RedirectURIs are the client redirect URIs a login may end at, matched exactly.
	RedirectURIs []string
}

// Login runs the OIDC login against one issuer.
type Login struct {
	oauth        oauth2.Config
	verifier     *oidc.IDTokenVerifier
	redirectURIs []string
}

// NewLogin reads the issuer's discovery document, so the issuer must be reachable.
func NewLogin(ctx context.Context, cfg LoginConfig) (*Login, error) {
	provider, err := oidc.NewProvider(ctx, cfg.Issuer)
	if err != nil {
		return nil, err
	}
	return &Login{
		oauth: oauth2.Config{
			ClientID:     cfg.ClientID,
			ClientSecret: cfg.ClientSecret,
			Endpoint:     provider.Endpoint(),
			RedirectURL:  strings.TrimSuffix(cfg.PublicURL, "/") + "/v1/auth/callback",
			Scopes:       []string{oidc.ScopeOpenID},
		},
		verifier:     provider.Verifier(&oidc.Config{ClientID: cfg.ClientID}),
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

func (s *server) authStart(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	redirectURI, challenge, state := q.Get("redirect_uri"), q.Get("code_challenge"), q.Get("state")
	if !slices.Contains(s.login.redirectURIs, redirectURI) {
		writeError(w, http.StatusBadRequest, "invalid_redirect_uri")
		return
	}
	if !challengePattern.MatchString(challenge) || state == "" || len(state) > maxStateBytes {
		writeError(w, http.StatusBadRequest, "bad_request")
		return
	}
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		internalError(w, r, err)
		return
	}
	login := store.Login{
		RedirectURI: redirectURI, ClientState: state, CodeChallenge: challenge,
		Nonce: base64.RawURLEncoding.EncodeToString(nonce), IssuerVerifier: oauth2.GenerateVerifier(),
	}
	issuerState, err := s.store.CreateLogin(r.Context(), login, loginTTL)
	if err != nil {
		internalError(w, r, err)
		return
	}
	http.Redirect(w, r, s.login.oauth.AuthCodeURL(issuerState, oidc.Nonce(login.Nonce), oauth2.S256ChallengeOption(login.IssuerVerifier)), http.StatusFound)
}

// identify trades the issuer's code for an ID token and returns who it names.
func (s *server) identify(ctx context.Context, login store.Login, code string) (issuer, subject string, err error) {
	token, err := s.login.oauth.Exchange(ctx, code, oauth2.VerifierOption(login.IssuerVerifier))
	if err != nil {
		return "", "", err
	}
	raw, ok := token.Extra("id_token").(string)
	if !ok {
		return "", "", errors.New("the issuer sent no id_token")
	}
	idToken, err := s.login.verifier.Verify(ctx, raw)
	if err != nil {
		return "", "", err
	}
	if idToken.Nonce != login.Nonce {
		return "", "", errors.New("the id_token nonce is not this login's")
	}
	return idToken.Issuer, idToken.Subject, nil
}

func (s *server) authCallback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	state := q.Get("state")
	login, err := s.store.PendingLogin(r.Context(), state)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusBadRequest, "invalid_state")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	// From here the client is known, so a failure goes back to it and closes its login window.
	fail := func(code string) {
		http.Redirect(w, r, withQuery(login.RedirectURI, map[string]string{"error": code, "state": login.ClientState}), http.StatusFound)
	}
	if q.Get("error") == "access_denied" {
		fail("access_denied")
		return
	}
	issuer, subject, err := s.identify(r.Context(), login, q.Get("code"))
	if err != nil {
		slog.Warn("login failed", "err", err)
		fail("login_failed")
		return
	}
	code, err := s.store.CompleteLogin(r.Context(), state, issuer, subject)
	if err != nil {
		slog.Error("login failed", "err", err)
		fail("login_failed")
		return
	}
	http.Redirect(w, r, withQuery(login.RedirectURI, map[string]string{"code": code, "state": login.ClientState}), http.StatusFound)
}

type tokensBody struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresIn    int    `json:"expiresIn"`
	UserID       string `json:"userId"`
	DeviceID     string `json:"deviceId"`
}

func tokensView(t store.Tokens) tokensBody {
	return tokensBody{
		AccessToken: t.Access, RefreshToken: t.Refresh, ExpiresIn: int(store.AccessTTL.Seconds()),
		UserID: t.UserID, DeviceID: t.DeviceID,
	}
}

func (s *server) authToken(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code         string `json:"code"`
		CodeVerifier string `json:"codeVerifier"`
		DeviceName   string `json:"deviceName"`
	}
	if !readJSON(w, r, smallBodyBytes, &body) {
		return
	}
	if body.Code == "" || body.CodeVerifier == "" || body.DeviceName == "" || len(body.DeviceName) > maxDeviceNameLen {
		writeError(w, http.StatusBadRequest, "bad_request")
		return
	}
	challenge := sha256.Sum256([]byte(body.CodeVerifier))
	tokens, err := s.store.RedeemLogin(r.Context(), body.Code, base64.RawURLEncoding.EncodeToString(challenge[:]), body.DeviceName)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusBadRequest, "invalid_grant")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, tokensView(tokens))
}

func (s *server) authRefresh(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RefreshToken string `json:"refreshToken"`
	}
	if !readJSON(w, r, smallBodyBytes, &body) {
		return
	}
	tokens, err := s.store.RefreshSession(r.Context(), body.RefreshToken)
	if errors.Is(err, store.ErrNoSession) {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, tokensView(tokens))
}
