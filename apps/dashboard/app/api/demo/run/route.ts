import { readFile } from "node:fs/promises";
import path from "node:path";
import { proxyBase } from "../../_lib/proxy-mgmt";
import { queryOrNull } from "@/lib/db";
import { issueKey } from "../../_lib/virtual-keys";

export const dynamic = "force-dynamic";

// Demo runner API — drives the kitchen-sink agents from the UI so /demo is
// fully actionable (no terminal needed). Reads the SAME fixtures as
// demo/runner.py (single source); fires OpenAI-compatible calls at the proxy
// with per-agent keys + attribution headers; keys are issued fresh per run
// (material used immediately, never stored) and budgets ensured idempotently.
//
// GET → service status (proxy healthy? mock upstream reachable?).
// POST {cycles?, agent?, mode?: "proxy"|"direct"} — run traffic.
//   proxy (default): through AgentLedger (metered rows, keys, budgets).
//   direct: STRAIGHT at the mock upstream, bypassing the proxy — the BEFORE
//     run. Nothing is logged (that's the point: billed blind). Returns
//     token counts repriced at frontier gpt-4o rates ($2.50/$10.00 per 1M,
//     same constants as the summary baseline) + visibility:"none".
// DELETE → purge demo rows (keys, budgets, logs). All zero-state safe.

const FIX_DIR = path.join(process.cwd(), "..", "..", "demo", "fixtures");

type AgentDef = {
  id: string;
  team: string;
  build: (i: number, fx: Fixtures) => Call[];
};

type Call = {
  agent: string;
  team: string;
  model: string;
  messages: { role: string; content: string }[];
  chain?: string;
  parent?: string;
};

type Fixtures = {
  faqs: string[];
  tickets: string[];
  articles: { title: string; body: string }[];
  code: { id: string; complexity: string; language: string; code: string }[];
  research: string[];
};

const AGENTS: AgentDef[] = [
  {
    // OpenRouter FREE tier (distinct model per app; $0 metered).
    // Pinned server-side by config/routing-rules.yaml so the classifier
    // never rewrites demo traffic. Keys: OPENROUTER_API_KEY (env-only).
    id: "support-bot", team: "support",
    build: (i, fx) => {
      const q = fx.faqs[i % fx.faqs.length];
      return [{ agent: "support-bot", team: "support", model: "nex-agi/nex-n2.5-mini:free",
        messages: [{ role: "user", content: `Answer this customer FAQ concisely: ${q}` }] }];
    },
  },
  {
    id: "ticket-classifier", team: "support",
    build: (i, fx) => {
      const t = fx.tickets[i % fx.tickets.length];
      return [{ agent: "ticket-classifier", team: "support", model: "liquid/lfm-2.5-2.6b:free",
        messages: [{ role: "user", content: `Classify this support ticket as billing/technical/general/urgent with priority and sentiment: ${t}` }] }];
    },
  },
  {
    id: "summarizer", team: "content",
    build: (i, fx) => {
      const a = fx.articles[i % fx.articles.length];
      return [{ agent: "summarizer", team: "content", model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
        messages: [{ role: "user", content: `Summarize this article in 3 bullet points. Title: ${a.title}. Body: ${a.body}` }] }];
    },
  },
  {
    id: "code-reviewer", team: "engineering",
    build: (i, fx) => {
      const c = fx.code[i % fx.code.length];
      return [{ agent: "code-reviewer", team: "engineering", model: "cohere/north-mini-code:free",
        messages: [{ role: "user", content: `Review this ${c.language} code. Return issues, suggestions, score/10: ${c.code}` }] }];
    },
  },
  {
    id: "research-agent", team: "engineering",
    build: (i, fx) => {
      const rq = fx.research[i % fx.research.length];
      const chain = `demo-ui-${Date.now() % 100000}`;
      const model = "nex-agi/nex-n2.5-pro:free";
      return [
        { agent: "planner", team: "engineering", model,
          messages: [{ role: "user", content: `Break this research question into 3 sub-questions: ${rq}` }], chain },
        { agent: "researcher", team: "engineering", model,
          messages: [{ role: "user", content: `Research and summarize 3 sources about: ${rq}` }], chain, parent: "planner" },
        { agent: "writer", team: "engineering", model,
          messages: [{ role: "user", content: `Synthesize a final structured answer about: ${rq}` }], chain, parent: "researcher" },
      ];
    },
  },
];

const BUDGETS = [
  { level: "team", key: "support", window: "monthly", tokenLimit: 2000000, dollarLimit: 5 },
  { level: "team", key: "content", window: "monthly", tokenLimit: 2000000, dollarLimit: 5 },
  { level: "team", key: "engineering", window: "monthly", tokenLimit: 2000000, dollarLimit: 10 },
];

async function loadFixtures(): Promise<Fixtures | null> {
  try {
    const [faqs, tickets, articles, code, research] = await Promise.all(
      ["faqs.json", "tickets.json", "articles.json", "code.json", "research.json"].map(async (f) =>
        JSON.parse(await readFile(path.join(FIX_DIR, f), "utf8"))
      )
    );
    return { faqs, tickets, articles, code, research };
  } catch {
    return null;
  }
}

