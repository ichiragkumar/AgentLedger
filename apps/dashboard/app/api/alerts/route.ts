import { queryOrNull } from "@/lib/db";

export const dynamic = "force-dynamic";

// Alerts feed: recent enforcement/audit events + live threshold warnings.
//
// Reads Postgres audit_log (append-only, hash-chained per migration 002) and
// derives threshold warnings from budgets utilization. Zero-state safe.
//
// TODO(PROXY): the Go Dispatcher fans out within 60s of a breach and the
// in-memory AuditChain mirrors audit_log; once the proxy mounts the enforce
// API, merge GET /v1/audit here and forward POST /v1/alerts. Needed proxy
// endpoints: GET /v1/audit, GET/POST /v1/alerts, DELETE /v1/alerts/{id}.

type AuditRow = {
  seq: string;
  ts: string;
  actor: string;
  action: string;
  budget_id: string;
  detail: string;
};

type BudgetUtilRow = { id: string; level: string; scope_key: string; dollar_limit: string; spent_usd: string };

export type AlertItem = {
  id: string;
  ts: string;
  severity: "info" | "warning" | "critical";
  kind: string;
  title: string;
  detail: string;
  budgetId: string;
  source: "audit_log" | "derived";
};

const SEVERITY: Record<string, AlertItem["severity"]> = {
  "request.hard_stop": "critical",
  "request.loop_kill": "critical",
  "request.downgrade": "warning",
  "request.policy_deny": "warning",
  "alert.fire": "warning",
  "policy.change": "info",
  "budget.create": "info",
  "budget.update": "info",
  "budget.delete": "info",
};

const TITLE: Record<string, string> = {
  "request.hard_stop": "Budget hard stop (HTTP 429)",
  "request.loop_kill": "Runaway loop killed",
  "request.downgrade": "Auto-downgrade to cheaper model",
  "request.policy_deny": "Policy denied request",
  "alert.fire": "Budget threshold crossed",
  "policy.change": "Policy changed",
  "budget.create": "Budget created",
  "budget.update": "Budget updated",
  "budget.delete": "Budget deleted",
};

// GET /api/alerts?limit= (default 20, max 100)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 20, 1), 100);

  const [audit, utils] = await Promise.all([
    queryOrNull<AuditRow>(
      `SELECT seq, ts, actor, action, budget_id, detail
       FROM audit_log ORDER BY seq DESC LIMIT $1`,
      [limit]
    ),
    queryOrNull<BudgetUtilRow>(
      `SELECT id, level, scope_key, dollar_limit, spent_usd FROM budgets WHERE dollar_limit > 0`
    ),
  ]);

  const alerts: AlertItem[] = (audit ?? []).map((a) => ({
    id: `audit-${a.seq}`,
    ts: a.ts,
    severity: SEVERITY[a.action] ?? "info",
    kind: a.action,
    title: TITLE[a.action] ?? a.action,
    detail: a.detail,
    budgetId: a.budget_id,
    source: "audit_log",
  }));

  // Derived warnings: budgets ≥75% utilized without needing an audit row.
  for (const b of utils ?? []) {
    const pct = (Number(b.spent_usd) / Number(b.dollar_limit)) * 100;
    if (pct >= 75) {
      alerts.push({
        id: `derived-${b.id}`,
        ts: new Date().toISOString(),
        severity: pct >= 100 ? "critical" : pct >= 90 ? "warning" : "warning",
        kind: "budget.utilization",
        title: `Budget ${b.level}:${b.scope_key} at ${pct.toFixed(1)}%`,
        detail: `spent $${Number(b.spent_usd).toFixed(2)} of $${Number(b.dollar_limit).toFixed(2)}`,
        budgetId: b.id,
        source: "derived",
      });
    }
  }

  alerts.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return Response.json({ alerts: alerts.slice(0, limit) });
}

// POST /api/alerts — alert-routing configs live in the Go AlertRegistry
// (in-memory; no Postgres table). Proxy to the management plane when it
// lands; until then fail closed with a documented stub (never fake success).
export async function POST(req: Request) {
  const proxyBase = process.env.PROXY_MGMT_BASE ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  try {
    const res = await fetch(`${proxyBase}/v1/alerts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error(`proxy status ${res.status}`);
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json(data, { status: res.status });
  } catch {
    // TODO(PROXY): needs POST /v1/alerts on the Go management plane
    // (internal/enforce/api.go handleAlerts — mount API.RegisterRoutes).
    return Response.json(
      { error: "proxy_unreachable", todo: "PROXY: mount enforce management plane (POST /v1/alerts)" },
      { status: 503 }
    );
  }
}
