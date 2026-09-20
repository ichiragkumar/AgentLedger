import { randomBytes } from "node:crypto";
import { queryOrNull } from "@/lib/db";
import { mgmtHeaders, proxyFetch } from "../_lib/proxy-mgmt";

export const dynamic = "force-dynamic";

// Budgets API (dashboard side, Postgres system-of-record).
//
// Semantics mirror internal/enforce (spec 07): hierarchy Org→Team→Project→
// Agent, soft-alert thresholds 50/75/90, auto-downgrade at 90%, hard stop at
// 100%, linear forecast ("at this rate $X by month end").
//
// READS are live Postgres (rich utilization/forecast/history views over
// request_logs). WRITES persist to Postgres first (durable), then mirror
// best-effort to the Go management plane (POST/PUT/DELETE /v1/budgets[/{id}])
// so the in-memory enforcer enforces the same limits without a restart.
// Responses carry proxySynced:false when the mirror failed — the durable
// write still won; enforcement catches up on the next successful write.

type BudgetRow = {
  id: string;
  level: string;
  scope_key: string;
  owner_team: string;
  scope_window: string;
  token_limit: string;
  dollar_limit: string;
  spent_tokens: string;
  spent_usd: string;
  window_start: string;
  reset_at: string;
  updated_at: string;
};

type SpendRow = { spend: string | null; tokens: string | null; requests: string | null };
type DayRow = { day: string; spend: string | null };

const num = (v: string | number | null | undefined) => Number(v ?? 0);
const LEVELS = ["org", "team", "project", "agent"] as const;
const WINDOWS = ["daily", "weekly", "monthly"] as const;

const WINDOW_SECONDS: Record<string, number> = { daily: 86400, weekly: 604800, monthly: 30 * 86400 };

function scopeFilter(level: string, key: string): { sql: string; params: string[] } {
  switch (level) {
    case "team":
      return { sql: "AND team_id = $2", params: [key] };
    case "project":
      return { sql: "AND project_id = $2", params: [key] };
    case "agent":
      return { sql: "AND agent_id = $2", params: [key] };
    default:
      return { sql: "", params: [] };
  }
}

export type BudgetView = {
  id: string;
  level: string;
  key: string;
  ownerTeam: string;
  window: string;
  tokenLimit: number;
  dollarLimit: number;
  spentTokens: number;
  spentUsd: number;
  utilizationPct: number;
  state: "ok" | "notice" | "watch" | "downgrade" | "hard_stop";
  thresholdsCrossed: number[];
  forecastUsd: number;
  windowStart: string;
  resetAt: string;
  history14d?: { day: string; spend: number }[];
};

async function toView(b: BudgetRow, withHistory: boolean): Promise<BudgetView> {
  const f = scopeFilter(b.level, b.scope_key);
  const spend = await queryOrNull<SpendRow>(
    `SELECT sum(cost_usd) AS spend, sum(tokens_in + tokens_out) AS tokens, count(*) AS requests
     FROM request_logs WHERE ts >= $1::timestamptz ${f.sql}`,
    [b.window_start, ...f.params]
  );
  // Live request_logs spend wins; fall back to persisted counters (Go Store
  // crash-recovery columns) when the window predates retained log rows.
  const liveSpend = num(spend?.[0]?.spend);
  const liveTokens = num(spend?.[0]?.tokens);
  const spentUsd = liveSpend > 0 || num(spend?.[0]?.requests) > 0 ? liveSpend : num(b.spent_usd);
  const spentTokens = liveTokens > 0 ? liveTokens : num(b.spent_tokens);

  const tokenLimit = num(b.token_limit);
  const dollarLimit = num(b.dollar_limit);
  const utils = [
    tokenLimit > 0 ? spentTokens / tokenLimit : 0,
    dollarLimit > 0 ? spentUsd / dollarLimit : 0,
  ];
  const util = Math.max(...utils);
  const pct = util * 100;
  const state =
    pct >= 100 ? "hard_stop" : pct >= 90 ? "downgrade" : pct >= 75 ? "watch" : pct >= 50 ? "notice" : "ok";

  const windowLen = WINDOW_SECONDS[b.scope_window] ?? WINDOW_SECONDS.monthly;
  const elapsed = Math.max(1, Date.now() / 1000 - new Date(b.window_start).getTime() / 1000);
  const forecastUsd = (spentUsd / elapsed) * windowLen;

  const view: BudgetView = {
    id: b.id,
    level: b.level,
    key: b.scope_key,
    ownerTeam: b.owner_team,
    window: b.scope_window,
    tokenLimit,
    dollarLimit,
    spentTokens,
    spentUsd,
    utilizationPct: Math.round(pct * 10) / 10,
    state,
    thresholdsCrossed: [50, 75, 90, 100].filter((t) => pct >= t),
    forecastUsd: Math.round(forecastUsd * 100) / 100,
    windowStart: b.window_start,
    resetAt: b.reset_at,
  };

  if (withHistory) {
    const days = await queryOrNull<DayRow>(
      `SELECT to_char(date_trunc('day', ts), 'YYYY-MM-DD') AS day, sum(cost_usd) AS spend
       FROM request_logs WHERE ts > now() - interval '14 days' ${f.sql.replaceAll("$2", "$1")}
       GROUP BY 1 ORDER BY 1`,
      f.params
    );
    view.history14d = (days ?? []).map((d) => ({ day: d.day, spend: num(d.spend) }));
  }
  return view;
}

// Go enforcer IDs are `level:key:window` (see Store.Upsert) — the address
// for mirrored PUT/DELETE. Best-effort: failure never fails the durable write.
function goIdFor(level: string, key: string, window: string): string {
  return `${level}:${key}:${window}`;
}

