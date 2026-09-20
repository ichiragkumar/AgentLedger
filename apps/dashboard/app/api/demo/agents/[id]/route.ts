// GET /api/demo/agents/:id — one logical demo agent (see catalog in
// app/api/demo/summary/route.ts): metered requests, model split, cache +
// routing annotations, budget state. Zero-state safe (never 500s); 404 JSON
// only when :id is not a known demo agent.
//
// Honesty notes (spec-21 contract):
// - cache annotation is ALWAYS "unknown": request_logs carries no cache-hit
//   column (cache stores live in Phase-2 cache-only stores). Render "n/a",
//   never a fake HIT/MISS or 0%.
// - routing annotation is the metered model path + inferred tier per model
//   (spec 17 §Routing tiers); rule-decision provenance activates with the
//   queued WIRING.md chain patches, so tier labels are `inferred`, not logged.
// - BEFORE spend is modeled at frontier gpt-4o rates (same assumption as
//   /api/demo/summary); AFTER is metered.

import { queryOrNull } from "@/lib/db";

export const dynamic = "force-dynamic";

const BASELINE_MODEL = "gpt-4o";
const BASELINE_INPUT_PER_1M = 2.5;
const BASELINE_OUTPUT_PER_1M = 10.0;

// Catalog duplicated from summary route (routes stay sibling-independent;
// NEW files only — no shared edits). Mirrors demo/runner.py.
const DEMO_AGENTS: Record<
  string,
  { label: string; team: string; blurb: string; memberAgentIds: string[] }
> = {
  "support-bot": {
    label: "support-bot",
    team: "support",
    blurb: "Repeat-prone customer FAQs (cache bait incl. near-duplicates).",
    memberAgentIds: ["support-bot"],
  },
  "ticket-classifier": {
    label: "ticket-classifier",
    team: "support",
    blurb: "Simple task on the cheapest tier.",
    memberAgentIds: ["ticket-classifier"],
  },
  summarizer: {
    label: "summarizer",
    team: "content",
    blurb: "Long-input article summaries, moderate tier.",
    memberAgentIds: ["summarizer"],
  },
  "code-reviewer": {
    label: "code-reviewer",
    team: "engineering",
    blurb: "Tier by complexity (haiku simple, sonnet complex).",
    memberAgentIds: ["code-reviewer"],
  },
  "research-agent": {
    label: "research-agent",
    team: "engineering",
    blurb: "3 chained steps: planner → researcher → writer (chain headers).",
    memberAgentIds: ["planner", "researcher", "writer"],
  },
};

// Inferred routing tier per model family (spec 17 §Routing). Labeled
// `inferred` — rule-decision provenance is pending chain patches.
function inferTier(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("flash") || m.includes("mini") || m.includes("haiku")) {
    if (m.includes("haiku")) return "moderate";
    return "simple";
  }
  if (m.includes("sonnet")) return "complex";
  if (m.includes("gpt-4o") || m.includes("o1") || m.includes("opus")) return "frontier";
  return "custom";
}

type ReqRow = {
  id: number;
  ts: string;
  model: string;
  agent_id: string;
  team_id: string;
  project_id: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
  status_code: number;
  chain_id: string;
  parent_agent_id: string;
  virtual_key_prefix: string;
};

type ModelRow = {
  model: string;
  spend: string | null;
  requests: string | null;
  tokens: string | null;
};

type BudgetRow = {
  id: string;
  level: string;
  scope_key: string;
  scope_window: string;
  token_limit: string;
  dollar_limit: string;
  spent_tokens: string;
  spent_usd: string;
  reset_at: string;
};

const num = (v: string | number | null | undefined) => Number(v ?? 0);

