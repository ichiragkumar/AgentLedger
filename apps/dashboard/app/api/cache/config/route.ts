import { queryOrNull } from "@/lib/db";
import { mgmtHeaders, proxyFetch } from "../../_lib/proxy-mgmt";

export const dynamic = "force-dynamic";

// /api/cache/config — Saver tuning (spec 05 §2.4).
//
// GET returns the durable config (single row, id 'default') or honest
// defaults {source:"defaults"} when the table/row is absent.
// PUT validates {threshold 0.80–0.99, ttlSeconds 60–2592000,
// enabled?, guardEnabled?}, upserts the row, then mirrors best-effort to
// the proxy (PUT /v1/cache/config — lands with Mirror's WIRING.md patch;
// until then proxySynced:false and the durable write still wins).
//
// NOTE: the proxy hook clamps thresholds to [0.85, 0.99] (sanitize()),
// so 0.80–0.84 persists here but enforces as the 0.92 default — the PUT
// response carries that note when it applies.

export type CacheConfigBody = {
  threshold: number;
  ttlSeconds: number;
  enabled: boolean;
  guardEnabled: boolean;
};

export const DEFAULT_CONFIG: CacheConfigBody = {
  threshold: 0.92,
  ttlSeconds: 3600,
  enabled: true,
  guardEnabled: true,
};

const MIN_THRESHOLD = 0.8;
const MAX_THRESHOLD = 0.99;
const MIN_TTL = 60;
const MAX_TTL = 30 * 86400;

type ConfigRow = {
  threshold: number;
  ttl_seconds: number;
  enabled: boolean;
  guard_enabled: boolean;
  updated_at: string;
};

async function readRow(): Promise<{ config: CacheConfigBody; stored: boolean; updatedAt: string | null }> {
  await queryOrNull(`CREATE TABLE IF NOT EXISTS cache_config (
    id TEXT PRIMARY KEY DEFAULT 'default',
    threshold DOUBLE PRECISION NOT NULL DEFAULT 0.92,
    ttl_seconds INT NOT NULL DEFAULT 3600,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    guard_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const rows = await queryOrNull<ConfigRow>(
    `SELECT threshold, ttl_seconds, enabled, guard_enabled, updated_at
     FROM cache_config WHERE id = 'default'`
  );
  const r = rows?.[0];
  if (!r) return { config: { ...DEFAULT_CONFIG }, stored: false, updatedAt: null };
  return {
    config: {
      threshold: Number(r.threshold),
      ttlSeconds: Number(r.ttl_seconds),
      enabled: Boolean(r.enabled),
      guardEnabled: Boolean(r.guard_enabled),
    },
    stored: true,
    updatedAt: r.updated_at,
  };
}

export async function GET() {
  const { config, stored, updatedAt } = await readRow();
  return Response.json({
    config,
    source: stored ? ("stored" as const) : ("defaults" as const),
    updatedAt: updatedAt ?? new Date().toISOString(),
  });
}

export async function PUT(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_config", detail: "body must be JSON" }, { status: 400 });
  }

  const threshold = body.threshold === undefined ? undefined : Number(body.threshold);
  const ttlSeconds = body.ttlSeconds === undefined ? undefined : Number(body.ttlSeconds);
  const enabled = body.enabled === undefined ? undefined : body.enabled;
  const guardEnabled = body.guardEnabled === undefined ? undefined : body.guardEnabled;

  if (
    (threshold !== undefined && (!Number.isFinite(threshold) || threshold < MIN_THRESHOLD || threshold > MAX_THRESHOLD)) ||
    (ttlSeconds !== undefined && (!Number.isInteger(ttlSeconds) || ttlSeconds < MIN_TTL || ttlSeconds > MAX_TTL)) ||
    (enabled !== undefined && typeof enabled !== "boolean") ||
    (guardEnabled !== undefined && typeof guardEnabled !== "boolean")
  ) {
    return Response.json(
      {
        error: "invalid_config",
        detail: `threshold ∈ [${MIN_THRESHOLD}, ${MAX_THRESHOLD}], ttlSeconds int ∈ [${MIN_TTL}, ${MAX_TTL}], enabled/guardEnabled boolean`,
      },
      { status: 400 }
    );
  }

  const current = (await readRow()).config;
  const next: CacheConfigBody = {
    threshold: threshold ?? current.threshold,
    ttlSeconds: ttlSeconds ?? current.ttlSeconds,
    enabled: enabled ?? current.enabled,
    guardEnabled: guardEnabled ?? current.guardEnabled,
  };

  const rows = await queryOrNull<ConfigRow>(
    `INSERT INTO cache_config (id, threshold, ttl_seconds, enabled, guard_enabled, updated_at)
     VALUES ('default', $1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET threshold = EXCLUDED.threshold, ttl_seconds = EXCLUDED.ttl_seconds,
       enabled = EXCLUDED.enabled, guard_enabled = EXCLUDED.guard_enabled, updated_at = now()
     RETURNING threshold, ttl_seconds, enabled, guard_enabled, updated_at`,
    [next.threshold, next.ttlSeconds, next.enabled, next.guardEnabled]
  );
  if (!rows?.[0]) return Response.json({ error: "unavailable" }, { status: 503 });

  // Mirror to the Go hook (best-effort; 404 until WIRING.md lands server-side).
  const mirrored = await proxyFetch("/v1/cache/config", {
    method: "PUT",
    headers: mgmtHeaders(),
    body: JSON.stringify({
      similarity_threshold: next.threshold,
      default_ttl_secs: next.ttlSeconds,
      enabled: next.enabled,
      guard_enabled: next.guardEnabled,
    }),
  });

  const res: Record<string, unknown> = {
    config: next,
    persisted: true,
    proxySynced: mirrored.ok,
    updatedAt: rows[0].updated_at,
  };
  if (next.threshold < 0.85) {
    res.note = "threshold below 0.85 enforces as the 0.92 hook default until the proxy clamps it (see WIRING.md)";
  }
  if (!mirrored.ok) res.proxySynced = false;
  return Response.json(res);
}