async function proxyHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${proxyBase()}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function mockReachable(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:9999/__mock_ping__", {
      method: "POST", body: "{}",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function fireProxy(call: Call, key: string): Promise<{ ok: boolean; ms: number; error?: string }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "AgentLedger-Key": key,
    "X-Agent-Id": call.agent,
    "X-Team-Id": call.team,
    "X-Project-Id": "acme-demo",
  };
  if (call.chain) headers["X-Request-Chain-Id"] = call.chain;
  if (call.parent) headers["X-Parent-Agent-Id"] = call.parent;
  const t0 = Date.now();
  try {
    const res = await fetch(`${proxyBase()}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: call.model, messages: call.messages }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return { ok: false, ms: Date.now() - t0, error: `proxy ${res.status} (upstream rejected — is the mock running and proxy *_BASE_URL pointed at :9999, or a provider key set?)` };
    await res.json().catch(() => null);
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message.slice(0, 120) : "unreachable" };
  }
}

export async function GET() {
  const [healthy, mock] = await Promise.all([proxyHealth(), mockReachable()]);
  return Response.json({ proxyHealthy: healthy, mockReachable: mock, proxy: proxyBase() });
}

// Frontier baseline rates — SAME constants as the summary baseline
// (spec: single source of truth lives in the summary route).
const BASE_IN_PER_1M = 2.5;
const BASE_OUT_PER_1M = 10.0;

// Per-agent real providers (user-supplied keys, env-only, never logged or
// returned). OpenRouter FREE tier by default — one distinct free model per
// app (costs meter $0.00). Add paid/vendor keys here as they arrive.
const OR_BASE = "https://openrouter.ai/api";
const OR_KEY_ENV = "OPENROUTER_API_KEY";
const REAL_PROVIDERS: Record<string, { base: string; keyEnv: string }> = {
  "support-bot": { base: OR_BASE, keyEnv: OR_KEY_ENV },
  "ticket-classifier": { base: OR_BASE, keyEnv: OR_KEY_ENV },
  "summarizer": { base: OR_BASE, keyEnv: OR_KEY_ENV },
  "code-reviewer": { base: OR_BASE, keyEnv: OR_KEY_ENV },
  "research-agent": { base: OR_BASE, keyEnv: OR_KEY_ENV },
};

// Direct (BEFORE) run: identical fixtures fired STRAIGHT at the upstream,
// bypassing the proxy entirely. Nothing is logged, no key, no budget, no
// routing — that absence IS the measurement: billed blind at frontier rates.
async function runDirect(defs: AgentDef[], cycles: number, fx: Fixtures) {
  const mockOk = await mockReachable();
  let tokensIn = 0;
  let tokensOut = 0;
  let ran = 0;
  let failed = 0;
  let realCalls = 0;
  const perAgent: Record<string, { requests: number; tokensIn: number; tokensOut: number }> = {};
  for (let i = 0; i < cycles; i++) {
    for (const d of defs) {
      // Real provider when configured for this agent (server-side key, never
      // exposed); otherwise the mock. Either way the proxy is bypassed.
      const real = REAL_PROVIDERS[d.id];
      const realKey = real ? (process.env[real.keyEnv] ?? "").trim() : "";
          const target = real && realKey ? real.base : "http://127.0.0.1:9999";
      for (const call of d.build(i, fx)) {
        try {
          const headers: Record<string, string> = { "content-type": "application/json" };
          if (realKey && real) {
            headers["Authorization"] = `Bearer ${realKey}`;
            realCalls++;
          }
          const res = await fetch(`${target}/v1/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify({ model: call.model, messages: call.messages }),
            signal: AbortSignal.timeout(60000),
          });
          if (!res.ok) {
            failed++;
            continue;
          }
          const body = (await res.json()) as { usage?: { prompt_tokens?: number; completion_tokens?: number } };
          const tin = Number(body.usage?.prompt_tokens ?? 0);
          const tout = Number(body.usage?.completion_tokens ?? 0);
          tokensIn += tin;
          tokensOut += tout;
          ran++;
          const pa = (perAgent[d.id] ??= { requests: 0, tokensIn: 0, tokensOut: 0 });
          pa.requests++;
          pa.tokensIn += tin;
          pa.tokensOut += tout;
        } catch {
          failed++;
        }
      }
    }
  }
  const modeled = (tokensIn * BASE_IN_PER_1M + tokensOut * BASE_OUT_PER_1M) / 1_000_000;
  return Response.json({
    mode: "direct",
    ran, ok: ran, failed,
    agents: defs.map((d) => d.id), cycles,
    tokensIn, tokensOut,
    modeledSpend: modeled,
    realCalls,
    mockReachable: mockOk,
    warning: mockOk
      ? null
      : "mock upstream unreachable — mock-backed agents failed; start demo/mock_upstream.py (:9999)",
    visibility: "none — bypassed the proxy: no rows, no attribution, no budgets, no routing",
    perAgent: Object.fromEntries(
      Object.entries(perAgent).map(([id, p]) => [
        id, { ...p, modeledSpend: (p.tokensIn * BASE_IN_PER_1M + p.tokensOut * BASE_OUT_PER_1M) / 1_000_000 },
      ])
    ),
  }, { status: ran > 0 ? 200 : 502 });
}

