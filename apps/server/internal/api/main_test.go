package api_test

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/api"
	"github.com/KOCEAN33/savetab/apps/server/internal/bus"
	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/KOCEAN33/savetab/apps/server/internal/httpserver"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/fakeoidc"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/testdb"
	"github.com/KOCEAN33/savetab/apps/server/internal/wire"
)

const (
	clientID          = "savetab"
	extensionRedirect = "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/"
)

var (
	store *db.Store
	// login runs against issuer and redirects the issuer back to srv.
	login  *api.Login
	issuer *fakeoidc.Issuer
	// srv is the whole server as wire builds it: the engine, /v1, and /v2.
	srv   *httptest.Server
	dbURL string
)

var serverConfig = httpserver.Config{RequestDeadline: 10 * time.Second, ReadyPingTimeout: time.Second}

func TestMain(m *testing.M) {
	os.Exit(run(m))
}

func run(m *testing.M) int {
	url, stop, err := testdb.Start()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stop()
	dbURL = url
	ctx := context.Background()
	if store, err = db.Open(ctx, url, db.Options{MaxConns: 4, StatementTimeout: 5 * time.Second, IdleInTxTimeout: 10 * time.Second}); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer store.Close()
	if err := store.Migrate(ctx); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	issuer = fakeoidc.New(clientID)
	defer issuer.Close()
	// The login needs the server's URL, which exists only once the server listens.
	var handler http.Handler
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { handler.ServeHTTP(w, r) }))
	defer srv.Close()
	login, err = api.NewLogin(ctx, api.LoginConfig{
		Issuer: issuer.URL, ClientID: clientID,
		PublicURL: srv.URL, RedirectURIs: []string{extensionRedirect},
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	whole, err := wire.NewServer(serverConfig, slog.New(slog.DiscardHandler), bus.New(store), login)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	handler = whole.Handler
	return m.Run()
}
