-- AgentLedger Phase 1 schema: append-only request audit log.
-- Postgres 16. Real keys are NEVER stored; only virtual-key prefixes.
-- Apply with: psql $DATABASE_URL -f db/schema.sql

CREATE TABLE IF NOT EXISTS request_logs (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  model TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'openai',
  tokens_in INT NOT NULL DEFAULT 0,
  tokens_out INT NOT NULL DEFAULT 0,
  cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  latency_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
  upstream_latency_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
  agent_id TEXT NOT NULL DEFAULT '',
  team_id TEXT NOT NULL DEFAULT '',
  project_id TEXT NOT NULL DEFAULT '',
  chain_id TEXT NOT NULL DEFAULT '',
  parent_agent_id TEXT NOT NULL DEFAULT '',
  virtual_key_prefix TEXT NOT NULL DEFAULT '',
  status_code INT NOT NULL DEFAULT 200,
  stream BOOLEAN NOT NULL DEFAULT FALSE,
  price_known BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_request_logs_ts ON request_logs (ts DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_model ON request_logs (model);
CREATE INDEX IF NOT EXISTS idx_request_logs_agent ON request_logs (agent_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_team ON request_logs (team_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_project ON request_logs (project_id);

-- Dashboard v0.1 queries (spend 24h/7d/30d, by model/agent/team, top 10):
-- SELECT sum(cost_usd) FROM request_logs WHERE ts > now() - interval '24 hours';
-- SELECT model, sum(cost_usd) FROM request_logs GROUP BY 1 ORDER BY 2 DESC;
-- SELECT agent_id, sum(cost_usd) FROM request_logs GROUP BY 1 ORDER BY 2 DESC;
-- SELECT team_id, sum(cost_usd) FROM request_logs GROUP BY 1 ORDER BY 2 DESC;
-- SELECT * FROM request_logs ORDER BY cost_usd DESC LIMIT 10;
