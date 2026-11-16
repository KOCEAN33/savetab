// Package testdb gives each test a database of its own on the Postgres that
// TEST_DATABASE_URL names.
package testdb

import (
	"context"
	"database/sql"
	"net/url"
	"os"
	"strings"

	// The database/sql driver pgtestdb connects with.
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/peterldowns/pgtestdb"
)

// TB is what New needs of a *testing.T.
type TB = pgtestdb.TB

type migrator struct {
	hash    func() (string, error)
	migrate func(ctx context.Context, url string) error
}

func (m migrator) Hash() (string, error) { return m.hash() }

func (m migrator) Migrate(ctx context.Context, _ *sql.DB, template pgtestdb.Config) error {
	return m.migrate(ctx, template.URL())
}

// New returns the URL of a new database and drops it when the test ends. The database is a
// clone of a template that migrate filled, and one template serves every test of the same
// hash. The role in TEST_DATABASE_URL needs CREATEDB and owns the database. A test without
// TEST_DATABASE_URL fails.
func New(t TB, hash func() (string, error), migrate func(ctx context.Context, url string) error) string {
	t.Helper()
	admin := os.Getenv("TEST_DATABASE_URL")
	if admin == "" {
		t.Fatalf("TEST_DATABASE_URL is not set: see apps/server/README.md")
	}
	u, err := url.Parse(admin)
	if err != nil {
		t.Fatalf("TEST_DATABASE_URL: %v", err)
	}
	password, _ := u.User.Password()
	conf := pgtestdb.Config{
		DriverName: "pgx",
		Host:       u.Hostname(),
		Port:       u.Port(),
		User:       u.User.Username(),
		Password:   password,
		Database:   strings.TrimPrefix(u.Path, "/"),
		Options:    u.RawQuery,
		// Without a role of its own, pgtestdb makes one, which takes CREATEROLE.
		TestRole: &pgtestdb.Role{Username: u.User.Username(), Password: password},
	}
	return pgtestdb.Custom(t, conf, migrator{hash: hash, migrate: migrate}).URL()
}
