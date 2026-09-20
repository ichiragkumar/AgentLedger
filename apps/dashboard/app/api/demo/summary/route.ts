// GET /api/demo/summary — Demo-UI builder (spec 21 proof plan).
// Per kitchen-sink demo agent: BEFORE (modeled frontier baseline) vs AFTER
// (actual metered rows from request_logs). Zero-state safe (never 500s).
//
// BEFORE ASSUMPTION (documented, labeled `modeled` in every response):
// direct-to-provider baseline reprices the SAME token counts at frontier
// gpt-4o rates — input $2.50 / 1M, output $10.00 / 1M — mirroring
// data/prices.json via internal/pricing DefaultPrices. It is a MODEL, not a
// measurement: never present baseline as measured (spec-21 honesty contract).
// AFTER (`metered`): real proxy cost math grouped by agent_id.
//
// Demo catalog mirrors demo/runner.py: 5 logical agents; research-agent fans
// out to 3 chained agent_ids (planner → researcher → writer) sharing one
// virtual key. demo/* is read-only — this file duplicates the catalog.

import { queryOrNull } from "@/lib/db";

export const dynamic = "force-dynamic";

// --- modeled frontier baseline (gpt-4o, USD per 1M tokens) ---
const BASELINE_MODEL = "gpt-4o";
const BASELINE_INPUT_PER_1M = 2.5;
const BASELINE_OUTPUT_PER_1M = 10.0;

type DemoAgent = {
  id: string;
  label: string;
  team: string;
  blurb: string;
  // The real-world problem this agent proves (shown on cards + detail).
  problem: string;
  memberAgentIds: string[];
};

export const DEMO_AGENTS: DemoAgent[] = [
  {
    id: "support-bot",
    label: "support-bot",
    team: "support",
    blurb: "Repeat-prone customer FAQs (cache bait incl. near-duplicates).",
    problem: "Support teams pay frontier prices to re-answer the same questions — semantic caching serves repeats for $0.",
    memberAgentIds: ["support-bot"],
  },
  {
    id: "ticket-classifier",
    label: "ticket-classifier",
    team: "support",
    blurb: "Simple task on the cheapest tier.",
    problem: "Trivial classification burns flagship tokens — tier routing cuts it ~98% with no accuracy loss.",
    memberAgentIds: ["ticket-classifier"],
  },
  {
    id: "summarizer",
    label: "summarizer",
    team: "content",
    blurb: "Long-input article summaries, moderate tier.",
    problem: "Long contexts are the priciest tokens — right-sizing the model tier tames per-article cost.",
    memberAgentIds: ["summarizer"],
  },
  {
    id: "code-reviewer",
    label: "code-reviewer",
    team: "engineering",
    blurb: "Tier by complexity (haiku simple, sonnet complex).",
    problem: "One-size-fits-all models waste money — complexity-aware tiers match spend to difficulty.",
    memberAgentIds: ["code-reviewer"],
  },
  {
    id: "research-agent",
    label: "research-agent",
    team: "engineering",
    blurb: "3 chained steps: planner → researcher → writer (chain headers).",
    problem: "Multi-step swarms multiply cost and can loop forever — topology routing + chain budgets + loop kill keep them safe.",
    memberAgentIds: ["planner", "researcher", "writer"],
  },
];

type AgentRow = {
  agent: string;
  spend: string | null;
  tokens_in: string | null;
  tokens_out: string | null;
  requests: string | null;
  last_seen: string | null;
};

type ModelRow = {
  agent: string;
  model: string;
  spend: string | null;
  requests: string | null;
  tokens: string | null;
};

const num = (v: string | number | null | undefined) => Number(v ?? 0);

/** Modeled BEFORE cost for token counts at frontier baseline rates. */
function baselineCost(tokensIn: number, tokensOut: number): number {
  return (tokensIn * BASELINE_INPUT_PER_1M + tokensOut * BASELINE_OUTPUT_PER_1M) / 1_000_000;
}

function savingsPct(before: number, after: number): number {
  if (before <= 0) return 0;
  return ((before - after) / before) * 100;
}

