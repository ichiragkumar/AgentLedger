// Package logger — Postgres sink (Phase 1.5: the audit trail lands in
// request_logs instead of stdout). PostgresStubLogger is kept for tests and
// for unreachable-DB fallback; NewFromEnv prefers the real sink.
package logger

import (
	"context"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/agentledger/agentledger/pkg/models"
)

// insertSQL matches db/schema.sql column-for-column. Bodies are never
// stored; virtual-key PREFIX only (see Sanitize).
const insertSQL = `INSERT INTO request_logs
  (ts, model, provider, tokens_in, tokens_out, cost_usd, latency_ms,
   upstream_latency_ms, agent_id, team_id, project_id, chain_id,
   parent_agent_id, virtual_key_prefix, status_code, stream, price_known)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`

// PostgresLogger inserts every row into request_logs. On insert failure it
// falls back to stdout JSON so the audit trail is never silently lost.
type PostgresLogger struct {
	pool     *pgxpool.Pool
	fallback *StdoutLogger
}

// NewPostgresLogger connects (ping, 5s timeout) and returns the sink.
// Caller must Close it.
func NewPostgresLogger(ctx context.Context, dsn string, fallback *StdoutLogger) (*PostgresLogger, error) {
	if fallback == nil {
		fallback = NewStdoutLogger(nil)
	}
	tctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	pool, err := pgxpool.New(tctx, dsn)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(tctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &PostgresLogger{pool: pool, fallback: fallback}, nil
}

// Log implements Logger.
func (l *PostgresLogger) Log(ctx context.Context, e models.RequestLog) error {
	e = Sanitize(e)
	tctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	_, err := l.pool.Exec(tctx, insertSQL,
		e.Timestamp, e.Model, e.Provider, e.TokensIn, e.TokensOut,
		e.CostUSD, e.LatencyMs, e.UpstreamLatencyMs, e.AgentID, e.TeamID,
		e.ProjectID, e.ChainID, e.ParentAgentID, e.VirtualKeyPrefix,
		e.StatusCode, e.Stream, e.PriceKnown)
	if err != nil {
		// DB write failed — stdout fallback keeps the trail. Return the
		// fallback error (nil on success) so callers see delivery status.
		return l.fallback.Log(ctx, e)
	}
	return nil
}

// Close implements Logger.
func (l *PostgresLogger) Close() error {
	l.pool.Close()
	return nil
}

// NewFromEnv returns a real Postgres sink when DATABASE_URL is set AND
// reachable, else the stdout-backed stub. Always compiles and runs with no
// DB present.
func NewFromEnv() Logger {
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		if pg, err := NewPostgresLogger(context.Background(), dsn, nil); err == nil {
			return pg
		}
		return NewPostgresStubLogger(dsn, nil)
	}
	return NewStdoutLogger(nil)
}
