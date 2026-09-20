/**
 * Waitlist capture — `POST /api/waitlist` (adopted by ledger-ship-topology).
 *
 * EXCEPTION to the "web NEVER touches Postgres" rule (spec 20): this single
 * route is the sanctioned adoption of the journey stub — Postgres-persisted,
 * idempotent by email, with per-IP rate limiting. No other apps/web file
 * was touched.
 *
 * Contract (unchanged for the co-located form): `{ ok: true }` on success
 * (plus `duplicate: true` on re-signup), `{ ok: false, error }` otherwise.
 * 429 when the per-IP budget is spent, 503 when Postgres is unreachable
 * (fail-closed — a waitlist must never silently drop signups).
 *
 * NOTE: `pg` resolves via workspace hoisting (dashboard declares it).
 * Coordinator: add `pg` (+ `@types/pg`) to apps/web/package.json to make
 * the dep explicit. REQUIRED_ENV: DATABASE_URL (same value as dashboard).
 */

import { Pool } from "pg";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Short-lived pool: serverless-safe (max 2), lazy table creation.
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://agentledger:agentledger@localhost:5432/agentledger?sslmode=disable",
  max: 2,
});

let ensured: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!ensured) {
    ensured = pool
      .query(
        `CREATE TABLE IF NOT EXISTS waitlist_emails (
           email TEXT PRIMARY KEY,
           created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
           source TEXT NOT NULL DEFAULT ''
         )`
      )
      .then(() => undefined);
  }
  return ensured;
}

// --- In-memory sliding-window rate limit (per instance) ---
// 5 POSTs / 60s per IP. Production with multiple instances should move
// this to Redis/Upstash — flagged in the return message, not implemented
// here (no new deps allowed on this track).
const WINDOW_MS = Number(process.env.WAITLIST_RATE_WINDOW_MS ?? 60_000);
const MAX_HITS = Number(process.env.WAITLIST_RATE_MAX ?? 5);
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const window = hits.get(ip) ?? [];
  const fresh = window.filter((t) => now - t < WINDOW_MS);
  fresh.push(now);
  hits.set(ip, fresh);
  // Opportunistic GC: drop idle entries.
  if (hits.size > 10_000) {
    for (const [k, v] of hits) {
      if (v.length === 0 || now - v[v.length - 1] > WINDOW_MS) hits.delete(k);
    }
  }
  return fresh.length > MAX_HITS;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return Response.json(
      { ok: false, error: "Too many attempts. Please try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const email =
    typeof body === "object" && body !== null
      ? String((body as Record<string, unknown>).email ?? "").trim().toLowerCase()
      : "";
  if (!EMAIL_RE.test(email)) {
    return Response.json({ ok: false, error: "Please enter a valid email address." }, { status: 400 });
  }
  const source =
    typeof body === "object" && body !== null ? String((body as Record<string, unknown>).source ?? "").slice(0, 64) : "";

  try {
    await ensureTable();
    const res = await pool.query(
      `INSERT INTO waitlist_emails (email, source)
       VALUES ($1, $2)
       ON CONFLICT (email) DO NOTHING`,
      [email, source]
    );
    return Response.json({ ok: true, duplicate: (res.rowCount ?? 0) === 0 });
  } catch (err) {
    console.warn("[waitlist] postgres unavailable:", (err as Error).message);
    return Response.json(
      { ok: false, error: "Signup is temporarily unavailable. Please try again shortly." },
      { status: 503 }
    );
  }
}
