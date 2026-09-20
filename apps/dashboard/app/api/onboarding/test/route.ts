import { queryOrNull } from "@/lib/db";

export const dynamic = "force-dynamic";

type Row = { n: string; last_seen: string | null; chains: string | null };

// Onboarding step 3: proxy connection test. Polls request_logs for the
// first row (optionally scoped by virtual-key prefix and/or chain id) —
// green tick as soon as the proxy logs the first proxied request.
// GET /api/onboarding/test?keyPrefix=&chainId=&windowMinutes=15
export async function GET(req: Request) {
  const url = new URL(req.url);
  const keyPrefix = (url.searchParams.get("keyPrefix") ?? "").trim();
  const chainId = (url.searchParams.get("chainId") ?? "").trim();
  const windowMinutes = Math.min(Math.max(Number(url.searchParams.get("windowMinutes") ?? 15) || 15, 1), 1440);

  const rows = await queryOrNull<Row>(
    `SELECT count(*) AS n, max(ts) AS last_seen,
            count(DISTINCT nullif(chain_id,'')) AS chains
     FROM request_logs
     WHERE ts > now() - ($1 || ' minutes')::interval
       AND ($2 = '' OR virtual_key_prefix = $2)
       AND ($3 = '' OR chain_id = $3)`,
    [String(windowMinutes), keyPrefix, chainId]
  );
  const r = rows?.[0];
  const seen = Number(r?.n ?? 0);

  const sample = seen
    ? await queryOrNull<{
        id: number;
        ts: string;
        model: string;
        agent_id: string;
        cost_usd: number;
      }>(
        `SELECT id, ts, model, agent_id, cost_usd FROM request_logs
         WHERE ts > now() - ($1 || ' minutes')::interval
           AND ($2 = '' OR virtual_key_prefix = $2)
           AND ($3 = '' OR chain_id = $3)
         ORDER BY id DESC LIMIT 1`,
        [String(windowMinutes), keyPrefix, chainId]
      )
    : null;

  return Response.json({
    connected: seen > 0,
    requestsSeen: seen,
    chainsSeen: Number(r?.chains ?? 0),
    lastSeen: r?.last_seen ?? null,
    keyPrefix: keyPrefix || null,
    chainId: chainId || null,
    sample: sample?.[0] ?? null,
    hint: seen > 0 ? null : "Send a request through the proxy, then retry.",
  });
}
