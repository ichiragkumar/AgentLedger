import { queryOrNull } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/events — SSE: new request + alert events, 60s bound.
//
// Polls request_logs + audit_log every 3s, emits `request` / `alert` events
// with last-seen high-water marks, heartbeats idle ticks, then closes the
// stream after 60s (client reconnects with ?sinceId= / ?sinceSeq=).

type ReqRow = {
  id: string;
  ts: string;
  model: string;
  agent_id: string;
  team_id: string;
  cost_usd: number;
  status_code: number;
  chain_id: string;
};
type AuditRow = { seq: string; ts: string; action: string; budget_id: string; detail: string };

const POLL_MS = 3000;
const MAX_AGE_MS = 60_000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  let sinceId = Number(url.searchParams.get("sinceId") ?? 0) || 0;
  let sinceSeq = Number(url.searchParams.get("sinceSeq") ?? 0) || 0;

  // Seed high-water marks so a fresh connect doesn't replay history.
  if (!sinceId && !sinceSeq) {
    const [mx, ms] = await Promise.all([
      queryOrNull<{ m: string | null }>(`SELECT max(id) AS m FROM request_logs`),
      queryOrNull<{ m: string | null }>(`SELECT max(seq) AS m FROM audit_log`),
    ]);
    sinceId = Number(mx?.[0]?.m ?? 0) || 0;
    sinceSeq = Number(ms?.[0]?.m ?? 0) || 0;
  }

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (chunk: string) => {
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          /* client gone */
        }
      };
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        send(`event: close\ndata: {"reason":"max_age"}\n\n`);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const tick = async () => {
        if (closed || req.signal.aborted) return close();
        try {
          const [reqs, audits] = await Promise.all([
            queryOrNull<ReqRow>(
              `SELECT id, ts, model, agent_id, team_id, cost_usd, status_code, chain_id
               FROM request_logs WHERE id > $1 ORDER BY id ASC LIMIT 50`,
              [sinceId]
            ),
            queryOrNull<AuditRow>(
              `SELECT seq, ts, action, budget_id, detail FROM audit_log WHERE seq > $1 ORDER BY seq ASC LIMIT 50`,
              [sinceSeq]
            ),
          ]);
          let emitted = false;
          for (const r of reqs ?? []) {
            sinceId = Math.max(sinceId, Number(r.id));
            send(
              `event: request\ndata: ${JSON.stringify({
                id: Number(r.id),
                ts: r.ts,
                model: r.model,
                agent: r.agent_id,
                team: r.team_id,
                costUsd: Number(r.cost_usd),
                status: r.status_code,
                chainId: r.chain_id,
              })}\n\n`
            );
            emitted = true;
          }
          for (const a of audits ?? []) {
            sinceSeq = Math.max(sinceSeq, Number(a.seq));
            send(
              `event: alert\ndata: ${JSON.stringify({
                seq: Number(a.seq),
                ts: a.ts,
                action: a.action,
                budgetId: a.budget_id,
                detail: a.detail,
              })}\n\n`
            );
            emitted = true;
          }
          if (!emitted) send(`: ping ${Date.now()}\n\n`);
        } catch {
          send(`: poll_error\n\n`);
        }
      };

      const timer = setInterval(tick, POLL_MS);
      setTimeout(close, MAX_AGE_MS);
      req.signal.addEventListener("abort", close);
      send(`event: open\ndata: {"sinceId":${sinceId},"sinceSeq":${sinceSeq},"boundMs":${MAX_AGE_MS}}\n\n`);
      void tick();
    },
    cancel() {
      /* client disconnected; interval cleared in close() */
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
