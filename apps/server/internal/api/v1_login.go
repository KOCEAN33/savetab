package api

import (
	"net/http"
	"regexp"
	"slices"

	"github.com/google/uuid"

	"github.com/KOCEAN33/savetab/apps/server/internal/bus"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/logline"
)

const (
	maxStateBytes    = 512
	maxDeviceNameLen = 100
)

// An S256 code challenge is 32 bytes as unpadded base64url.
var challengePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

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
	login := newLogin(redirectURI, state, challenge)
	issuerState, err := s.bus.StartLogin(r.Context(), login)
	if err != nil {
		internalError(w, r, err)
		return
	}
	http.Redirect(w, r, authURL(&s.login.oauthV1, login, issuerState), http.StatusFound)
}

func (s *server) authCallback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	state := q.Get("state")
	login, err := s.bus.PendingLogin(r.Context(), state)
	if errs.KindOf(err) == errs.NotFound {
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
	issuer, subject, err := s.login.identify(r.Context(), &s.login.oauthV1, login, q.Get("code"))
	if err != nil {
		logline.SetError(r.Context(), err)
		fail("login_failed")
		return
	}
	code, err := s.bus.CompleteLogin(r.Context(), state, issuer, subject)
	if err != nil {
		logline.SetError(r.Context(), err)
		fail("login_failed")
		return
	}
	http.Redirect(w, r, withQuery(login.RedirectURI, map[string]string{"code": code, "state": login.ClientState}), http.StatusFound)
}

type tokensBody struct {
	AccessToken  string    `json:"accessToken"`
	RefreshToken string    `json:"refreshToken"`
	ExpiresIn    int       `json:"expiresIn"`
	UserID       uuid.UUID `json:"userId"`
	DeviceID     uuid.UUID `json:"deviceId"`
}

func tokensView(t bus.Tokens) tokensBody {
	return tokensBody{
		AccessToken: t.Access, RefreshToken: t.Refresh, ExpiresIn: int(bus.AccessTTL.Seconds()),
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
	tokens, err := s.bus.RedeemLogin(r.Context(), body.Code, body.CodeVerifier, body.DeviceName)
	if errs.KindOf(err) == errs.NotFound {
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
	tokens, err := s.bus.RefreshSession(r.Context(), body.RefreshToken)
	if errs.KindOf(err) == errs.Unauthenticated {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, tokensView(tokens))
}
