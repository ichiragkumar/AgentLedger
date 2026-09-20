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