export async function GET() {
  const [agents, models] = await Promise.all([
    queryOrNull<AgentRow>(
      `SELECT agent_id AS agent,
              coalesce(sum(cost_usd),0) AS spend,
              coalesce(sum(tokens_in),0) AS tokens_in,
              coalesce(sum(tokens_out),0) AS tokens_out,
              count(*) AS requests,
              max(ts) AS last_seen
       FROM request_logs
       WHERE agent_id <> ''
       GROUP BY 1`
    ),
    queryOrNull<ModelRow>(
      `SELECT agent_id AS agent, model,
              coalesce(sum(cost_usd),0) AS spend,
              count(*) AS requests,
              coalesce(sum(tokens_in + tokens_out),0) AS tokens
       FROM request_logs
       WHERE agent_id <> ''
       GROUP BY 1, 2 ORDER BY 3 DESC`
    ),
  ]);

  const byAgent = new Map<string, AgentRow>();
  for (const r of agents ?? []) byAgent.set(r.agent, r);
  const modelsByAgent = new Map<string, ModelRow[]>();
  for (const m of models ?? []) {
    const list = modelsByAgent.get(m.agent) ?? [];
    list.push(m);
    modelsByAgent.set(m.agent, list);
  }

  const cards = DEMO_AGENTS.map((demo) => {
    let afterSpend = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    let requests = 0;
    let lastSeen: string | null = null;
    const modelPath: { model: string; spend: number; requests: number; tokens: number }[] = [];

    for (const member of demo.memberAgentIds) {
      const row = byAgent.get(member);
      if (row) {
        afterSpend += num(row.spend);
        tokensIn += num(row.tokens_in);
        tokensOut += num(row.tokens_out);
        requests += num(row.requests);
        if (row.last_seen && (!lastSeen || row.last_seen > lastSeen)) lastSeen = row.last_seen;
      }
      for (const m of modelsByAgent.get(member) ?? []) {
        const found = modelPath.find((p) => p.model === m.model);
        if (found) {
          // Two member agents on the same model (e.g. planner + writer):
          // merge so model keys stay unique downstream.
          found.spend += num(m.spend);
          found.requests += num(m.requests);
          found.tokens += num(m.tokens);
        } else {
          modelPath.push({
            model: m.model,
            spend: num(m.spend),
            requests: num(m.requests),
            tokens: num(m.tokens),
          });
        }
      }
    }
    modelPath.sort((a, b) => b.spend - a.spend);

    const beforeSpend = baselineCost(tokensIn, tokensOut);
    const savedUsd = beforeSpend - afterSpend;
    return {
      id: demo.id,
      label: demo.label,
      team: demo.team,
      blurb: demo.blurb,
      problem: demo.problem,
      memberAgentIds: demo.memberAgentIds,
      hasTraffic: requests > 0,
      requests,
      tokens: tokensIn + tokensOut,
      tokensIn,
      tokensOut,
      afterSpend,
      afterKind: "metered" as const,
      beforeSpend,
      beforeKind: "modeled" as const,
      savedUsd,
      savingsPct: savingsPct(beforeSpend, afterSpend),
      modelPath,
      lastSeen,
    };
  });

  const totals = cards.reduce(
    (acc, c) => ({
      afterSpend: acc.afterSpend + c.afterSpend,
      beforeSpend: acc.beforeSpend + c.beforeSpend,
      requests: acc.requests + c.requests,
      tokens: acc.tokens + c.tokens,
    }),
    { afterSpend: 0, beforeSpend: 0, requests: 0, tokens: 0 }
  );
  const totalSaved = totals.beforeSpend - totals.afterSpend;

  return Response.json({
    baseline: {
      model: BASELINE_MODEL,
      inputPer1M: BASELINE_INPUT_PER_1M,
      outputPer1M: BASELINE_OUTPUT_PER_1M,
      kind: "modeled" as const,
      note: `BEFORE reprices metered token counts at frontier ${BASELINE_MODEL} rates — a model, not a measurement. AFTER is metered proxy cost math.`,
    },
    totals: {
      afterSpend: totals.afterSpend,
      afterKind: "metered" as const,
      beforeSpend: totals.beforeSpend,
      beforeKind: "modeled" as const,
      savedUsd: totalSaved,
      savingsPct: savingsPct(totals.beforeSpend, totals.afterSpend),
      requests: totals.requests,
      tokens: totals.tokens,
    },
    agents: cards,
    hasTraffic: totals.requests > 0,
  });
}
