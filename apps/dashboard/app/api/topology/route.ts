import { queryOrNull } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/topology — list discovered agent workflows.
//
// Sources (merged, zero-state safe — never 500s):
//   1. `workflow_graphs` (Phase 5 Brain discovery, spec 08 task 5.1) —
//      one row per X-Request-Chain-Id with nodes/edges JSONB.
//   2. `request_logs` chain_id fallback — chains the proxy has seen but
//      the Brain builder has not materialized yet.
// Live DB currently holds 0 graphs / 0 chained rows, so this returns
// `{ workflows: [] }` and the Topology page keeps its Coming banner +
// mock graph until data flows.

type GraphRow = {
  chain_id: string;
  updated_at: string;
  spans_seen: string | number | null;
  nodes: unknown;
  edges: unknown;
};

type ChainAggRow = {
  chain_id: string;
  steps: string | number | null;
  cost: string | number | null;
  requests: string | number | null;
  updated_at: string | null;
};

const num = (v: string | number | null | undefined) => Number(v ?? 0);

function countNodes(nodes: unknown): number {
  if (nodes && typeof nodes === "object" && !Array.isArray(nodes)) return Object.keys(nodes).length;
  return 0;
}

function countEdges(edges: unknown): number {
  return Array.isArray(edges) ? edges.length : 0;
}

export async function GET() {
  const [graphs, chains] = await Promise.all([
    queryOrNull<GraphRow>(
      `SELECT chain_id, updated_at, spans_seen, nodes, edges
       FROM workflow_graphs ORDER BY updated_at DESC LIMIT 100`
    ),
    queryOrNull<ChainAggRow>(
      `SELECT chain_id,
              count(DISTINCT nullif(agent_id,'')) AS steps,
              coalesce(sum(cost_usd),0) AS cost,
              count(*) AS requests,
              max(ts) AS updated_at
       FROM request_logs
       WHERE chain_id <> ''
       GROUP BY 1 ORDER BY 4 DESC LIMIT 100`
    ),
  ]);

  const byChain = new Map<
    string,
    { chainId: string; steps: number; edges: number; costUsd: number; requests: number; updatedAt: string | null; source: "workflow_graphs" | "request_logs" }
  >();

  for (const g of graphs ?? []) {
    if (!g.chain_id) continue;
    byChain.set(g.chain_id, {
      chainId: g.chain_id,
      steps: countNodes(g.nodes),
      edges: countEdges(g.edges),
      costUsd: 0, // enriched from request_logs below when present
      requests: num(g.spans_seen),
      updatedAt: g.updated_at,
      source: "workflow_graphs",
    });
  }

  for (const c of chains ?? []) {
    if (!c.chain_id) continue;
    const prev = byChain.get(c.chain_id);
    if (prev) {
      prev.costUsd = num(c.cost);
      prev.requests = Math.max(prev.requests, num(c.requests));
      if (!prev.updatedAt || (c.updated_at && c.updated_at > prev.updatedAt)) prev.updatedAt = c.updated_at;
      if (prev.steps === 0) prev.steps = num(c.steps);
    } else {
      byChain.set(c.chain_id, {
        chainId: c.chain_id,
        steps: num(c.steps),
        edges: 0,
        costUsd: num(c.cost),
        requests: num(c.requests),
        updatedAt: c.updated_at,
        source: "request_logs",
      });
    }
  }

  const workflows = [...byChain.values()].sort((a, b) =>
    String(b.updatedAt ?? "") < String(a.updatedAt ?? "") ? -1 : 1
  );
  return Response.json({ workflows, total: workflows.length });
}
