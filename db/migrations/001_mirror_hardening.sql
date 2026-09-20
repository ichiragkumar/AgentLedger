-- AgentLedger migration 001: Mirror hardening (additive only, safe to re-run).
-- Composite indexes for dashboard group-bys, data-quality CHECKs, and
-- dashboard v0.1 views (spend windows, by model/agent/team, top-10).
-- Apply with: psql $DATABASE_URL -f db/migrations/001_mirror_hardening.sql

-- Composite indexes (dashboard group-by + time filtering in one scan).
CREATE INDEX IF NOT EXISTS idx_request_logs_team_ts ON request_logs (team_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_agent_ts ON request_logs (agent_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_model_ts ON request_logs (model, ts DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_chain ON request_logs (chain_id) WHERE chain_id <> '';

-- Data-quality guards (existing rows unaffected unless violating).
DO $$ BEGIN
  ALTER TABLE request_logs ADD CONSTRAINT chk_request_logs_tokens_nonneg
    CHECK (tokens_in >= 0 AND tokens_out >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE request_logs ADD CONSTRAINT chk_request_logs_cost_nonneg
    CHECK (cost_usd >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Dashboard v0.1 views.
CREATE OR REPLACE VIEW v_spend_24h AS
  SELECT coalesce(sum(cost_usd), 0) AS spend_usd, count(*) AS requests,
         coalesce(sum(tokens_in), 0) AS tokens_in, coalesce(sum(tokens_out), 0) AS tokens_out
  FROM request_logs WHERE ts > now() - interval '24 hours';

CREATE OR REPLACE VIEW v_spend_7d AS
  SELECT coalesce(sum(cost_usd), 0) AS spend_usd, count(*) AS requests
  FROM request_logs WHERE ts > now() - interval '7 days';

CREATE OR REPLACE VIEW v_spend_30d AS
  SELECT coalesce(sum(cost_usd), 0) AS spend_usd, count(*) AS requests
  FROM request_logs WHERE ts > now() - interval '30 days';

CREATE OR REPLACE VIEW v_spend_by_model AS
  SELECT model, coalesce(sum(cost_usd), 0) AS spend_usd, count(*) AS requests,
         coalesce(sum(tokens_in + tokens_out), 0) AS tokens
  FROM request_logs GROUP BY 1 ORDER BY 2 DESC;

CREATE OR REPLACE VIEW v_spend_by_agent AS
  SELECT agent_id, coalesce(sum(cost_usd), 0) AS spend_usd, count(*) AS requests
  FROM request_logs GROUP BY 1 ORDER BY 2 DESC;

CREATE OR REPLACE VIEW v_spend_by_team AS
  SELECT team_id, coalesce(sum(cost_usd), 0) AS spend_usd, count(*) AS requests
  FROM request_logs GROUP BY 1 ORDER BY 2 DESC;

CREATE OR REPLACE VIEW v_top10_requests AS
  SELECT id, ts, model, agent_id, team_id, tokens_in, tokens_out, cost_usd, latency_ms
  FROM request_logs ORDER BY cost_usd DESC LIMIT 10;
