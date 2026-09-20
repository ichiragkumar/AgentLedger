import { queryOrNull } from "@/lib/db";

export const dynamic = "force-dynamic";

type SumRow = { spend: string | null; requests: string | null };
type GroupRow = { key: string | null; spend: string | null; requests: string | null };
type DayRow = { day: string; spend: string | null; requests: string | null };

const num = (v: string | null | undefined) => Number(v ?? 0);

export async function GET() {
  const [s24, s7, s30] = await Promise.all([
    queryOrNull<SumRow>(
      "SELECT sum(cost_usd) AS spend, count(*) AS requests FROM request_logs WHERE ts > now() - interval '24 hours'"
    ),
    queryOrNull<SumRow>(
      "SELECT sum(cost_usd) AS spend, count(*) AS requests FROM request_logs WHERE ts > now() - interval '7 days'"
    ),
    queryOrNull<SumRow>(
      "SELECT sum(cost_usd) AS spend, count(*) AS requests FROM request_logs WHERE ts > now() - interval '30 days'"
    ),
  ]);
  const [byModel, byAgent, byTeam, trend] = await Promise.all([
    queryOrNull<GroupRow>(
      "SELECT model AS key, sum(cost_usd) AS spend, count(*) AS requests FROM request_logs GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 10"
    ),
    queryOrNull<GroupRow>(
      "SELECT nullif(agent_id,'') AS key, sum(cost_usd) AS spend, count(*) AS requests FROM request_logs GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 10"
    ),
    queryOrNull<GroupRow>(
      "SELECT nullif(team_id,'') AS key, sum(cost_usd) AS spend, count(*) AS requests FROM request_logs GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 10"
    ),
    queryOrNull<DayRow>(
      `SELECT to_char(date_trunc('day', ts), 'YYYY-MM-DD') AS day, sum(cost_usd) AS spend, count(*) AS requests
       FROM request_logs WHERE ts > now() - interval '14 days'
       GROUP BY 1 ORDER BY 1`
    ),
  ]);

  const group = (rows: GroupRow[] | null) =>
    (rows ?? [])
      .filter((r) => r.key)
      .map((r) => ({ key: r.key as string, spend: num(r.spend), requests: Number(r.requests ?? 0) }));

  return Response.json({
    spend24h: num(s24?.[0]?.spend),
    spend7d: num(s7?.[0]?.spend),
    spend30d: num(s30?.[0]?.spend),
    requests24h: Number(s24?.[0]?.requests ?? 0),
    byModel: group(byModel).map((g) => ({ model: g.key, spend: g.spend, requests: g.requests })),
    byAgent: group(byAgent).map((g) => ({ agent: g.key, spend: g.spend, requests: g.requests })),
    byTeam: group(byTeam).map((g) => ({ team: g.key, spend: g.spend, requests: g.requests })),
    trend: (trend ?? []).map((t) => ({ day: t.day, spend: num(t.spend), requests: Number(t.requests ?? 0) })),
  });
}
