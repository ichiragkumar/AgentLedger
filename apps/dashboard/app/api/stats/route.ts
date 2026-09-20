import { queryOrNull } from "@/lib/db";

export const dynamic = "force-dynamic";

type TotalsRow = {
  spend: string | null;
  requests: string | null;
  tokens: string | null;
  agents: string | null;
  models: string | null;
  teams: string | null;
};
type TopRow = { model: string | null; spend: string | null };

const num = (v: string | null | undefined) => Number(v ?? 0);

// GET /api/stats — public aggregate for landing/journey numbers.
// Cacheable (Cache-Control) — no PII, no key material, coarse sums only.
export async function GET() {
  const [s24, s7, s30, top] = await Promise.all([
    queryOrNull<TotalsRow>(
      `SELECT sum(cost_usd) AS spend, count(*) AS requests, sum(tokens_in + tokens_out) AS tokens,
              count(DISTINCT nullif(agent_id,'')) AS agents, count(DISTINCT model) AS models,
              count(DISTINCT nullif(team_id,'')) AS teams
       FROM request_logs WHERE ts > now() - interval '24 hours'`
    ),
    queryOrNull<TotalsRow>(
      `SELECT sum(cost_usd) AS spend, count(*) AS requests, sum(tokens_in + tokens_out) AS tokens,
              count(DISTINCT nullif(agent_id,'')) AS agents, count(DISTINCT model) AS models,
              count(DISTINCT nullif(team_id,'')) AS teams
       FROM request_logs WHERE ts > now() - interval '7 days'`
    ),
    queryOrNull<TotalsRow>(
      `SELECT sum(cost_usd) AS spend, count(*) AS requests, sum(tokens_in + tokens_out) AS tokens,
              count(DISTINCT nullif(agent_id,'')) AS agents, count(DISTINCT model) AS models,
              count(DISTINCT nullif(team_id,'')) AS teams
       FROM request_logs WHERE ts > now() - interval '30 days'`
    ),
    queryOrNull<TopRow>(
      `SELECT model, sum(cost_usd) AS spend FROM request_logs
       WHERE ts > now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 1`
    ),
  ]);

  const r24 = s24?.[0];
  const r7 = s7?.[0];
  const r30 = s30?.[0];

  return Response.json(
    {
      totals: {
        spend24h: num(r24?.spend),
        requests24h: num(r24?.requests),
        tokens24h: num(r24?.tokens),
        agents24h: num(r24?.agents),
        spend7d: num(r7?.spend),
        requests7d: num(r7?.requests),
        tokens7d: num(r7?.tokens),
        spend30d: num(r30?.spend),
        requests30d: num(r30?.requests),
        tokens30d: num(r30?.tokens),
        agents30d: num(r30?.agents),
        models30d: num(r30?.models),
        teams30d: num(r30?.teams),
        topModel30d: top?.[0]?.model ?? null,
      },
      // Cache/Saver + Router live numbers have no dashboard source yet
      // (Phase 2/3 stores are cache-only, not Postgres). Zeros keep the
      // landing honest until those APIs land — never fabricate.
      cache: { hitRatePct: 0, savedUsd7d: 0, source: "stub" as const },
      routing: { savedUsd7d: 0, source: "stub" as const },
      updatedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } }
  );
}
