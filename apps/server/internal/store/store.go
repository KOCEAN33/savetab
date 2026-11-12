// Package store is the server's Postgres access.
package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/base64"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrations embed.FS

// migrationLock is the advisory lock key that keeps two starting servers from migrating at once.
const migrationLock = 7283910455

type Store struct {
	pool *pgxpool.Pool
}

func Open(ctx context.Context, url string) (*Store, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() { s.pool.Close() }

func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// Migrate applies every embedded migration not yet recorded, in file name order.
func (s *Store) Migrate(ctx context.Context) error {
	names, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(names)
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, migrationLock); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)`); err != nil {
			return err
		}
		for _, name := range names {
			var done bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = $1)`, name).Scan(&done); err != nil {
				return err
			}
			if done {
				continue
			}
			sql, err := migrations.ReadFile(name)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, string(sql)); err != nil {
				return fmt.Errorf("%s: %w", name, err)
			}
			if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (name) VALUES ($1)`, name); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Store) CreateUser(ctx context.Context) (id string, err error) {
	err = s.pool.QueryRow(ctx, `INSERT INTO users DEFAULT VALUES RETURNING id`).Scan(&id)
	return id, err
}

func (s *Store) CreateDevice(ctx context.Context, userID, name string) (id string, err error) {
	err = s.pool.QueryRow(ctx, `INSERT INTO devices (user_id, name) VALUES ($1, $2) RETURNING id`, userID, name).Scan(&id)
	return id, err
}

type Device struct {
	ID        string
	Name      string
	CreatedAt time.Time
}

// Devices returns the user's devices that are not revoked, oldest first.
func (s *Store) Devices(ctx context.Context, userID string) ([]Device, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, created_at FROM devices
		WHERE user_id = $1 AND revoked_at IS NULL
		ORDER BY created_at, id`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Device, error) {
		var d Device
		err := row.Scan(&d.ID, &d.Name, &d.CreatedAt)
		return d, err
	})
}

// RevokeDevice revokes one of the user's devices, which ends its sessions. A device of another
// user and one already revoked give ErrNotFound.
func (s *Store) RevokeDevice(ctx context.Context, userID, deviceID string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE devices SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
		deviceID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

type SessionKind string

const (
	Access  SessionKind = "access"
	Refresh SessionKind = "refresh"
)

func hashToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

func randomToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

type execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func issueSession(ctx context.Context, db execer, deviceID string, kind SessionKind, ttl time.Duration) (string, error) {
	token, err := randomToken()
	if err != nil {
		return "", err
	}
	_, err = db.Exec(ctx,
		`INSERT INTO sessions (token_hash, device_id, kind, expires_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
		hashToken(token), deviceID, string(kind), ttl.Seconds())
	return token, err
}

// IssueSession makes an opaque token for the device. Only its hash is stored.
func (s *Store) IssueSession(ctx context.Context, deviceID string, kind SessionKind, ttl time.Duration) (string, error) {
	return issueSession(ctx, s.pool, deviceID, kind, ttl)
}

// Caller is the device and user an access token stands for.
type Caller struct {
	DeviceID string
	UserID   string
}

var ErrNoSession = errors.New("no such session")

// Authenticate resolves an access token. An expired token, a refresh token, and a token of a
// revoked device all give ErrNoSession.
func (s *Store) Authenticate(ctx context.Context, token string) (Caller, error) {
	var c Caller
	err := s.pool.QueryRow(ctx, `
		SELECT d.id, d.user_id
		FROM sessions s JOIN devices d ON d.id = s.device_id
		WHERE s.token_hash = $1 AND s.kind = 'access' AND s.expires_at > now() AND d.revoked_at IS NULL`,
		hashToken(token)).Scan(&c.DeviceID, &c.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Caller{}, ErrNoSession
	}
	return c, err
}