async function mirrorCreate(p: { level: string; key: string; window: string; tokenLimit: number; dollarLimit: number }): Promise<boolean> {
  const r = await proxyFetch("/v1/budgets", {
    method: "POST",
    headers: mgmtHeaders(),
    body: JSON.stringify({ level: p.level, key: p.key, window: p.window, token_limit: p.tokenLimit, dollar_limit: p.dollarLimit }),
  });
  return r.ok;
}

async function mirrorUpdate(
  goId: string,
  p: { level: string; key: string; window: string; tokenLimit: number; dollarLimit: number }
): Promise<boolean> {
  const r = await proxyFetch(`/v1/budgets/${encodeURIComponent(goId)}`, {
    method: "PUT",
    headers: mgmtHeaders(),
    body: JSON.stringify({ level: p.level, key: p.key, window: p.window, token_limit: p.tokenLimit, dollar_limit: p.dollarLimit }),
  });
  return r.ok;
}

async function mirrorDelete(goId: string): Promise<boolean> {
  const r = await proxyFetch(`/v1/budgets/${encodeURIComponent(goId)}`, { method: "DELETE", headers: mgmtHeaders() });
  // 404 = enforcer never had it (e.g. created while proxy was down) — in sync.
  return r.ok || r.status === 404;
}

function validPayload(p: { level?: string; key?: string; window?: string; tokenLimit?: number; dollarLimit?: number }) {
  return (
    p &&
    (LEVELS as readonly string[]).includes(p.level ?? "") &&
    (WINDOWS as readonly string[]).includes(p.window ?? "") &&
    typeof p.key === "string" &&
    p.key.length > 0 &&
    (p.tokenLimit ?? 0) >= 0 &&
    (p.dollarLimit ?? 0) >= 0
  );
}

// GET /api/budgets?id=&history=1 — hierarchy with utilization + forecast.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const withHistory = url.searchParams.get("history") === "1";

  const rows = await queryOrNull<BudgetRow>(
    id
      ? `SELECT * FROM budgets WHERE id = $1`
      : `SELECT * FROM budgets ORDER BY level, scope_key, scope_window`,
    id ? [id] : []
  );
  const budgets: BudgetView[] = [];
  for (const b of rows ?? []) budgets.push(await toView(b, withHistory));
  return Response.json({ budgets });
}

// POST /api/budgets {level,key,window,tokenLimit,dollarLimit,ownerTeam?}
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_budget" }, { status: 400 });
  }
  const p = {
    level: String(body.level ?? ""),
    key: String(body.key ?? ""),
    window: String(body.window ?? ""),
    tokenLimit: Number(body.tokenLimit ?? 0),
    dollarLimit: Number(body.dollarLimit ?? 0),
    ownerTeam: String(body.ownerTeam ?? ""),
  };
  if (!validPayload(p)) return Response.json({ error: "invalid_budget" }, { status: 400 });

  const id = `b_${randomBytes(6).toString("hex")}`;
  const rows = await queryOrNull<BudgetRow>(
    `INSERT INTO budgets (id, level, scope_key, owner_team, scope_window, token_limit, dollar_limit)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (level, scope_key, scope_window)
     DO UPDATE SET token_limit = EXCLUDED.token_limit, dollar_limit = EXCLUDED.dollar_limit,
                   owner_team = EXCLUDED.owner_team, updated_at = now()
     RETURNING *`,
    [id, p.level, p.key, p.ownerTeam, p.window, p.tokenLimit, p.dollarLimit]
  );
  if (!rows?.[0]) return Response.json({ error: "unavailable" }, { status: 503 });
  const synced = await mirrorCreate(p);
  const res: Record<string, unknown> = { budget: await toView(rows[0], false) };
  if (!synced) res.proxySynced = false;
  return Response.json(res, { status: 201 });
}

// PUT /api/budgets?id= {tokenLimit?,dollarLimit?,window?} — raise/lower limits.
export async function PUT(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_budget" }, { status: 400 });
  }
  const rows = await queryOrNull<BudgetRow>(
    `UPDATE budgets SET
       token_limit = COALESCE($2, token_limit),
       dollar_limit = COALESCE($3, dollar_limit),
       scope_window = COALESCE($4, scope_window),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      id,
      body.tokenLimit === undefined ? null : Number(body.tokenLimit),
      body.dollarLimit === undefined ? null : Number(body.dollarLimit),
      body.window === undefined ? null : String(body.window),
    ]
  );
  if (!rows?.[0]) return Response.json({ error: "not_found" }, { status: 404 });
  const b = rows[0];
  const synced = await mirrorUpdate(goIdFor(b.level, b.scope_key, b.scope_window), {
    level: b.level,
    key: b.scope_key,
    window: body.window === undefined ? b.scope_window : String(body.window),
    tokenLimit: body.tokenLimit === undefined ? Number(b.token_limit) : Number(body.tokenLimit),
    dollarLimit: body.dollarLimit === undefined ? Number(b.dollar_limit) : Number(body.dollarLimit),
  });
  const res: Record<string, unknown> = { budget: await toView(b, false) };
  if (!synced) res.proxySynced = false;
  return Response.json(res);
}

// DELETE /api/budgets?id=
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });
  const rows = await queryOrNull<BudgetRow>(`DELETE FROM budgets WHERE id = $1 RETURNING *`, [id]);
  if (!rows?.[0]) return Response.json({ error: "not_found" }, { status: 404 });
  const b = rows[0];
  const synced = await mirrorDelete(goIdFor(b.level, b.scope_key, b.scope_window));
  const res: Record<string, unknown> = { deleted: id };
  if (!synced) res.proxySynced = false;
  return Response.json(res);
}
