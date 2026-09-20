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
	if e.Timestamp.IsZero() {
		e.Timestamp = time.Now().UTC()
	}
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
	return l.fallback.Log(ctx, e)
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
	l.Entries = append(l.Entries, e)
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
