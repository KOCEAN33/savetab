package logline

import (
	"io"
	"log/slog"
	"time"

	"github.com/lmittmann/tint"
)

// The values of the log format setting.
const (
	FormatJSON    = "json"
	FormatConsole = "console"
)

// Process is what every line says about the process that wrote it.
type Process struct {
	Service  string
	Version  string
	Commit   string
	Instance string
}

// NewLogger returns the process's one logger, writing to w: one JSON object per line, or
// colored text for a console when format is FormatConsole.
func NewLogger(w io.Writer, format string, level slog.Level, p Process) *slog.Logger {
	var min slog.LevelVar
	min.Set(level)
	var h slog.Handler
	if format == FormatConsole {
		h = tint.NewHandler(w, &tint.Options{Level: &min, AddSource: true})
	} else {
		h = slog.NewJSONHandler(w, &slog.HandlerOptions{Level: &min, ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			if len(groups) == 0 && a.Key == slog.MessageKey {
				a.Key = keyEvent
			}
			return a
		}})
	}
	return slog.New(h).With(
		slog.String(keyService, p.Service),
		slog.String(keyVersion, p.Version),
		slog.String(keyCommit, p.Commit),
		slog.String(keyInstance, p.Instance),
	)
}

// Settings is the effective configuration as the start line shows it. It has no field for a
// secret.
type Settings struct {
	ListenAddr         string
	PublicURL          string
	OIDCIssuer         string
	OIDCClientID       string
	AuthRedirectURIs   []string
	DBPoolMax          int32
	DBStatementTimeout time.Duration
	DBIdleInTxTimeout  time.Duration
	StartWait          time.Duration
	RequestDeadline    time.Duration
	ReadyPingTimeout   time.Duration
	HTTPDrainTimeout   time.Duration
	ShutdownBudget     time.Duration
	LogFormat          string
	LogLevel           slog.Level
}

// StartAttrs returns the attributes of the start line. traceID joins it to the stop line.
func StartAttrs(traceID string, s Settings) []slog.Attr {
	return []slog.Attr{
		slog.String(keyTraceID, traceID),
		slog.Group(keyConfig,
			slog.String("listen_addr", s.ListenAddr),
			slog.String("public_url", s.PublicURL),
			slog.String("oidc_issuer", s.OIDCIssuer),
			slog.String("oidc_client_id", s.OIDCClientID),
			slog.Any("auth_redirect_uris", s.AuthRedirectURIs),
			slog.Int64("db_pool_max", int64(s.DBPoolMax)),
			durationMS("db_statement_timeout_ms", s.DBStatementTimeout),
			durationMS("db_idle_in_tx_timeout_ms", s.DBIdleInTxTimeout),
			durationMS("start_wait_ms", s.StartWait),
			durationMS("request_deadline_ms", s.RequestDeadline),
			durationMS("ready_ping_timeout_ms", s.ReadyPingTimeout),
			durationMS("http_drain_timeout_ms", s.HTTPDrainTimeout),
			durationMS("shutdown_budget_ms", s.ShutdownBudget),
			slog.String("log_format", s.LogFormat),
			slog.String("log_level", s.LogLevel.String()),
		),
	}
}

// StopAttrs returns the attributes of the stop line: the reason, and err when the process
// stops on one.
func StopAttrs(traceID, reason string, err error) []slog.Attr {
	attrs := []slog.Attr{slog.String(keyTraceID, traceID), slog.String(keyReason, reason)}
	if err != nil {
		var f Fields
		f.setError(kindNameOf(err), err.Error())
		attrs = append(attrs, slog.String(keyErrorType, f.errType), slog.String(keyErrorMessage, f.errMessage))
	}
	return attrs
}
