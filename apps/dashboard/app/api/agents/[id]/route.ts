import { queryOrNull } from "@/lib/db";

export const dynamic = "force-dynamic";

type AggRow = { spend: string | null; tokens: string | null; requests: string | null };
type ModelRow = { model: string; spend: string | null; requests: string | null; tokens: string | null };
type DayRow = { day: string; spend: string | null; requests: string | null };
type ReqRow = {
  id: number;
  ts: string;
  model: string;
  team_id: string;
  project_id: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
  status_code: number;
  chain_id: string;
  virtual_key_prefix: string;
};
type BudgetRow = {
  id: string;
  level: string;
  scope_key: string;
  scope_window: string;
  token_limit: string;
  dollar_limit: string;
  spent_tokens: string;
  spent_usd: string;
  reset_at: string;
};

const num = (v: string | number | null | undefined) => Number(v ?? 0);

// GET /api/agents/:id — scoped cards: totals, 7d timeline, model breakdown,
// top-10 requests, budget status, virtual-key usage. 404 JSON when unknown.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const agent = decodeURIComponent(id).trim();
  if (!agent) return Response.json({ error: "not_found", agent: null }, { status: 404 });

  const [totals, byModel, timeline, top, budgets] = await Promise.all([
    queryOrNull<AggRow>(
      `SELECT sum(cost_usd) AS spend, sum(tokens_in + tokens_out) AS tokens, count(*) AS requests
       FROM request_logs WHERE agent_id = $1 AND ts > now() - interval '30 days'`,
      [agent]
    ),
    queryOrNull<ModelRow>(
      `SELECT model, sum(cost_usd) AS spend, count(*) AS requests, sum(tokens_in + tokens_out) AS tokens
       FROM request_logs WHERE agent_id = $1 AND ts > now() - interval '30 days'
       GROUP BY 1 ORDER BY 2 DESC`,
      [agent]
    ),
    queryOrNull<DayRow>(
      `SELECT to_char(date_trunc('day', ts), 'YYYY-MM-DD') AS day, sum(cost_usd) AS spend, count(*) AS requests
       FROM request_logs WHERE agent_id = $1 AND ts > now() - interval '7 days'
       GROUP BY 1 ORDER BY 1`,
      [agent]
    ),
    queryOrNull<ReqRow>(
      `SELECT id, ts, model, team_id, project_id, tokens_in, tokens_out, cost_usd,
              latency_ms, status_code, chain_id, virtual_key_prefix
       FROM request_logs WHERE agent_id = $1 ORDER BY cost_usd DESC LIMIT 10`,
      [agent]
    ),
    queryOrNull<BudgetRow>(
      `SELECT id, level, scope_key, scope_window, token_limit, dollar_limit,
              spent_tokens, spent_usd, reset_at
       FROM budgets WHERE level = 'agent' AND scope_key = $1`,
      [agent]
    ),
  ]);

  const requests = top ?? [];
  if (!totals?.[0]?.requests || num(totals[0].requests) === 0) {
    const known = await queryOrNull<{ n: string }>(
      `SELECT count(*) AS n FROM request_logs WHERE agent_id = $1`,
      [agent]
    );
    if (!known || num(known[0]?.n) === 0) {
      return Response.json({ error: "not_found", agent: null }, { status: 404 });
    }
  }

  return Response.json({
    agent: {
      name: agent,
      spend30d: num(totals?.[0]?.spend),
      tokens30d: num(totals?.[0]?.tokens),
      requests30d: num(totals?.[0]?.requests),
      byModel: (byModel ?? []).map((m) => ({
        model: m.model,
        spend: num(m.spend),
        requests: num(m.requests),
        tokens: num(m.tokens),
      })),
      timeline7d: (timeline ?? []).map((t) => ({
        day: t.day,
        spend: num(t.spend),
        requests: num(t.requests),
      })),
      topRequests: requests,
      // Prompt/response bodies are NOT stored (request_logs holds metadata
      // only); rows are PII-free by construction. Full bodies are a
      // deferred export (spec 17: expandable rows show headers + cost math).
      budgets: (budgets ?? []).map((b) => ({
        id: b.id,
        window: b.scope_window,
        tokenLimit: num(b.token_limit),
        dollarLimit: num(b.dollar_limit),
        spentTokens: num(b.spent_tokens),
        spentUsd: num(b.spent_usd),
        resetAt: b.reset_at,
      })),
      keyPrefixes: [...new Set(requests.map((r) => r.virtual_key_prefix).filter(Boolean))],
    },
  });
}