export async function POST(req: Request) {
  let body: { cycles?: number; agent?: string; mode?: string };
  try {
    body = (await req.json()) as { cycles?: number; agent?: string; mode?: string };
  } catch {
    body = {};
  }
  const cycles = Math.min(Math.max(Number(body.cycles ?? 1) || 1, 1), 5);
  const only = (body.agent ?? "").trim();
  const mode = body.mode === "direct" ? "direct" : "proxy";

  const fx = await loadFixtures();
  if (!fx) return Response.json({ error: "fixtures_missing", detail: "demo/fixtures not readable from dashboard cwd" }, { status: 503 });

  const defs = only ? AGENTS.filter((a) => a.id === only) : AGENTS;
  if (only && defs.length === 0) return Response.json({ error: "unknown_agent" }, { status: 404 });

  if (mode === "direct") return runDirect(defs, cycles, fx);

  if (!(await proxyHealth())) return Response.json({ error: "proxy_unreachable" }, { status: 503 });
  const mock = await mockReachable();

  // Fresh keys per run (material used immediately, never stored).
  const keys: Record<string, string> = {};
  for (const d of defs) {
    try {
      const { fullKey } = await issueKey({ name: `vk_demo_${d.id}`, agentScope: d.id, teamScope: d.team });
      keys[d.id] = fullKey;
    } catch {
      return Response.json({ error: "key_issue_failed" }, { status: 503 });
    }
  }

  // Idempotent budgets.
  for (const b of BUDGETS) {
    await queryOrNull(
      `INSERT INTO budgets (id, level, scope_key, owner_team, scope_window, token_limit, dollar_limit)
       VALUES ('demo-' || $1 || '-' || $2 || '-' || $3, $1, $2, '', $3, $4, $5)
       ON CONFLICT (level, scope_key, scope_window) DO NOTHING`,
      [b.level, b.key, b.window, b.tokenLimit, b.dollarLimit]
    );
  }

  const results: { agent: string; model: string; ok: boolean; ms: number; error?: string }[] = [];
  for (let i = 0; i < cycles; i++) {
    for (const d of defs) {
      for (const call of d.build(i, fx)) {
        const r = await fireProxy(call, keys[d.id]);
        results.push({ agent: call.agent, model: call.model, ...r });
      }
    }
  }
  const ok = results.filter((r) => r.ok).length;
  const res: Record<string, unknown> = {
    ran: results.length, ok, failed: results.length - ok,
    agents: defs.map((d) => d.id), cycles,
    results,
    warning: mock ? null : "mock upstream unreachable — rows log but cost $0 without usage; start demo/mock_upstream.py + point proxy *_BASE_URL at :9999",
  };
  return Response.json(res, { status: ok > 0 ? 200 : 502 });
}

export async function DELETE(req: Request) {
  const n = (r: { n: string }[] | null) => Number(r?.[0]?.n ?? 0);
  const only = new URL(req.url).searchParams.get("agent")?.trim() ?? "";
  if (only) {
    // Single-agent reset: its keys + its rows. Team budgets are SHARED —
    // never deleted by a single-agent reset (use full reset for those).
    const { DEMO_AGENTS } = await import("../summary/route");
    const demo = DEMO_AGENTS.find((d) => d.id === only);
    if (!demo) return Response.json({ error: "unknown_agent" }, { status: 404 });
    const k = await queryOrNull<{ n: string }>(
      `WITH d AS (DELETE FROM virtual_keys WHERE name = $1 RETURNING id) SELECT count(*) AS n FROM d`,
      [`vk_demo_${only}`]
    );
    const l = await queryOrNull<{ n: string }>(
      `WITH d AS (DELETE FROM request_logs WHERE agent_id = ANY($1) AND project_id = 'acme-demo' RETURNING id) SELECT count(*) AS n FROM d`,
      [demo.memberAgentIds]
    );
    return Response.json({ purged: { agent: only, keys: n(k), budgets: 0, logs: n(l) } });
  }
  const k = await queryOrNull<{ n: string }>(
    `WITH d AS (DELETE FROM virtual_keys WHERE name LIKE 'vk_demo_%' RETURNING id) SELECT count(*) AS n FROM d`
  );
  const b = await queryOrNull<{ n: string }>(
    `WITH d AS (DELETE FROM budgets WHERE id LIKE 'demo-%' RETURNING id) SELECT count(*) AS n FROM d`
  );
  const l = await queryOrNull<{ n: string }>(
    `WITH d AS (DELETE FROM request_logs WHERE project_id = 'acme-demo' RETURNING id) SELECT count(*) AS n FROM d`
  );
  return Response.json({ purged: { keys: n(k), budgets: n(b), logs: n(l) } });
}
