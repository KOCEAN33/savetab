package config_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/caarlos0/env/v11"

	"github.com/KOCEAN33/savetab/apps/server/internal/platform/config"
)

const databaseURL = "postgres://savetab:hunter2@db.example:5432/savetab"

func secretFile(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "url")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// validEnvironment sets every required variable and no optional one.
func validEnvironment(t *testing.T) map[string]string {
	return map[string]string{
		"DATABASE_URL_FILE":  secretFile(t, databaseURL+"\n"),
		"LISTEN_ADDR":        ":8080",
		"PUBLIC_URL":         "https://savetab.example",
		"OIDC_ISSUER":        "https://auth.example",
		"OIDC_CLIENT_ID":     "399270715137720374",
		"AUTH_REDIRECT_URIS": "https://a.extensions.allizom.org/ https://b.chromiumapp.org/",
	}
}

func load(environ map[string]string) (config.Config, error) {
	return config.Load(env.Options{Environment: environ})
}

func TestLoadReadsTheEnvironmentAndFillsDefaults(t *testing.T) {
	t.Parallel()
	cfg, err := load(validEnvironment(t))
	if err != nil {
		t.Fatal(err)
	}
	want := config.Config{
		DatabaseURL:        databaseURL,
		DBPoolMax:          10,
		DBStatementTimeout: 5 * time.Second,
		DBIdleInTxTimeout:  10 * time.Second,
		ListenAddr:         ":8080",
		PublicURL:          "https://savetab.example",
		OIDCIssuer:         "https://auth.example",
		OIDCClientID:       "399270715137720374",
		AuthRedirectURIs:   []string{"https://a.extensions.allizom.org/", "https://b.chromiumapp.org/"},
		StartWait:          30 * time.Second,
		RequestDeadline:    10 * time.Second,
		ReadyPingTimeout:   time.Second,
		HTTPDrainTimeout:   15 * time.Second,
		ShutdownBudget:     20 * time.Second,
		LogFormat:          "json",
		LogLevel:           slog.LevelInfo,
	}
	if !reflect.DeepEqual(cfg, want) {
		t.Errorf("Load = %v, want %v", cfg, want)
	}
	if cfg.DatabaseURL.Reveal() != databaseURL {
		t.Errorf("DatabaseURL.Reveal() = %q, want the file's content without its newline", cfg.DatabaseURL.Reveal())
	}
}

func assertNamesAll(t *testing.T, err error, names ...string) {
	t.Helper()
	if err == nil {
		t.Fatalf("Load gave no error, want one naming %v", names)
	}
	for _, name := range names {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("error does not name %s: %v", name, err)
		}
	}
}

func TestLoadOnAnEmptyEnvironmentNamesEveryRequiredVariable(t *testing.T) {
	t.Parallel()
	_, err := load(map[string]string{})
	assertNamesAll(t, err, "DATABASE_URL_FILE", "LISTEN_ADDR", "PUBLIC_URL", "OIDC_ISSUER", "OIDC_CLIENT_ID", "AUTH_REDIRECT_URIS")
}

func TestLoadNamesEveryMalformedAndOutOfRangeValueAtOnce(t *testing.T) {
	t.Parallel()
	environ := validEnvironment(t)
	for name, value := range map[string]string{
		"DB_POOL_MAX":           "many",
		"DB_STATEMENT_TIMEOUT":  "5",
		"DB_IDLE_IN_TX_TIMEOUT": "long",
		"START_WAIT":            "soon",
		"REQUEST_DEADLINE":      "ten",
		"READY_PING_TIMEOUT":    "1 second",
		"HTTP_DRAIN_TIMEOUT":    "15",
		"SHUTDOWN_BUDGET":       "-",
		"PUBLIC_URL":            "savetab.example",
		"LOG_LEVEL":             "loud",
	} {
		environ[name] = value
	}
	_, err := load(environ)
	assertNamesAll(t, err, "DB_POOL_MAX", "DB_STATEMENT_TIMEOUT", "DB_IDLE_IN_TX_TIMEOUT", "START_WAIT", "REQUEST_DEADLINE", "READY_PING_TIMEOUT", "HTTP_DRAIN_TIMEOUT", "SHUTDOWN_BUDGET", "PUBLIC_URL", "LOG_LEVEL")
}

func TestLoadReadsTheLogSettings(t *testing.T) {
	t.Parallel()
	environ := validEnvironment(t)
	environ["LOG_FORMAT"] = "console"
	environ["LOG_LEVEL"] = "debug"
	cfg, err := load(environ)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.LogFormat != "console" || cfg.LogLevel != slog.LevelDebug {
		t.Errorf("LogFormat %q, LogLevel %v, want console and DEBUG", cfg.LogFormat, cfg.LogLevel)
	}
}

func TestLoadRejectsOutOfRangeValues(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name string
		set  map[string]string
		// secret, when set, is the content of the database URL file.
		secret string
		names  []string
	}{
		{"blank secret file", nil, "\n", []string{"DATABASE_URL_FILE"}},
		{"no pool connection", map[string]string{"DB_POOL_MAX": "0"}, "", []string{"DB_POOL_MAX"}},
		{"no start wait", map[string]string{"START_WAIT": "0s"}, "", []string{"START_WAIT"}},
		{"no statement timeout", map[string]string{"DB_STATEMENT_TIMEOUT": "0s"}, "", []string{"DB_STATEMENT_TIMEOUT"}},
		{"no idle in transaction timeout", map[string]string{"DB_IDLE_IN_TX_TIMEOUT": "0s"}, "", []string{"DB_IDLE_IN_TX_TIMEOUT"}},
		{"unknown log format", map[string]string{"LOG_FORMAT": "xml"}, "", []string{"LOG_FORMAT"}},
		{"redirect uri without a scheme", map[string]string{"AUTH_REDIRECT_URIS": "https://a.example/ b.example"}, "", []string{"AUTH_REDIRECT_URIS"}},
		{"deadline not shorter than the drain", map[string]string{"REQUEST_DEADLINE": "15s"}, "", []string{"REQUEST_DEADLINE", "HTTP_DRAIN_TIMEOUT"}},
		{"drain not shorter than the budget", map[string]string{"HTTP_DRAIN_TIMEOUT": "20s"}, "", []string{"HTTP_DRAIN_TIMEOUT", "SHUTDOWN_BUDGET"}},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			environ := validEnvironment(t)
			for name, value := range c.set {
				environ[name] = value
			}
			if c.secret != "" {
				environ["DATABASE_URL_FILE"] = secretFile(t, c.secret)
			}
			_, err := load(environ)
			assertNamesAll(t, err, c.names...)
		})
	}
}

func TestTheDatabaseURLAppearsInNoTextForm(t *testing.T) {
	t.Parallel()
	cfg, err := load(validEnvironment(t))
	if err != nil {
		t.Fatal(err)
	}
	var text, jsonLog bytes.Buffer
	slog.New(slog.NewTextHandler(&text, nil)).Info("start", "config", cfg)
	slog.New(slog.NewJSONHandler(&jsonLog, nil)).Info("start", "config", cfg)
	encoded, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	for form, out := range map[string]string{
		"%v": fmt.Sprintf("%v", cfg), "%+v": fmt.Sprintf("%+v", cfg), "%#v": fmt.Sprintf("%#v", cfg),
		"slog text": text.String(), "slog JSON": jsonLog.String(), "encoding/json": string(encoded),
	} {
		if strings.Contains(out, "hunter2") {
			t.Errorf("%s shows the password: %s", form, out)
		}
	}
}
