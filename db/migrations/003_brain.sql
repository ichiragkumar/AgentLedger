-- AgentLedger Phase 5 (Brain) schema: workflow topology + learning state.
-- Postgres 16. NEW tables only — never alters request_logs (Phase 1) or
-- Phase 2/3/4 tables. Apply with: psql $DATABASE_URL -f db/migrations/003_brain.sql
--
-- Data flow:
--   workflow_graphs: one row per X-Request-Chain-Id, rebuilt by
--     internal/brain.Builder from request_logs rows (chain_id,
--     agent_id, parent_agent_id, cost_usd, status_code).
--   step_stats: rolling per-agent history feeding criticality scoring
--     (Learner.Snapshot export) and the +5%-in-7-days learning experiment.
--   roi_signals: business-outcome events (webhook/status/custom) joined to
--     per-workflow cost for "cost $2.30 → $45 value" attribution.

CREATE TABLE IF NOT EXISTS workflow_graphs (
  chain_id    TEXT PRIMARY KEY,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- nodes: {"planner": {"calls": 12, "failures": 1, "total_cost_usd": 0.31}, ...}
  nodes       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- edges: [["planner","researcher"], ["researcher","writer"], ...]
  edges       JSONB NOT NULL DEFAULT '[]'::jsonb,
  roots       TEXT[] NOT NULL DEFAULT '{}',
  orphans     TEXT[] NOT NULL DEFAULT '{}',
  spans_seen  INT NOT NULL DEFAULT 0,
  dropped     INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS step_stats (
  agent_id       TEXT NOT NULL,
  window_start   TIMESTAMPTZ NOT NULL DEFAULT date_trunc('day', now()),
  calls          BIGINT NOT NULL DEFAULT 0,
  failures       BIGINT NOT NULL DEFAULT 0,
  avg_cost_usd   DOUBLE PRECISION NOT NULL DEFAULT 0,
  avg_quality    DOUBLE PRECISION NOT NULL DEFAULT 0,
  failure_rate   DOUBLE PRECISION NOT NULL DEFAULT 0.10,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, window_start)
);

CREATE TABLE IF NOT EXISTS roi_signals (
  id            BIGSERIAL PRIMARY KEY,
  workflow_id   TEXT NOT NULL, -- == request_logs.chain_id
  source        TEXT NOT NULL CHECK (source IN ('webhook', 'status', 'custom')),
  success       BOOLEAN NOT NULL DEFAULT FALSE,
  value_usd     DOUBLE PRECISION NOT NULL DEFAULT 0,
  metric_name   TEXT NOT NULL DEFAULT '',
  metric_value  DOUBLE PRECISION NOT NULL DEFAULT 0,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_graphs_updated ON workflow_graphs (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_step_stats_agent ON step_stats (agent_id, window_start DESC);
CREATE INDEX IF NOT EXISTS idx_roi_signals_workflow ON roi_signals (workflow_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_roi_signals_source ON roi_signals (source);

-- Moat queries (workflow-level token yield + ROI headlines):
-- Per-workflow cost (join key for ROI):
--   SELECT chain_id AS workflow_id, count(*) AS steps, sum(cost_usd) AS cost_usd
--     FROM request_logs WHERE chain_id <> '' GROUP BY 1;
-- Yield inputs (success = terminal step 2xx):
--   SELECT chain_id, sum(cost_usd),
--          bool_and(status_code BETWEEN 200 AND 299) AS all_ok
--     FROM request_logs WHERE chain_id <> '' GROUP BY 1;
-- ROI headline ("cost $2.30 → $45 value"):
--   SELECT c.workflow_id, c.cost_usd, coalesce(sum(s.value_usd),0) AS value_usd
--     FROM (SELECT chain_id AS workflow_id, sum(cost_usd) AS cost_usd
--             FROM request_logs GROUP BY 1) c
--     LEFT JOIN roi_signals s ON s.workflow_id = c.workflow_id
--     GROUP BY 1, 2 ORDER BY 2 DESC;
