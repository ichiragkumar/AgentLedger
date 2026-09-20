import { createHash, randomBytes } from "node:crypto";
import { queryOrNull } from "@/lib/db";
import { ensureAppTables } from "./ensure";

// Virtual-key vault (dashboard side).
//
// Mirrors Go semantics in internal/auth/auth.go: agents present `vk_…`,
// logs keep only a redacted prefix, real provider keys NEVER appear here.
// Full key material is returned ONCE (issue/rotate) and never persisted —
// only sha256(key) + prefix + last4 are stored.
//
// TODO(PROXY): sync with the Go management plane once it exposes a key
// vault API (issue/revoke/rotate/list). The Go resolver
// (auth.NewMapResolverFromEnv) is in-memory/env-seeded today, so this table
// is the dashboard system-of-record until the vault lands. Needed proxy
// endpoints: POST /v1/keys, DELETE /v1/keys/{id}, POST /v1/keys/{id}/rotate,
// GET /v1/keys (prefix-only list).

export type KeyStatus = "active" | "revoked" | "grace";

export type StoredKey = {
  id: string;
  name: string;
  agent_scope: string;
  team_scope: string;
  key_hash: string;
  key_prefix: string;
  key_last4: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  rotated_from: string | null;
  grace_expires_at: string | null;
};

export type PublicKey = {
  id: string;
  name: string;
  agentScope: string;
  teamScope: string;
  prefix: string;
  last4: string;
  createdAt: string;
  lastUsedAt: string | null;
  status: KeyStatus;
  rotatedFrom: string | null;
  graceExpiresAt: string | null;
};

export function statusOf(k: StoredKey, now = Date.now()): KeyStatus {
  if (k.revoked_at) return "revoked";
  if (k.grace_expires_at && new Date(k.grace_expires_at).getTime() < now) return "revoked";
  if (k.rotated_from) return "grace";
  return "active";
}

export function toPublic(k: StoredKey): PublicKey {
  return {
    id: k.id,
    name: k.name,
    agentScope: k.agent_scope,
    teamScope: k.team_scope,
    prefix: k.key_prefix,
    last4: k.key_last4,
    createdAt: k.created_at,
    lastUsedAt: k.last_used_at,
    status: statusOf(k),
    rotatedFrom: k.rotated_from,
    graceExpiresAt: k.grace_expires_at,
  };
}

function newVirtualKey(): { full: string; hash: string; prefix: string; last4: string } {
  const full = `vk_${randomBytes(24).toString("base64url")}`;
  return {
    full,
    hash: createHash("sha256").update(full).digest("hex"),
    prefix: full.slice(0, 4) + "***",
    last4: full.slice(-4),
  };
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export async function listKeys(): Promise<PublicKey[]> {
  await ensureAppTables();
  const rows = await queryOrNull<StoredKey>(
    `SELECT id, name, agent_scope, team_scope, key_hash, key_prefix, key_last4,
            created_at, last_used_at, revoked_at, rotated_from, grace_expires_at
     FROM virtual_keys ORDER BY created_at DESC LIMIT 200`
  );
  return (rows ?? []).map(toPublic);
}

/** Issue a key. Returns the public record + full key ONCE (never logged/stored). */
export async function issueKey(opts: { name: string; agentScope?: string; teamScope?: string }): Promise<{
  key: PublicKey;
  fullKey: string;
}> {
  await ensureAppTables();
  const k = newVirtualKey();
  const id = newId("vkid");
  const rows = await queryOrNull<StoredKey>(
    `INSERT INTO virtual_keys (id, name, agent_scope, team_scope, key_hash, key_prefix, key_last4)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, agent_scope, team_scope, key_hash, key_prefix, key_last4,
               created_at, last_used_at, revoked_at, rotated_from, grace_expires_at`,
    [id, opts.name, opts.agentScope ?? "", opts.teamScope ?? "", k.hash, k.prefix, k.last4]
  );
  const stored = rows?.[0];
  if (!stored) throw new Error("key store unavailable");
  return { key: toPublic(stored), fullKey: k.full };
}

/** Revoke instantly: resolution must reject from now on. */
export async function revokeKey(id: string): Promise<PublicKey | null> {
  await ensureAppTables();
  const rows = await queryOrNull<StoredKey>(
    `UPDATE virtual_keys SET revoked_at = now(), grace_expires_at = NULL WHERE id = $1
     RETURNING id, name, agent_scope, team_scope, key_hash, key_prefix, key_last4,
               created_at, last_used_at, revoked_at, rotated_from, grace_expires_at`,
    [id]
  );
  return rows?.[0] ? toPublic(rows[0]) : null;
}

/**
 * Rotate: mint a replacement (full key returned ONCE); the old key stays
 * valid until graceExpiresAt, then it is treated as revoked.
 */
export async function rotateKey(
  id: string,
  graceSeconds: number
): Promise<{ key: PublicKey; fullKey: string; rotatedFrom: PublicKey } | null> {
  await ensureAppTables();
  const existing = await queryOrNull<StoredKey>(
    `SELECT id, name, agent_scope, team_scope, key_hash, key_prefix, key_last4,
            created_at, last_used_at, revoked_at, rotated_from, grace_expires_at
     FROM virtual_keys WHERE id = $1`,
    [id]
  );
  const old = existing?.[0];
  if (!old || old.revoked_at) return null;
  const k = newVirtualKey();
  const nextId = newId("vkid");
  const rows = await queryOrNull<StoredKey>(
    `INSERT INTO virtual_keys (id, name, agent_scope, team_scope, key_hash, key_prefix, key_last4, rotated_from, grace_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + ($9 || ' seconds')::interval)
     RETURNING id, name, agent_scope, team_scope, key_hash, key_prefix, key_last4,
               created_at, last_used_at, revoked_at, rotated_from, grace_expires_at`,
    [nextId, old.name, old.agent_scope, old.team_scope, k.hash, k.prefix, k.last4, old.id, String(graceSeconds)]
  );
  // Mark the old key as superseded: it remains resolvable only within grace.
  await queryOrNull(`UPDATE virtual_keys SET grace_expires_at = now() + ($2 || ' seconds')::interval WHERE id = $1`, [
    old.id,
    String(graceSeconds),
  ]);
  const next = rows?.[0];
  if (!next) throw new Error("key store unavailable");
  return { key: toPublic(next), fullKey: k.full, rotatedFrom: toPublic(old) };
}
