package api_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/fakeoidc"
	"github.com/KOCEAN33/savetab/apps/server/internal/store"
)

const (
	clientID          = "savetab"
	clientSecret      = "issuer-secret"
	extensionRedirect = "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/"
)

var issuer *fakeoidc.Issuer

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func s256(verifier string) string {
	h := sha256.Sum256([]byte(verifier))
	return b64(h[:])
}

func randomString(t *testing.T) string {
	t.Helper()
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return b64(b)
}

type tokens struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresIn    int    `json:"expiresIn"`
	UserID       string `json:"userId"`
	DeviceID     string `json:"deviceId"`
}

// browse follows redirects the way the login window does, and stops at the first response
// that is not a redirect or that redirects to the extension. It returns that response.
func browse(t *testing.T, target string) *http.Response {
	t.Helper()
	client := &http.Client{CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if strings.HasPrefix(req.URL.String(), extensionRedirect) {
			return http.ErrUseLastResponse
		}
		return nil
	}}
	res, err := client.Get(target)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}

func startURL(redirectURI, challenge, state string) string {
	return srv.URL + "/v1/auth/start?" + url.Values{"redirect_uri": {redirectURI}, "code_challenge": {challenge}, "state": {state}}.Encode()
}

// landing reads the query the login window ends with at the extension's redirect URI.
func landing(t *testing.T, res *http.Response) url.Values {
	t.Helper()
	location := res.Header.Get("Location")
	if res.StatusCode != http.StatusFound || !strings.HasPrefix(location, extensionRedirect) {
		t.Fatalf("login ended with status %d at %q, want a redirect to the extension", res.StatusCode, location)
	}
	u, err := url.Parse(location)
	if err != nil {
		t.Fatal(err)
	}
	return u.Query()
}

// authorizeAs runs the login window as subject and returns the code the extension receives
// with the verifier that redeems it.
func authorizeAs(t *testing.T, subject string) (code, verifier string) {
	t.Helper()
	issuer.Set(fakeoidc.Behavior{Subject: subject})
	verifier = randomString(t)
	state := randomString(t)
	got := landing(t, browse(t, startURL(extensionRedirect, s256(verifier), state)))
	if got.Get("state") != state || got.Get("code") == "" || got.Get("error") != "" {
		t.Fatalf("login landed with %v, want a code and state %q", got, state)
	}
	return got.Get("code"), verifier
}

func redeem(t *testing.T, code, verifier, deviceName string) *http.Response {
	t.Helper()
	return request(t, "POST", "/v1/auth/token", "", map[string]string{"code": code, "codeVerifier": verifier, "deviceName": deviceName})
}

func logIn(t *testing.T, subject, deviceName string) tokens {
	t.Helper()
	code, verifier := authorizeAs(t, subject)
	res := redeem(t, code, verifier, deviceName)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("redeem: status %d, want 200", res.StatusCode)
	}
	return decode[tokens](t, res)
}

func (tk tokens) device() device { return device{id: tk.DeviceID, token: tk.AccessToken} }

func TestLoginMakesAUserAndADevice(t *testing.T) {
	got := logIn(t, "alice-"+randomString(t), "Alice's laptop")
	if got.AccessToken == "" || got.RefreshToken == "" || got.AccessToken == got.RefreshToken {
		t.Fatalf("tokens = %+v, want an access and a different refresh token", got)
	}
	if got.ExpiresIn != 3600 {
		t.Errorf("expiresIn = %d, want 3600", got.ExpiresIn)
	}
	// A pairing reports the device it came from, which shows whose token this is.
	started := startPairing(t, got.device(), commitmentOf("x"))
	if started.NewDeviceID != got.DeviceID || started.NewDeviceName != "Alice's laptop" {
		t.Errorf("the access token acts as device %s %q, want %s %q", started.NewDeviceID, started.NewDeviceName, got.DeviceID, "Alice's laptop")
	}
	if ops := pull(t, got.device(), "").Ops; len(ops) != 0 {
		t.Errorf("a new user's log has %d ops", len(ops))
	}
}

func TestSecondLoginOfOneIdentityMakesASecondDeviceOfTheSameUser(t *testing.T) {
	subject := "bob-" + randomString(t)
	first, second := logIn(t, subject, "desktop"), logIn(t, subject, "phone")
	stranger := logIn(t, "carol-"+randomString(t), "desktop")

	if second.UserID != first.UserID || second.DeviceID == first.DeviceID {
		t.Errorf("second login = user %s device %s, want user %s and a device other than %s", second.UserID, second.DeviceID, first.UserID, first.DeviceID)
	}
	if stranger.UserID == first.UserID {
		t.Errorf("another subject got the same user %s", first.UserID)
	}
	push(t, first.device(), op{opID(1), []byte("from desktop")})
	got := pull(t, second.device(), "").Ops
	if len(got) != 1 || string(got[0].Data) != "from desktop" || got[0].DeviceID != first.DeviceID {
		t.Errorf("the second device pulled %+v, want the first device's op", got)
	}
	if got := pull(t, stranger.device(), "").Ops; len(got) != 0 {
		t.Errorf("another subject pulled %d ops, want 0", len(got))
	}
}

func refresh(t *testing.T, token string) *http.Response {
	t.Helper()
	return request(t, "POST", "/v1/auth/refresh", "", map[string]string{"refreshToken": token})
}

