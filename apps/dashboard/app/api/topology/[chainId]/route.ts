import { queryOrNull } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/topology/:chainId — single workflow graph with per-step cost,
// model, failure rate, criticality stub, and tier.
//
// Provenance:
//   - Structure (nodes/edges/roots) prefers `workflow_graphs` (Brain
//     discovery). When absent, structure is rebuilt from `request_logs`
//     parent_agent_id links for the chain (same algorithm family as
//     internal/brain graph.go, string-contract only — no Go imports).
//   - Per-step numbers come from `request_logs` aggregates; `step_stats`
//     refines failureRate when the learner has written it.
//   - quality is 0 (unjudged): request_logs stores metadata only.
//   - criticality is a transparent heuristic stub (downstream-waste share
//     blended with failure rate) until Brain weight pushes land; the
//     response flags `criticalitySource: "heuristic"`.
//
// Zero-state safe: 404 JSON `{ error: "not_found" }` when neither source
// knows the chain — never a 500.

type GraphRow = {
  chain_id: string;
  updated_at: string;
  nodes: unknown;
  edges: unknown;
  roots: unknown;
};

type StepAggRow = {
  agent_id: string;
  parent_agent_id: string;
  model: string;
  calls: string | number | null;
  cost: string | number | null;
  failures: string | number | null;
  tokens: string | number | null;
};

type StatRow = {
  agent_id: string;
  failure_rate: string | number | null;
  avg_cost_usd: string | number | null;
};

const num = (v: string | number | null | undefined) => Number(v ?? 0);

type Tier = "frontier" | "standard" | "cheap";

function tierFor(criticality: number): Tier {
  if (criticality >= 0.7) return "frontier";
  if (criticality >= 0.35) return "standard";
  return "cheap";
}

function asPairs(edges: unknown): Array<[string, string]> {
  if (!Array.isArray(edges)) return [];
  const out: Array<[string, string]> = [];
  for (const e of edges) {
    if (Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "string") out.push([e[0], e[1]]);
    else if (e && typeof e === "object") {
      const o = e as Record<string, unknown>;
      const from = typeof o.from === "string" ? o.from : typeof o[0] === "string" ? (o[0] as string) : null;
      const to = typeof o.to === "string" ? o.to : typeof o[1] === "string" ? (o[1] as string) : null;
      if (from && to) out.push([from, to]);
    }
  }
  return out;
}

function asRoots(roots: unknown): string[] {
  return Array.isArray(roots) ? roots.filter((r): r is string => typeof r === "string") : [];
}