function budgetState(utilPct: number): "ok" | "notice" | "watch" | "exceeded" {
  if (utilPct > 90) return "exceeded";
  if (utilPct >= 75) return "watch";
  return "ok";
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const key = decodeURIComponent(id ?? "").trim();
  const demo = DEMO_AGENTS[key];
  if (!demo) return Response.json({ error: "not_found", agent: null }, { status: 404 });

  const members = demo.memberAgentIds;

  const [requests, models, agentBudgets, teamBudgets] = await Promise.all([
    queryOrNull<ReqRow>(
      `SELECT id, ts, model, agent_id, team_id, project_id, tokens_in, tokens_out,
              cost_usd, latency_ms, status_code, chain_id, parent_agent_id,
              virtual_key_prefix
       FROM request_logs
       WHERE agent_id = ANY($1)
       ORDER BY ts DESC LIMIT 20`,
      [members]
    ),
    queryOrNull<ModelRow>(
      `SELECT model,
              coalesce(sum(cost_usd),0) AS spend,
              count(*) AS requests,
              coalesce(sum(tokens_in + tokens_out),0) AS tokens
       FROM request_logs
       WHERE agent_id = ANY($1)
       GROUP BY 1 ORDER BY 2 DESC`,
      [members]
    ),
    queryOrNull<BudgetRow>(
      `SELECT id, level, scope_key, scope_window, token_limit, dollar_limit,
              spent_tokens, spent_usd, reset_at
       FROM budgets WHERE level = 'agent' AND scope_key = ANY($1)`,
      [members]
    ),
    queryOrNull<BudgetRow>(
      `SELECT id, level, scope_key, scope_window, token_limit, dollar_limit,
              spent_tokens, spent_usd, reset_at
       FROM budgets WHERE level = 'team' AND scope_key = $1`,
      [demo.team]
    ),
  ]);

  // budgets table may not exist yet (queryOrNull → null): zero-state, not 500.
  const toBudget = (b: BudgetRow) => {
    const dollarLimit = num(b.dollar_limit);
    const spentUsd = num(b.spent_usd);
    const utilPct = dollarLimit > 0 ? (spentUsd / dollarLimit) * 100 : 0;
    return {
      id: b.id,
      level: b.level,
      scopeKey: b.scope_key,
      window: b.scope_window,
      tokenLimit: num(b.token_limit),
      dollarLimit,
      spentTokens: num(b.spent_tokens),
      spentUsd,
      utilizationPct: utilPct,
      state: budgetState(utilPct),
      resetAt: b.reset_at,
    };
  };

  const rows = requests ?? [];
  // Scoped totals come from full-history aggregates so the header cards don't
  // depend on the LIMIT 20 window above.
  const agg = await queryOrNull<{ spend: string | null; requests: string | null; tin: string | null; tout: string | null }>(
    `SELECT coalesce(sum(cost_usd),0) AS spend, count(*) AS requests,
            coalesce(sum(tokens_in),0) AS tin, coalesce(sum(tokens_out),0) AS tout
     FROM request_logs WHERE agent_id = ANY($1)`,
    [members]
  );
  const afterSpend = num(agg?.[0]?.spend);
  const totalRequests = num(agg?.[0]?.requests);
  const tokensIn = num(agg?.[0]?.tin);
  const tokensOut = num(agg?.[0]?.tout);
  const beforeSpend = (tokensIn * BASELINE_INPUT_PER_1M + tokensOut * BASELINE_OUTPUT_PER_1M) / 1_000_000;

  const modelSplit = (models ?? []).map((m) => ({
    model: m.model,
    spend: num(m.spend),
    spendKind: "metered" as const,
    requests: num(m.requests),
    tokens: num(m.tokens),
    tier: inferTier(m.model),
    tierKind: "inferred" as const,
  }));

  return Response.json({
    agent: {
      id: key,
      label: demo.label,
      team: demo.team,
      blurb: demo.blurb,
      memberAgentIds: members,
      hasTraffic: totalRequests > 0,
      requests: totalRequests,
      afterSpend,
      afterKind: "metered" as const,
      beforeSpend,
      beforeKind: "modeled" as const,
      baselineModel: BASELINE_MODEL,
      savedUsd: beforeSpend - afterSpend,
      savingsPct: beforeSpend > 0 ? ((beforeSpend - afterSpend) / beforeSpend) * 100 : 0,
      modelSplit,
      routingNote:
        "Tier labels are inferred from the metered model path (spec 17 tiers). Rule-decision provenance activates with the queued WIRING.md chain patches.",
      requests20: rows.map((r) => ({
        id: r.id,
        ts: r.ts,
        model: r.model,
        agentId: r.agent_id,
        teamId: r.team_id,
        projectId: r.project_id,
        tokensIn: num(r.tokens_in),
        tokensOut: num(r.tokens_out),
        costUsd: num(r.cost_usd),
        costKind: "metered" as const,
        latencyMs: num(r.latency_ms),
        statusCode: r.status_code,
        chainId: r.chain_id || null,
        parentAgentId: r.parent_agent_id || null,
        // request_logs carries no cache-hit column: always unknown → UI n/a.
        cache: { status: "unknown" as const, kind: "unknown" as const },
        keyPrefix: r.virtual_key_prefix || null,
      })),
      cacheNote:
        "Cache HIT/MISS is unknown: request_logs has no cache-hit column (cache stores live in Phase-2 cache-only stores).",
      budgets: [...(agentBudgets ?? []), ...(teamBudgets ?? [])].map(toBudget),
      keyPrefixes: [...new Set(rows.map((r) => r.virtual_key_prefix).filter(Boolean))],
    },
  });
}