func TestUsedRefreshTokenIsRejected(t *testing.T) {
	first := logIn(t, "dave-"+randomString(t), "desktop")

	res := refresh(t, first.RefreshToken)
	expect(t, "first use", res, http.StatusOK, "")
	second := decode[tokens](t, res)
	if second.RefreshToken == first.RefreshToken || second.AccessToken == first.AccessToken || second.AccessToken == "" {
		t.Fatalf("refresh returned %+v, want new tokens", second)
	}
	if second.UserID != first.UserID || second.DeviceID != first.DeviceID || second.ExpiresIn != 3600 {
		t.Errorf("refresh returned user %s device %s expiresIn %d, want %s %s 3600", second.UserID, second.DeviceID, second.ExpiresIn, first.UserID, first.DeviceID)
	}
	expect(t, "pull with the new access token", request(t, "GET", "/v1/ops", second.AccessToken, nil), http.StatusOK, "")

	expect(t, "second use", refresh(t, first.RefreshToken), http.StatusUnauthorized, "unauthorized")
	expect(t, "an access token as a refresh token", refresh(t, second.AccessToken), http.StatusUnauthorized, "unauthorized")
	expect(t, "no token", refresh(t, ""), http.StatusUnauthorized, "unauthorized")
	expect(t, "the replacement", refresh(t, second.RefreshToken), http.StatusOK, "")
}

func TestRefreshTokenOfARevokedDeviceIsRejected(t *testing.T) {
	got := logIn(t, "erin-"+randomString(t), "desktop")
	if err := db.RevokeDevice(context.Background(), got.DeviceID); err != nil {
		t.Fatal(err)
	}
	expect(t, "refresh", refresh(t, got.RefreshToken), http.StatusUnauthorized, "unauthorized")
}

func TestLoginCodeIsSpentByOneAttemptAndNeedsItsVerifier(t *testing.T) {
	subject := "frank-" + randomString(t)

	code, verifier := authorizeAs(t, subject)
	expect(t, "first redeem", redeem(t, code, verifier, "desktop"), http.StatusOK, "")
	expect(t, "second redeem", redeem(t, code, verifier, "desktop"), http.StatusBadRequest, "invalid_grant")

	code, verifier = authorizeAs(t, subject)
	expect(t, "another verifier", redeem(t, code, randomString(t), "desktop"), http.StatusBadRequest, "invalid_grant")
	expect(t, "the right verifier after a wrong one", redeem(t, code, verifier, "desktop"), http.StatusBadRequest, "invalid_grant")

	expect(t, "unknown code", redeem(t, "nope", verifier, "desktop"), http.StatusBadRequest, "invalid_grant")
	code, verifier = authorizeAs(t, subject)
	expect(t, "no device name", redeem(t, code, verifier, ""), http.StatusBadRequest, "bad_request")
}

func TestStartRefusesARedirectURIOutsideTheList(t *testing.T) {
	issuer.Set(fakeoidc.Behavior{Subject: "mallory"})
	challenge := s256(randomString(t))
	for name, target := range map[string]string{
		"unlisted redirect uri":    startURL("https://evil.example/", challenge, "s"),
		"listed uri with a suffix": startURL(extensionRedirect+"x", challenge, "s"),
		"no redirect uri":          startURL("", challenge, "s"),
	} {
		expect(t, name, browse(t, target), http.StatusBadRequest, "invalid_redirect_uri")
	}
	for name, target := range map[string]string{
		"no code challenge":    startURL(extensionRedirect, "", "s"),
		"short code challenge": startURL(extensionRedirect, "abc", "s"),
		"no state":             startURL(extensionRedirect, challenge, ""),
	} {
		expect(t, name, browse(t, target), http.StatusBadRequest, "bad_request")
	}
}

func TestLoginFailsWhenTheIssuersAnswerDoesNotHold(t *testing.T) {
	other, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	claims := func(edit func(map[string]any)) fakeoidc.Behavior {
		return fakeoidc.Behavior{Subject: "grace", Claims: edit}
	}
	faults := map[string]struct {
		behavior fakeoidc.Behavior
		code     string
	}{
		"the user refuses":         {fakeoidc.Behavior{Subject: "grace", Deny: true}, "access_denied"},
		"signed by another key":    {fakeoidc.Behavior{Subject: "grace", SignWith: other}, "login_failed"},
		"issued to another client": {claims(func(c map[string]any) { c["aud"] = "another-client" }), "login_failed"},
		"issued by another issuer": {claims(func(c map[string]any) { c["iss"] = "https://evil.example" }), "login_failed"},
		"nonce of another login":   {claims(func(c map[string]any) { c["nonce"] = "replayed" }), "login_failed"},
		"expired id token":         {claims(func(c map[string]any) { c["exp"] = time.Now().Add(-time.Hour).Unix() }), "login_failed"},
	}
	for name, fault := range faults {
		issuer.Set(fault.behavior)
		state := randomString(t)
		got := landing(t, browse(t, startURL(extensionRedirect, s256(randomString(t)), state)))
		if got.Get("error") != fault.code || got.Get("code") != "" || got.Get("state") != state {
			t.Errorf("%s: landed with %v, want error %q, state %q, and no code", name, got, fault.code, state)
		}
	}
}

func TestCallbackRefusesAStateItDidNotIssue(t *testing.T) {
	callback := func(state string) string {
		return srv.URL + "/v1/auth/callback?" + url.Values{"state": {state}, "code": {"anything"}}.Encode()
	}
	expect(t, "unknown state", browse(t, callback("nope")), http.StatusBadRequest, "invalid_state")

	expired, err := db.CreateLogin(context.Background(), store.Login{
		RedirectURI: extensionRedirect, ClientState: "s", CodeChallenge: s256("v"), Nonce: "n", IssuerVerifier: "iv",
	}, -time.Second)
	if err != nil {
		t.Fatal(err)
	}
	expect(t, "expired login", browse(t, callback(expired)), http.StatusBadRequest, "invalid_state")
}
