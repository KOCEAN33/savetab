package api_test

import (
	"crypto/rand"
	"crypto/rsa"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/api"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/fakeoidc"
)

func TestStartingAnAuthorizationSendsTheBrowserToTheIssuer(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	s.issuer.Set(fakeoidc.Behavior{Subject: "v2-" + secret(t)})
	r := call(t, s, "GET", authorizationPath(extensionRedirect, challengeOf(secret(t)), "s"), "", nil)
	if !wantStatus(t, "start", r, http.StatusFound) {
		return
	}
	location, err := url.Parse(r.header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if got := location.Scheme + "://" + location.Host + location.Path; got != s.issuer.URL+"/authorize" {
		t.Errorf("start redirects to %s, want the issuer's authorization endpoint %s", got, s.issuer.URL+"/authorize")
	}
}

func TestSignInMakesAUserAndADeviceWhoseTokenWorks(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	subject := "v2-" + secret(t)
	code, verifier := loginCode(t, s, subject)
	r := createTokens(t, s, codeGrant(code, verifier, "Alice's laptop"))
	if !wantStatus(t, "token", r, http.StatusOK) {
		return
	}
	got := readJSON[api.Tokens](t, r)
	if got.AccessToken == "" || got.RefreshToken == "" || got.AccessToken == got.RefreshToken || got.ExpiresIn <= 0 {
		t.Errorf("tokens = %+v, want an access token, a different refresh token, and a positive expires_in", got)
	}
	devices := readJSON[api.DeviceList](t, must(t, "list devices", call(t, s, "GET", "/v2/devices", got.AccessToken, nil), http.StatusOK)).Devices
	if len(devices) != 1 || devices[0].Id != got.DeviceId || devices[0].Name != "Alice's laptop" || !devices[0].Current {
		t.Errorf("devices = %+v, want only the current device %s named %q", devices, got.DeviceId, "Alice's laptop")
	}

	second := signIn(t, s, subject, "phone")
	stranger := newMember(t, s)
	if second.user != got.UserId.String() || second.device == got.DeviceId.String() {
		t.Errorf("a second sign-in of the subject = user %s device %s, want user %s and another device than %s", second.user, second.device, got.UserId, got.DeviceId)
	}
	if stranger.user == got.UserId.String() {
		t.Errorf("another subject got the same user %s", stranger.user)
	}
}

func TestStartAuthorizationRefusesARedirectURIOutsideTheList(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	challenge := challengeOf(secret(t))
	for name, path := range map[string]string{
		"unlisted redirect uri":    authorizationPath("https://evil.example/", challenge, "s"),
		"listed uri with a suffix": authorizationPath(extensionRedirect+"x", challenge, "s"),
		"no redirect uri":          "/v2/authorizations?" + url.Values{"code_challenge": {challenge}, "state": {"s"}}.Encode(),
	} {
		wantProblem(t, name, call(t, s, "GET", path, "", nil), http.StatusBadRequest)
	}
}

func TestStartAuthorizationRefusesABadCodeChallengeOrState(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	challenge := challengeOf(secret(t))
	for name, path := range map[string]string{
		"no code challenge":                 "/v2/authorizations?" + url.Values{"redirect_uri": {extensionRedirect}, "state": {"s"}}.Encode(),
		"short code challenge":              authorizationPath(extensionRedirect, "abc", "s"),
		"44 character code challenge":       authorizationPath(extensionRedirect, challenge+"A", "s"),
		"code challenge in standard base64": authorizationPath(extensionRedirect, "+"+challenge[1:], "s"),
		"no state":                          "/v2/authorizations?" + url.Values{"redirect_uri": {extensionRedirect}, "code_challenge": {challenge}}.Encode(),
		"empty state":                       authorizationPath(extensionRedirect, challenge, ""),
		"state of 513 characters":           authorizationPath(extensionRedirect, challenge, strings.Repeat("s", 513)),
	} {
		wantProblem(t, name, call(t, s, "GET", path, "", nil), http.StatusBadRequest)
	}
}

func TestCallbackRefusesAStateItDidNotIssueOrThatExpired(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	callback := func(state string) string {
		return "/v2/authorizations/callback?" + url.Values{"state": {state}, "code": {"anything"}}.Encode()
	}
	wantProblem(t, "unknown state", call(t, s, "GET", callback("nope-"+secret(t)), "", nil), http.StatusBadRequest)

	expired := "expired-" + secret(t)
	execSQL(t, s, `INSERT INTO logins (state_hash, redirect_uri, client_state, code_challenge, nonce, issuer_verifier, expires_at)
		VALUES ($1, $2, 's', $3, 'n', 'iv', now() - interval '1 minute')`, sha256Of(expired), extensionRedirect, challengeOf("v"))
	wantProblem(t, "expired state", call(t, s, "GET", callback(expired), "", nil), http.StatusBadRequest)
}

func TestIssuerRefusalReturnsAccessDeniedWithTheState(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	s.issuer.Set(fakeoidc.Behavior{Subject: "v2-" + secret(t), Deny: true})
	state := secret(t)
	got := returned(t, visit(t, s, authorizationPath(extensionRedirect, challengeOf(secret(t)), state)))
	if got.Get("error") != "access_denied" || got.Get("state") != state || got.Has("code") {
		t.Errorf("the login returned %v, want error access_denied, state %q, and no code", got, state)
	}
}

func TestIssuerAnswerThatDoesNotHoldReturnsLoginFailed(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	other, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	for name, behavior := range map[string]fakeoidc.Behavior{
		"signed by another key": {SignWith: other},
		"expired id token":      {Claims: func(c map[string]any) { c["exp"] = time.Now().Add(-time.Hour).Unix() }},
	} {
		behavior.Subject = "v2-" + secret(t)
		s.issuer.Set(behavior)
		state := secret(t)
		got := returned(t, visit(t, s, authorizationPath(extensionRedirect, challengeOf(secret(t)), state)))
		if got.Get("error") != "login_failed" || got.Get("state") != state || got.Has("code") {
			t.Errorf("%s: the login returned %v, want error login_failed, state %q, and no code", name, got, state)
		}
	}
}

func TestLoginCodeIsSpentByOneAttempt(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	subject := "v2-" + secret(t)

	code, verifier := loginCode(t, s, subject)
	wantStatus(t, "first attempt", createTokens(t, s, codeGrant(code, verifier, "desktop")), http.StatusOK)
	wantProblem(t, "the spent code again", createTokens(t, s, codeGrant(code, verifier, "desktop")), http.StatusBadRequest)

	code, verifier = loginCode(t, s, subject)
	wantProblem(t, "a wrong code_verifier", createTokens(t, s, codeGrant(code, secret(t), "desktop")), http.StatusBadRequest)
	wantProblem(t, "the right code_verifier after a wrong one", createTokens(t, s, codeGrant(code, verifier, "desktop")), http.StatusBadRequest)
}

func TestRefreshTokenIsSpentByOneAttempt(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	first := newMember(t, s)

	r := createTokens(t, s, refreshGrant(first.refresh))
	if !wantStatus(t, "first attempt", r, http.StatusOK) {
		return
	}
	second := readJSON[api.Tokens](t, r)
	if second.UserId.String() != first.user || second.DeviceId.String() != first.device {
		t.Errorf("refresh gave user %s device %s, want %s %s", second.UserId, second.DeviceId, first.user, first.device)
	}
	if second.AccessToken == first.access || second.RefreshToken == first.refresh || second.AccessToken == "" || second.ExpiresIn <= 0 {
		t.Errorf("refresh gave %+v, want a new token pair", second)
	}
	wantStatus(t, "the new access token", call(t, s, "GET", "/v2/devices", second.AccessToken, nil), http.StatusOK)
	wantProblem(t, "the spent refresh token again", createTokens(t, s, refreshGrant(first.refresh)), http.StatusUnauthorized)
	wantStatus(t, "the new refresh token", createTokens(t, s, refreshGrant(second.RefreshToken)), http.StatusOK)
}

func TestTokenRequestMissingAFieldOfItsGrantIsInvalid(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	code, verifier := loginCode(t, s, "v2-"+secret(t))
	for name, body := range map[string]map[string]any{
		"no grant_type":      {"code": code, "code_verifier": verifier, "device_name": "desktop"},
		"unknown grant_type": {"grant_type": "password", "code": code, "code_verifier": verifier, "device_name": "desktop"},
		"no code":            {"grant_type": "authorization_code", "code_verifier": verifier, "device_name": "desktop"},
		"no code_verifier":   {"grant_type": "authorization_code", "code": code, "device_name": "desktop"},
		"no device_name":     {"grant_type": "authorization_code", "code": code, "code_verifier": verifier},
		"empty device_name":  {"grant_type": "authorization_code", "code": code, "code_verifier": verifier, "device_name": ""},
		"no refresh_token":   {"grant_type": "refresh_token"},
	} {
		wantProblem(t, name, createTokens(t, s, body), http.StatusBadRequest)
	}
}

func TestDeviceNameOver100CharactersIsInvalid(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	subject := "v2-" + secret(t)
	code, verifier := loginCode(t, s, subject)
	wantProblem(t, "101 characters", createTokens(t, s, codeGrant(code, verifier, strings.Repeat("n", 101))), http.StatusBadRequest)

	code, verifier = loginCode(t, s, subject)
	wantStatus(t, "100 characters", createTokens(t, s, codeGrant(code, verifier, strings.Repeat("n", 100))), http.StatusOK)
}
