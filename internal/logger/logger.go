// Package logger persists RequestLog rows.
//
// Phase 1 contract: Logger interface is stable. PostgresLogger is a stub that
// compiles and runs WITHOUT a database (falls back to stdout JSON) so
// `go test` and `docker compose up` work on day one. Wiring the real
// database/sql + pgx insert is a Phase 1.5 task — the SQL schema in
// db/schema.sql is already the target shape.
//
// What is logged: timestamp, model, tokens_in/out, cost, latency,
// X-Agent-Id/Team/Project/Chain/Parent tags, virtual-key PREFIX only.
// NEVER logged: real API keys, request/response bodies, Authorization header.
package logger

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"sync"
	"time"

	"github.com/agentledger/agentledger/pkg/models"
)

// Logger is the stable sink interface.
type Logger interface {
	Log(ctx context.Context, e models.RequestLog) error
	Close() error
}

// Bounds applied before any row reaches a sink. Truncation (not rejection)
// keeps the audit trail lossless on count while bounded on width: a chatty
// agent tag must never bloat Postgres or break a dashboard query.
const (
	maxModelLen = 256
	maxStrField = 256
)

// Sanitize returns a sink-safe copy of e: UTC timestamp default, negative
// counters clamped, overlong strings truncated, and any accidental full
// virtual key (vk_xxx...) reduced to its log-safe prefix. Real upstream
// keys (sk-...) must never be placed in a RequestLog at all — Sanitize is
// the last line of defense, not the first.
func Sanitize(e models.RequestLog) models.RequestLog {
	if e.Timestamp.IsZero() {
		e.Timestamp = time.Now().UTC()
	}
	e.Timestamp = e.Timestamp.UTC()
	if len(e.Model) > maxModelLen {
		e.Model = e.Model[:maxModelLen]
	}
	if len(e.Provider) > maxStrField {
		e.Provider = e.Provider[:maxStrField]
	}
	e.AgentID = truncate(e.AgentID)
	e.TeamID = truncate(e.TeamID)
	e.ProjectID = truncate(e.ProjectID)
	e.ChainID = truncate(e.ChainID)
	e.ParentAgentID = truncate(e.ParentAgentID)
	e.VirtualKeyPrefix = sanitizeKeyPrefix(e.VirtualKeyPrefix)
	if e.TokensIn < 0 {
		e.TokensIn = 0
	}
	if e.TokensOut < 0 {
		e.TokensOut = 0
	}
	if e.CostUSD < 0 || e.CostUSD != e.CostUSD {
		e.CostUSD = 0
	}
	if e.LatencyMs < 0 || e.LatencyMs != e.LatencyMs {
		e.LatencyMs = 0
	}
	if e.UpstreamLatencyMs < 0 || e.UpstreamLatencyMs != e.UpstreamLatencyMs {
		e.UpstreamLatencyMs = 0
	}
	if e.StatusCode < 100 || e.StatusCode > 599 {
		e.StatusCode = 0
	}
	return e
}

func truncate(s string) string {
	if len(s) > maxStrField {
		return s[:maxStrField]
	}
	return s
}

// sanitizeKeyPrefix reduces an accidentally-full virtual key to "vk_t***"
// form. Prefixes already in redacted form pass through untouched.
func sanitizeKeyPrefix(s string) string {
	s = truncate(s)
	if len(s) > 7 && (hasPrefixFold(s, "vk_")) {
		return s[:4] + "***"
	}
	return s
}

func hasPrefixFold(s, prefix string) bool {
	if len(s) < len(prefix) {
		return false
	}
	for i := 0; i < len(prefix); i++ {
		c, p := s[i], prefix[i]
		if 'A' <= c && c <= 'Z' {
			c += 'a' - 'A'
		}
		if 'A' <= p && p <= 'Z' {
			p += 'a' - 'A'
		}
		if c != p {
			return false
		}
	}
	return true
}

// StdoutLogger writes one JSON object per line. Safe for tests and dev.
type StdoutLogger struct {
	mu  sync.Mutex
	out io.Writer
}

// NewStdoutLogger returns a logger writing to w (os.Stdout if nil).
func NewStdoutLogger(w io.Writer) *StdoutLogger {
	if w == nil {
		w = os.Stdout
	}
	return &StdoutLogger{out: w}
}

// Log implements Logger.
func (l *StdoutLogger) Log(_ context.Context, e models.RequestLog) error {
	e = Sanitize(e)
	l.mu.Lock()
	defer l.mu.Unlock()
	return json.NewEncoder(l.out).Encode(e)
}

// Close implements Logger (no-op).
func (l *StdoutLogger) Close() error { return nil }

// PostgresStubLogger pretends to be the Postgres sink until the pgx wiring
// lands. Today it annotates the row with sink=postgres-stub and writes to
// the fallback (stdout) so no request is ever dropped when DATABASE_URL is
// set but the driver is not yet vendored.
type PostgresStubLogger struct {
	dsn      string
	fallback *StdoutLogger
}

// NewPostgresStubLogger builds the stub. dsn is stored but never logged.
func NewPostgresStubLogger(dsn string, fallback io.Writer) *PostgresStubLogger {
	return &PostgresStubLogger{dsn: dsn, fallback: NewStdoutLogger(fallback)}
}

// DSNConfigured reports whether a DSN was supplied (without exposing it).
func (l *PostgresStubLogger) DSNConfigured() bool { return l.dsn != "" }

// Log implements Logger.
func (l *PostgresStubLogger) Log(ctx context.Context, e models.RequestLog) error {
	// Future: INSERT INTO request_logs (...) VALUES (...) via pgx.
	// Today: fall through to stdout so the audit trail is never lost.
	return l.fallback.Log(ctx, Sanitize(e))
}

// Close implements Logger (no-op until real pool exists).
func (l *PostgresStubLogger) Close() error { return nil }

// MemoryLogger buffers rows in memory — for unit tests only.
type MemoryLogger struct {
	mu      sync.Mutex
	Entries []models.RequestLog
}

// Log implements Logger.
func (l *MemoryLogger) Log(_ context.Context, e models.RequestLog) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.Entries = append(l.Entries, Sanitize(e))
	return nil
}

// Close implements Logger.
func (l *MemoryLogger) Close() error { return nil }

// NewFromEnv returns a Postgres stub when DATABASE_URL is set, else stdout.
// Always compiles and runs with no DB present.
func NewFromEnv() Logger {
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		return NewPostgresStubLogger(dsn, nil)
	}
	return NewStdoutLogger(nil)
}

// DiscardLogger drops every row. Benchmarks and `--no-log` debug only —
// never the default, the audit trail must not be silently lost in prod.
type DiscardLogger struct{}

// Log implements Logger.
func (DiscardLogger) Log(_ context.Context, _ models.RequestLog) error { return nil }

// Close implements Logger.
func (DiscardLogger) Close() error { return nil }
