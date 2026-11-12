// Package testdb gives each test run its own database on the Postgres that
// TEST_DATABASE_URL names.
package testdb

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"

	"github.com/jackc/pgx/v5"
)

// Start creates a database named savetab_test_<random> and returns its URL and a function
// that drops it. The role in TEST_DATABASE_URL needs CREATEDB.
func Start() (dbURL string, stop func(), err error) {
	admin := os.Getenv("TEST_DATABASE_URL")
	if admin == "" {
		return "", nil, errors.New("TEST_DATABASE_URL is not set: see apps/server/README.md")
	}
	u, err := url.Parse(admin)
	if err != nil {
		return "", nil, fmt.Errorf("TEST_DATABASE_URL: %w", err)
	}
	suffix := make([]byte, 6)
	if _, err := rand.Read(suffix); err != nil {
		return "", nil, err
	}
	name := "savetab_test_" + hex.EncodeToString(suffix)

	ctx := context.Background()
	exec := func(sql string) error {
		conn, err := pgx.Connect(ctx, admin)
		if err != nil {
			return err
		}
		defer conn.Close(ctx)
		_, err = conn.Exec(ctx, sql)
		return err
	}
	if err := exec("CREATE DATABASE " + name); err != nil {
		return "", nil, err
	}
	stop = func() {
		if err := exec("DROP DATABASE " + name + " WITH (FORCE)"); err != nil {
			fmt.Fprintln(os.Stderr, "testdb: drop", name, err)
		}
	}
	u.Path = "/" + name
	return u.String(), stop, nil
}