export async function GET(_req: Request, ctx: { params: Promise<{ chainId: string }> }) {
  const { chainId } = await ctx.params;
  const chain = decodeURIComponent(chainId).trim();
  if (!chain) return Response.json({ error: "not_found", workflow: null }, { status: 404 });

  const [graphs, steps, stats] = await Promise.all([
    queryOrNull<GraphRow>(`SELECT chain_id, updated_at, nodes, edges, roots FROM workflow_graphs WHERE chain_id = $1`, [chain]),
    queryOrNull<StepAggRow>(
      `SELECT agent_id,
              max(parent_agent_id) AS parent_agent_id,
              (SELECT l2.model FROM request_logs l2
                WHERE l2.chain_id = $1 AND l2.agent_id = l.agent_id
                GROUP BY 1 ORDER BY count(*) DESC LIMIT 1) AS model,
              count(*) AS calls,
              coalesce(sum(cost_usd),0) AS cost,
              count(*) FILTER (WHERE status_code < 200 OR status_code >= 300) AS failures,
              coalesce(sum(tokens_in + tokens_out),0) AS tokens
       FROM request_logs l
       WHERE chain_id = $1 AND agent_id <> ''
       GROUP BY 1 ORDER BY min(ts)`,
      [chain]
    ),
    queryOrNull<StatRow>(
      `SELECT DISTINCT ON (agent_id) agent_id, failure_rate, avg_cost_usd
       FROM step_stats WHERE agent_id IN (SELECT DISTINCT agent_id FROM request_logs WHERE chain_id = $1 AND agent_id <> '')
       ORDER BY agent_id, window_start DESC`,
      [chain]
    ),
  ]);

  const graph = graphs?.[0] ?? null;
  const rows = steps ?? [];
  if (!graph && rows.length === 0) {
    return Response.json({ error: "not_found", workflow: null }, { status: 404 });
  }

  const statByAgent = new Map((stats ?? []).map((s) => [s.agent_id, s]));
  const byAgent = new Map(rows.map((r) => [r.agent_id, r]));

  // Edges: Brain materialization wins; otherwise parent links from logs.
  let pairs = graph ? asPairs(graph.edges) : [];
  if (pairs.length === 0) {
    pairs = rows
      .filter((r) => r.parent_agent_id && byAgent.has(r.parent_agent_id))
      .map((r): [string, string] => [r.parent_agent_id, r.agent_id]);
  }
  // Dedupe while preserving discovery order.
  const seen = new Set<string>();
  const edges = pairs.filter(([a, b]) => {
    const k = `${a}→${b}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Depth via BFS from roots (Brain roots win; else nodes with no incoming).
  const incoming = new Map<string, number>();
  for (const [, b] of edges) incoming.set(b, (incoming.get(b) ?? 0) + 1);
  const agentIds = rows.length > 0 ? rows.map((r) => r.agent_id) : [...new Set(edges.flat())];
  let roots = graph ? asRoots(graph.roots).filter((r) => agentIds.includes(r)) : [];
  if (roots.length === 0) roots = agentIds.filter((a) => (incoming.get(a) ?? 0) === 0);
  if (roots.length === 0 && agentIds.length > 0) roots = [agentIds[0]];
  const depth = new Map<string, number>(roots.map((r) => [r, 0]));
  const queue = [...roots];
  const children = new Map<string, string[]>();
  for (const [a, b] of edges) {
    const list = children.get(a) ?? [];
    list.push(b);
    children.set(a, list);
  }
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const next of children.get(cur) ?? []) {
      if (!depth.has(next)) {
        depth.set(next, (depth.get(cur) ?? 0) + 1);
        queue.push(next);
      }
    }
  }

  // Downstream waste: cost of all nodes reachable after this one.
  const memo = new Map<string, number>();
  const downstream = (id: string, visiting = new Set<string>()): number => {
    if (memo.has(id)) return memo.get(id) as number;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let total = 0;
    for (const next of children.get(id) ?? []) {
      total += num(byAgent.get(next)?.cost) + downstream(next, visiting);
    }
    visiting.delete(id);
    memo.set(id, total);
    return total;
  };
  const totalCost = agentIds.reduce((s, a) => s + num(byAgent.get(a)?.cost), 0);

  const detailSteps = agentIds.map((id) => {
    const r = byAgent.get(id);
    const st = statByAgent.get(id);
    const failureRate = st ? num(st.failure_rate) : r ? num(r.failures) / Math.max(1, num(r.calls)) : 0.1;
    const wasteShare = totalCost > 0 ? downstream(id) / totalCost : 0;
    // Heuristic criticality: 60% downstream-waste share + 40% failure rate.
    const criticality = Math.min(1, Math.max(0, 0.6 * wasteShare + 0.4 * Math.min(1, failureRate * 3)));
    return {
      id,
      depth: depth.get(id) ?? 0,
      model: r?.model ?? "unknown",
      costUsd: r ? num(r.cost) / Math.max(1, num(r.calls)) : (st ? num(st.avg_cost_usd) : 0),
      quality: 0,
      failureRate,
      criticality,
      tier: tierFor(criticality),
      calls: r ? num(r.calls) : 0,
      tokens: r ? num(r.tokens) : 0,
    };
  });

  return Response.json({
    workflow: {
      chainId: chain,
      steps: detailSteps,
      edges: edges.map(([from, to]) => ({ from, to })),
      expectedTotalUsd: totalCost,
      savingsVsUniform: null, // needs Brain optimizer weights (spec 08 §5.4)
      criticalitySource: "heuristic" as const,
      source: graph ? ("workflow_graphs" as const) : ("request_logs" as const),
      updatedAt: graph?.updated_at ?? null,
    },
  });
}
