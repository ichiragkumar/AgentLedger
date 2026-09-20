// AgentLedger dashboard API client (read plane vs Postgres-backed API).
// The Next.js route handlers behind these paths are stubbed until the
// management-plane API lands; panels render from props today.
const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export type SpendSummary = {
  spend24h: number;
  spend7d: number;
  spend30d: number;
  byModel: { model: string; spend: number }[];
  byAgent: { agent: string; spend: number }[];
  byTeam: { team: string; spend: number }[];
};

export async function getSpendSummary(): Promise<SpendSummary> {
  const res = await fetch(`${base}/api/spend`, { cache: "no-store" });
  if (!res.ok) {
    return { spend24h: 0, spend7d: 0, spend30d: 0, byModel: [], byAgent: [], byTeam: [] };
  }
  return res.json();
}

export async function getHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${base}/health`, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}
