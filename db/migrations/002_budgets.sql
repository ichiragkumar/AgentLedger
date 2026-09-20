-- AgentLedger Phase 4 migration 002: budgets, policies, append-only audit log.
-- NEVER rewrite db/schema.sql — apply on top:
--   psql $DATABASE_URL -f db/migrations/002_budgets.sql
--
-- Conventions mirror internal/enforce: levels org|team|project|agent,
-- windows daily|weekly|monthly. Zero limits = unlimited. Spent counters
-- reset when now >= reset_at (the Go Store rolls windows; these columns
-- persist the current window for crash recovery + dashboard queries).

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('org','team','project','agent')),
  scope_key TEXT NOT NULL,
  owner_team TEXT NOT NULL DEFAULT '',
  scope_window TEXT NOT NULL CHECK (scope_window IN ('daily','weekly','monthly')),
  token_limit BIGINT NOT NULL DEFAULT 0 CHECK (token_limit >= 0),
  dollar_limit DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (dollar_limit >= 0),
  spent_tokens BIGINT NOT NULL DEFAULT 0,
  spent_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  reset_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (level, scope_key, scope_window)
);

CREATE INDEX IF NOT EXISTS idx_budgets_scope ON budgets (level, scope_key, scope_window);
CREATE INDEX IF NOT EXISTS idx_budgets_owner_team ON budgets (owner_team);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  team TEXT NOT NULL DEFAULT '*',
  config TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_policies_team ON policies (team);

-- Append-only, hash-chained audit log. Every enforcement action
-- (budget create/update/delete, policy change, alert fire, downgrade,
-- hard stop, policy deny, loop kill) lands here. Rows are tamper-evident:
-- each hash covers the previous hash. Application enforces the chain in
-- internal/enforce AuditChain; the database enforces append-only via the
-- trigger below (UPDATE/DELETE raise).
CREATE TABLE IF NOT EXISTS audit_log (
  seq BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  budget_id TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_budget ON audit_log (budget_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action);

CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (attempted % on seq %)', TG_OP, COALESCE(OLD.seq, NEW.seq);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_no_update ON audit_log;
CREATE TRIGGER trg_audit_log_no_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
