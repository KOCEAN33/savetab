// Command savetab-e2e serves the sync API for the extension's e2e tests. It makes its own
// database on the Postgres that TEST_DATABASE_URL names, logs every visitor in as one user
// through an issuer it runs itself, prints its URL as the first line of stdout, and drops the
// database when it is told to stop.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/api"
	"github.com/KOCEAN33/savetab/apps/server/internal/fakeoidc"
	"github.com/KOCEAN33/savetab/apps/server/internal/store"
	"github.com/KOCEAN33/savetab/apps/server/internal/testdb"
)

func main() {
	if err := run(); err != nil {
		slog.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	dbURL, drop, err := testdb.Start()
	if err != nil {
		return err
	}
	defer drop()
	db, err := store.Open(ctx, dbURL)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := db.Migrate(ctx); err != nil {
		return err
	}

	issuer := fakeoidc.New("savetab", "issuer-secret")
	defer issuer.Close()
	issuer.Set(fakeoidc.Behavior{Subject: "e2e"})

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	url := "http://" + listener.Addr().String()
	login, err := api.NewLogin(ctx, api.LoginConfig{
		Issuer: issuer.URL, ClientID: "savetab", ClientSecret: "issuer-secret",
		PublicURL: url, RedirectURIs: strings.Fields(os.Getenv("AUTH_REDIRECT_URIS")),
	})
	if err != nil {
		return err
	}

	srv := &http.Server{Handler: api.New(db, login), ReadHeaderTimeout: 10 * time.Second}
	failed := make(chan error, 1)
	go func() { failed <- srv.Serve(listener) }()
	fmt.Println(url)
	select {
	case err := <-failed:
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdown); err != nil && !errors.Is(err, context.DeadlineExceeded) {
			return err
		}
		return nil
	}
}
