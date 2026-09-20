import { queryOrNull } from "@/lib/db";

export const dynamic = "force-dynamic";

type Row = {
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

export async function GET() {
  const rows = await queryOrNull<Row>(
    `SELECT id, ts, model, agent_id, team_id, tokens_in, tokens_out, cost_usd, latency_ms, status_code
     FROM request_logs ORDER BY cost_usd DESC LIMIT 10`
  );
  return Response.json({ requests: rows ?? [] });
}
