import { queryOrNull } from "@/lib/db";

let ensured: Promise<void> | null = null;

const DDL = [
  // Virtual-key vault mirror. NEVER stores plaintext: only sha256 + safe slices.
  // Full key material is returned ONCE at issue/rotate time and never persisted.
  `CREATE TABLE IF NOT EXISTS virtual_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    agent_scope TEXT NOT NULL DEFAULT '',
    team_scope TEXT NOT NULL DEFAULT '',
    key_hash TEXT NOT NULL,
    key_prefix TEXT NOT NULL DEFAULT '',
    key_last4 TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    rotated_from TEXT,
    grace_expires_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_virtual_keys_scope ON virtual_keys (agent_scope)`,
  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
];

/** Best-effort ensure of dashboard-owned tables (idempotent, additive). */
export function ensureAppTables(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      for (const sql of DDL) {
        await queryOrNull(sql);
      }
    })();
  }
  return ensured;
}
