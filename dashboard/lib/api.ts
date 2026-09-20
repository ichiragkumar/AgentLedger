// Dashboard API client. Server Components fetch the Next.js route handlers
// below (same origin, Postgres-backed); proxy health stays absolute.
export type SpendSlice = { key: string; spend: number; requests: number };

export type SpendSummary = {
  spend24h: number;
  spend7d: number;
  spend30d: number;
  requests24h: number;
  byModel: { model: string; spend: number; requests: number }[];
  byAgent: { agent: string; spend: number; requests: number }[];
  byTeam: { team: string; spend: number; requests: number }[];
  trend: { day: string; spend: number; requests: number }[];
};

export type TopRequest = {
  id: number;
  ts: string;
  model: string;
  agent_id: string;
  team_id: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
  status_code: number;
};

const emptySummary: SpendSummary = {
  spend24h: 0,
  spend7d: 0,
  spend30d: 0,
  requests24h: 0,
  byModel: [],
  byAgent: [],
  byTeam: [],
  trend: [],
};

const apiBase = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "";

export async function getSpendSummary(): Promise<SpendSummary> {
  try {
    const res = await fetch(`${apiBase}/api/spend`, { cache: "no-store" });
    if (!res.ok) return emptySummary;
    return (await res.json()) as SpendSummary;
  } catch {
    return emptySummary;
  }
}

export async function getTopRequests(): Promise<TopRequest[]> {
  try {
    const res = await fetch(`${apiBase}/api/requests`, { cache: "no-store" });
    if (!res.ok) return [];
    const body = (await res.json()) as { requests: TopRequest[] };
    return body.requests ?? [];
  } catch {
    return [];
  }
}

const proxyBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export async function getHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${proxyBase}/health`, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}
