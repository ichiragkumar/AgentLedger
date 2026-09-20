import { queryOrNull } from "@/lib/db";

export const dynamic = "force-dynamic";

type AgentRow = {
  agent: string;
  spend: number | string | null;
  tokens: number | string | null;
  requests: number | string | null;
  avg_latency: number | string | null;
  models: number | string | null;
  last_seen: string | null;
};

const num = (v: number | string | null | undefined) => Number(v ?? 0);

function rangeInterval(range: string): string {
  switch (range) {
    case "7d":
      return "7 days";
    case "30d":
      return "30 days";
    case "24h":
    default:
      return "24 hours";
  }
}

// GET /api/agents?range=24h|7d|30d&q=&limit=
// Postgres aggregates over request_logs; zero-state safe (never 500s).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const range = url.searchParams.get("range") ?? "30d";
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100) || 100, 1), 500);

  const rows = await queryOrNull<AgentRow>(
    `SELECT nullif(agent_id,'') AS agent,
            coalesce(sum(cost_usd),0) AS spend,
            coalesce(sum(tokens_in + tokens_out),0) AS tokens,
            count(*) AS requests,
            coalesce(avg(latency_ms),0) AS avg_latency,
            count(DISTINCT model) AS models,
            max(ts) AS last_seen
     FROM request_logs
     WHERE ts > now() - interval '${rangeInterval(range)}'
       AND agent_id <> ''
       AND ($1 = '' OR agent_id ILIKE '%' || $1 || '%')
     GROUP BY 1 ORDER BY 2 DESC LIMIT $2`,
    [q, limit]
  );

  // request_logs carries no cache-hit column (cache is Phase 2, cache-only
  // stores); expose cacheHitRate as null so UI renders "n/a", not a fake 0%.
  const agents = (rows ?? []).map((r) => ({
    name: r.agent,
    spend: num(r.spend),
    tokens: num(r.tokens),
    requests: num(r.requests),
    avgLatencyMs: num(r.avg_latency),
    models: num(r.models),
    cacheHitRate: null as number | null,
    lastSeen: r.last_seen,
  }));

  return Response.json({ agents, total: agents.length, range });
}
