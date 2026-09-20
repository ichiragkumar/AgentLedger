// GET /api/routing/distribution — live routing analytics over request_logs.
// Distribution + savings are live Postgres (mirrors router.SummarizeSavings:
// baseline prices the window's tokens at the frontier-tier rate, routed is
// observed cost_usd). Quality/escalation have no dashboard source yet (judge
// scores live in-process in the Go Guard) — explicit stub fields so the UI
// renders "not connected" instead of fake data. Zero-state safe, never 500.

import { queryOrNull } from "@/lib/db";
import { costAt, getTiers, priceOf } from "../_lib/db";

export const dynamic = "force-dynamic";

type ModelRow = { model: string; requests: string; spend: string; tin: string; tout: string };
type DayRow = { day: string; model: string; requests: string; spend: string };
type TokRow = { tin: string; tout: string };

const num = (v: string | number | null | undefined) => Number(v ?? 0);

export async function GET() {
  const [{ tiers }, byModel, daily, toks] = await Promise.all([
    getTiers(),
    queryOrNull<ModelRow>(
      `SELECT model, count(*) AS requests, coalesce(sum(cost_usd),0) AS spend,
              coalesce(sum(tokens_in),0) AS tin, coalesce(sum(tokens_out),0) AS tout
       FROM request_logs WHERE ts > now() - interval '7 days'
       GROUP BY 1 ORDER BY 2 DESC`
    ),
    queryOrNull<DayRow>(
      `SELECT to_char(date_trunc('day', ts), 'YYYY-MM-DD') AS day, model,
              count(*) AS requests, coalesce(sum(cost_usd),0) AS spend
       FROM request_logs WHERE ts > now() - interval '7 days'
       GROUP BY 1, 2 ORDER BY 1, 2`
    ),
    queryOrNull<TokRow>(
      `SELECT coalesce(sum(tokens_in),0) AS tin, coalesce(sum(tokens_out),0) AS tout
       FROM request_logs WHERE ts > now() - interval '7 days'`
    ),
  ]);

  const frontierModel = tiers.find((t) => t.id === "frontier")?.model ?? "gpt-4o";
  const frontierRate = priceOf(frontierModel);

  const rows = byModel ?? [];
  const totalReq = rows.reduce((a, r) => a + num(r.requests), 0);
  const byModelView = rows.map((r) => ({
    model: r.model,
    requests: num(r.requests),
    spend: num(r.spend),
    tokens: num(r.tin) + num(r.tout),
    share: totalReq > 0 ? num(r.requests) / totalReq : 0,
  }));

  const tin = num(toks?.[0]?.tin);
  const tout = num(toks?.[0]?.tout);
  const spent = rows.reduce((a, r) => a + num(r.spend), 0);
  // Canonical savings formula (must match router.SummarizeSavings): the
  // always-frontier baseline re-prices the window's tokens at the frontier
  // tier rate; saved clamps at 0, never negative.
  const wouldHaveSpent = costAt(frontierModel, tin, tout) ?? 0;
  const saved = Math.max(0, wouldHaveSpent - spent);
  const savedPct = wouldHaveSpent > 0 ? (saved / wouldHaveSpent) * 100 : 0;

  return Response.json({
    window: "7d",
    byModel: byModelView,
    daily: (daily ?? []).map((d) => ({ day: d.day, model: d.model, requests: num(d.requests), spend: num(d.spend) })),
    summary: {
      wouldHaveSpent: Math.round(wouldHaveSpent * 10000) / 10000,
      spent: Math.round(spent * 10000) / 10000,
      saved: Math.round(saved * 10000) / 10000,
      savedPct: Math.round(savedPct * 10) / 10,
      requests: totalReq,
    },
    frontier: {
      model: frontierModel,
      inputPer1M: frontierRate?.inputPer1M ?? null,
      outputPer1M: frontierRate?.outputPer1M ?? null,
    },
    // No judge/guard source in Postgres yet — stub, honestly labeled.
    quality: { perModel: [], source: "stub" as const, note: "judge scores live in-process (Go Guard); export pending" },
    escalation: { rate: 0, budget: 0.1, source: "stub" as const, note: "guard counters live in-process; export pending" },
  });
}
