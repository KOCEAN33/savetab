package api_test

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/api"
	"github.com/KOCEAN33/savetab/apps/server/internal/bus"
	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/KOCEAN33/savetab/apps/server/internal/httpserver"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/fakeoidc"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/logline"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/testdb"
	"github.com/KOCEAN33/savetab/apps/server/internal/wire"
)

const (
	clientID          = "savetab"
	extensionRedirect = "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/"
)

var serverConfig = httpserver.Config{RequestDeadline: 10 * time.Second, ReadyPingTimeout: time.Second}

// server is the whole server as wire builds it, the engine and /v2, on a database of its own.
type server struct {
	URL string
	// The server's login runs against issuer.
	issuer *fakeoidc.Issuer
	dbURL  string
	// log holds the request lines.
	log *lockedBuffer
}

func newServer(t *testing.T) *server {
	t.Helper()
	ctx := context.Background()
	s := &server{dbURL: testdb.New(t, db.MigrationsHash, db.MigrateURL), log: &lockedBuffer{}}
	store, err := db.Open(ctx, s.dbURL, db.Options{MaxConns: 4, StatementTimeout: 5 * time.Second, IdleInTxTimeout: 10 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.Close)
	s.issuer = fakeoidc.New(clientID)
	t.Cleanup(s.issuer.Close)
	// The login needs the server's URL, which exists only once the server listens.
	var handler http.Handler
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { handler.ServeHTTP(w, r) }))
	t.Cleanup(srv.Close)
	s.URL = srv.URL
	login, err := api.NewLogin(ctx, api.LoginConfig{
		Issuer: s.issuer.URL, ClientID: clientID,
		PublicURL: srv.URL, RedirectURIs: []string{extensionRedirect},
	})
	if err != nil {
		t.Fatal(err)
	}
	logger := logline.NewLogger(s.log, logline.FormatJSON, slog.LevelInfo, logline.Process{})
	whole, err := wire.NewServer(serverConfig, logger, bus.New(store), login)
	if err != nil {
		t.Fatal(err)
	}
	handler = whole.Handler
	return s
}
