// Package config loads the server's configuration from the environment.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"reflect"
	"strings"
	"time"

	"github.com/caarlos0/env/v11"

	"github.com/KOCEAN33/savetab/apps/server/internal/platform/logline"
)

// Secret is a value that grants access. It shows as a redaction marker in every text form, so
// only Reveal gives its value.
type Secret string

const redacted = "[redacted]"

func (s Secret) Reveal() string             { return string(s) }
func (Secret) String() string               { return redacted }
func (Secret) GoString() string             { return redacted }
func (Secret) LogValue() slog.Value         { return slog.StringValue(redacted) }
func (Secret) MarshalJSON() ([]byte, error) { return []byte(`"` + redacted + `"`), nil }
func (Secret) MarshalText() ([]byte, error) { return []byte(redacted), nil }

// Config is every value the server reads at start. A field without a default is required.
type Config struct {
	DatabaseURL      Secret        `env:"DATABASE_URL_FILE,file,notEmpty"`
	DBPoolMax        int32         `env:"DB_POOL_MAX" envDefault:"10"`
	ListenAddr       string        `env:"LISTEN_ADDR,notEmpty"`
	PublicURL        string        `env:"PUBLIC_URL,notEmpty"`
	OIDCIssuer       string        `env:"OIDC_ISSUER,notEmpty"`
	OIDCClientID     string        `env:"OIDC_CLIENT_ID,notEmpty"`
	AuthRedirectURIs []string      `env:"AUTH_REDIRECT_URIS,notEmpty" envSeparator:" "`
	StartWait        time.Duration `env:"START_WAIT" envDefault:"30s"`
	RequestDeadline  time.Duration `env:"REQUEST_DEADLINE" envDefault:"10s"`
	ReadyPingTimeout time.Duration `env:"READY_PING_TIMEOUT" envDefault:"1s"`
	HTTPDrainTimeout time.Duration `env:"HTTP_DRAIN_TIMEOUT" envDefault:"15s"`
	ShutdownBudget   time.Duration `env:"SHUTDOWN_BUDGET" envDefault:"20s"`
	LogFormat        string        `env:"LOG_FORMAT" envDefault:"json"`
	LogLevel         slog.Level    `env:"LOG_LEVEL" envDefault:"info"`
}

// Load reads the configuration from opts.Environment, or from the process environment when
// that is nil. Its error names every bad variable.
func Load(opts env.Options) (Config, error) {
	opts.RequiredIfNoDef = true
	cfg, parseErr := env.ParseAsWithOptions[Config](opts)
	// A secret file usually ends in a newline that is no part of the value.
	cfg.DatabaseURL = Secret(strings.TrimSpace(string(cfg.DatabaseURL)))
	reported := map[string]bool{}
	var errs []error
	if agg, ok := errors.AsType[env.AggregateError](parseErr); ok {
		for _, e := range agg.Errors {
			name, err := named(e)
			reported[name] = true
			errs = append(errs, err)
		}
	} else if parseErr != nil {
		errs = append(errs, parseErr)
	}
	errs = append(errs, cfg.validate(reported))
	if err := errors.Join(errs...); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// named returns the variable one parse error is about, and the error worded by that variable,
// since a ParseError names only the struct field.
func named(err error) (string, error) {
	if pe, ok := errors.AsType[env.ParseError](err); ok {
		f, _ := reflect.TypeFor[Config]().FieldByName(pe.Name)
		name, _, _ := strings.Cut(f.Tag.Get("env"), ",")
		return name, fmt.Errorf("environment variable %q is malformed: %w", name, pe.Err)
	}
	if e, ok := errors.AsType[env.VarIsNotSetError](err); ok {
		return e.Key, err
	}
	if e, ok := errors.AsType[env.EmptyVarError](err); ok {
		return e.Key, err
	}
	if e, ok := errors.AsType[env.LoadFileContentError](err); ok {
		return e.Key, err
	}
	return "", err
}

func (c Config) validate(failed map[string]bool) error {
	var errs []error
	bad := func(name, reason string, args ...any) {
		if !failed[name] {
			errs = append(errs, fmt.Errorf("environment variable %q %s", name, fmt.Sprintf(reason, args...)))
		}
	}
	if c.DatabaseURL == "" {
		bad("DATABASE_URL_FILE", "names an empty file")
	}
	if c.DBPoolMax < 1 {
		bad("DB_POOL_MAX", "is %d, want at least 1", c.DBPoolMax)
	}
	if !absoluteURL(c.PublicURL) {
		bad("PUBLIC_URL", "is %q, want an absolute URL", c.PublicURL)
	}
	for _, uri := range c.AuthRedirectURIs {
		if !absoluteURL(uri) {
			bad("AUTH_REDIRECT_URIS", "holds %q, want absolute URLs separated by one space", uri)
		}
	}
	if c.LogFormat != logline.FormatJSON && c.LogFormat != logline.FormatConsole {
		bad("LOG_FORMAT", "is %q, want %q or %q", c.LogFormat, logline.FormatJSON, logline.FormatConsole)
	}
	for name, d := range map[string]time.Duration{
		"START_WAIT": c.StartWait, "REQUEST_DEADLINE": c.RequestDeadline, "READY_PING_TIMEOUT": c.ReadyPingTimeout,
		"HTTP_DRAIN_TIMEOUT": c.HTTPDrainTimeout, "SHUTDOWN_BUDGET": c.ShutdownBudget,
	} {
		if d <= 0 {
			bad(name, "is %s, want a positive duration", d)
		}
	}
	if !failed["REQUEST_DEADLINE"] && !failed["HTTP_DRAIN_TIMEOUT"] && c.RequestDeadline >= c.HTTPDrainTimeout {
		bad("REQUEST_DEADLINE", "is %s, want it shorter than HTTP_DRAIN_TIMEOUT %s, so a drain can wait out a request", c.RequestDeadline, c.HTTPDrainTimeout)
	}
	if !failed["HTTP_DRAIN_TIMEOUT"] && !failed["SHUTDOWN_BUDGET"] && c.HTTPDrainTimeout >= c.ShutdownBudget {
		bad("HTTP_DRAIN_TIMEOUT", "is %s, want it shorter than SHUTDOWN_BUDGET %s", c.HTTPDrainTimeout, c.ShutdownBudget)
	}
	return errors.Join(errs...)
}

func absoluteURL(s string) bool {
	u, err := url.Parse(s)
	return err == nil && u.Scheme != "" && u.Host != ""
}
