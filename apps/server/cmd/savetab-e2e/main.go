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
	"slices"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/config"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/fakeoidc"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/logline"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/testdb"
	"github.com/KOCEAN33/savetab/apps/server/internal/wire"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// process stands in for the test that testdb.New takes: its cleanups run when the process ends.
type process struct{ cleanups []func() }

func (p *process) Cleanup(f func()) { p.cleanups = append(p.cleanups, f) }
func (p *process) Failed() bool     { return false }
func (p *process) Helper()          {}

// The log of a test database names its URL, password included.
func (p *process) Logf(string, ...any) {}

func (p *process) Fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	p.end()
	os.Exit(1)
}

func (p *process) end() {
	for _, f := range slices.Backward(p.cleanups) {
		f()
	}
}

func run() error {
	var p process
	defer p.end()
	dbURL := testdb.New(&p, db.MigrationsHash, db.MigrateURL)

	issuer := fakeoidc.New("savetab")
	defer issuer.Close()
	issuer.Set(fakeoidc.Behavior{Subject: "e2e"})

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	url := "http://" + listener.Addr().String()
	cfg := config.Config{
		DatabaseURL:        config.Secret(dbURL),
		DBPoolMax:          4,
		DBStatementTimeout: 5 * time.Second,
		DBIdleInTxTimeout:  10 * time.Second,
		ListenAddr:         listener.Addr().String(),
		PublicURL:          url,
		OIDCIssuer:         issuer.URL,
		OIDCClientID:       "savetab",
		AuthRedirectURIs:   os.Args[1:],
		StartWait:          30 * time.Second,
		RequestDeadline:    10 * time.Second,
		ReadyPingTimeout:   time.Second,
		HTTPDrainTimeout:   15 * time.Second,
		ShutdownBudget:     20 * time.Second,
		LogFormat:          logline.FormatConsole,
		// A test run shows only the requests the server failed.
		LogLevel: slog.LevelWarn,
	}
	// A request sent before the database is migrated waits in the listener's queue.
	fmt.Println(url)
	// Stdout holds only the URL line, so the log goes to stderr.
	return wire.Run(context.Background(), cfg, wire.Options{Listener: listener, Log: os.Stderr, Version: "e2e", Commit: "e2e"})
}
