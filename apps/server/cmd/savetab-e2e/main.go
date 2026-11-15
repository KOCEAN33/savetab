// Command savetab-e2e serves the sync API for the extension's e2e tests. It makes its own
// database on the Postgres that TEST_DATABASE_URL names, logs every visitor in as one user
// through an issuer it runs itself, prints its URL as the first line of stdout, and drops the
// database when it is told to stop. Its arguments are the redirect URIs a login may end at.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/platform/config"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/fakeoidc"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/testdb"
	"github.com/KOCEAN33/savetab/apps/server/internal/wire"
)

func main() {
	if err := run(); err != nil {
		slog.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	dbURL, drop, err := testdb.Start()
	if err != nil {
		return err
	}
	defer drop()

	issuer := fakeoidc.New("savetab")
	defer issuer.Close()
	issuer.Set(fakeoidc.Behavior{Subject: "e2e"})

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	url := "http://" + listener.Addr().String()
	cfg := config.Config{
		DatabaseURL:      config.Secret(dbURL),
		DBPoolMax:        4,
		ListenAddr:       listener.Addr().String(),
		PublicURL:        url,
		OIDCIssuer:       issuer.URL,
		OIDCClientID:     "savetab",
		AuthRedirectURIs: os.Args[1:],
		StartWait:        30 * time.Second,
		RequestDeadline:  10 * time.Second,
		ReadyPingTimeout: time.Second,
		HTTPDrainTimeout: 15 * time.Second,
		ShutdownBudget:   20 * time.Second,
	}
	// A request sent before the database is migrated waits in the listener's queue.
	fmt.Println(url)
	return wire.Run(context.Background(), cfg, wire.Options{Listener: listener})
}
