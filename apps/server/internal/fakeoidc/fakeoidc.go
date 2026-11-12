// Package fakeoidc is an OIDC issuer for tests: the Go tests of the login and the server the
// extension's e2e tests run against.
package fakeoidc

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"time"
)

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func s256(verifier string) string {
	h := sha256.Sum256([]byte(verifier))
	return b64(h[:])
}

type grant struct {
	subject, nonce, challenge, redirectURI string
}

// Behavior is what the issuer does with a visitor.
type Behavior struct {
	// Subject is who every visitor is logged in as.
	Subject string
	// Deny makes the issuer answer as if the user refused.
	Deny bool
	// SignWith and Claims make the issuer send an ID token the server must refuse.
	SignWith *rsa.PrivateKey
	Claims   func(map[string]any)
}

// Issuer is an OIDC issuer that logs every visitor in without asking.
type Issuer struct {
	// URL is the issuer URL, the value of OIDC_ISSUER.
	URL string

	srv          *httptest.Server
	key          *rsa.PrivateKey
	clientID     string
	clientSecret string
	mu           sync.Mutex
	next         int
	// codes holds the grants the token endpoint has not yet redeemed.
	codes    map[string]grant
	behavior Behavior
}

// New starts an issuer that knows one client.
func New(clientID, clientSecret string) *Issuer {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic(err)
	}
	f := &Issuer{key: key, clientID: clientID, clientSecret: clientSecret, codes: map[string]grant{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"issuer":                                f.srv.URL,
			"authorization_endpoint":                f.srv.URL + "/authorize",
			"token_endpoint":                        f.srv.URL + "/token",
			"jwks_uri":                              f.srv.URL + "/jwks",
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	mux.HandleFunc("GET /jwks", func(w http.ResponseWriter, r *http.Request) {
		pub := key.PublicKey
		json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kty": "RSA", "alg": "RS256", "use": "sig", "kid": "k1",
			"n": b64(pub.N.Bytes()), "e": b64(big.NewInt(int64(pub.E)).Bytes()),
		}}})
	})
	mux.HandleFunc("GET /authorize", f.authorize)
	mux.HandleFunc("POST /token", f.token)
	f.srv = httptest.NewServer(mux)
	f.URL = f.srv.URL
	return f
}

func (f *Issuer) Close() { f.srv.Close() }

// Set replaces the issuer's behavior for the visitors that follow.
func (f *Issuer) Set(b Behavior) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.behavior = b
}

func (f *Issuer) authorize(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	back, err := url.Parse(q.Get("redirect_uri"))
	if err != nil || q.Get("client_id") != f.clientID || q.Get("response_type") != "code" ||
		!strings.Contains(q.Get("scope"), "openid") || q.Get("code_challenge_method") != "S256" {
		http.Error(w, "bad authorization request", http.StatusBadRequest)
		return
	}
	params := url.Values{"state": {q.Get("state")}}
	f.mu.Lock()
	if f.behavior.Deny {
		params.Set("error", "access_denied")
	} else {
		f.next++
		code := "issuer-code-" + b64(big.NewInt(int64(f.next)).Bytes())
		f.codes[code] = grant{f.behavior.Subject, q.Get("nonce"), q.Get("code_challenge"), q.Get("redirect_uri")}
		params.Set("code", code)
	}
	f.mu.Unlock()
	back.RawQuery = params.Encode()
	http.Redirect(w, r, back.String(), http.StatusFound)
}

func (f *Issuer) token(w http.ResponseWriter, r *http.Request) {
	id, secret, basic := r.BasicAuth()
	if !basic {
		id, secret = r.PostFormValue("client_id"), r.PostFormValue("client_secret")
	}
	if unescaped, err := url.QueryUnescape(secret); err == nil {
		secret = unescaped
	}
	f.mu.Lock()
	g, ok := f.codes[r.PostFormValue("code")]
	delete(f.codes, r.PostFormValue("code"))
	key, edit := f.key, f.behavior.Claims
	if f.behavior.SignWith != nil {
		key = f.behavior.SignWith
	}
	f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if !ok || id != f.clientID || secret != f.clientSecret || r.PostFormValue("grant_type") != "authorization_code" ||
		r.PostFormValue("redirect_uri") != g.redirectURI || s256(r.PostFormValue("code_verifier")) != g.challenge {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant"})
		return
	}
	now := time.Now()
	claims := map[string]any{
		"iss": f.srv.URL, "sub": g.subject, "aud": f.clientID, "nonce": g.nonce,
		"iat": now.Unix(), "exp": now.Add(5 * time.Minute).Unix(),
	}
	if edit != nil {
		edit(claims)
	}
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT", "kid": "k1"})
	payload, _ := json.Marshal(claims)
	signed := b64(header) + "." + b64(payload)
	digest := sha256.Sum256([]byte(signed))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		panic(err)
	}
	json.NewEncoder(w).Encode(map[string]any{
		"access_token": "issuer-access-token", "token_type": "Bearer", "expires_in": 300,
		"id_token": signed + "." + b64(sig),
	})
}
