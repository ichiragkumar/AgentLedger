// Routing API shared store (owner: routing ship-track, spec 06).
//
// Postgres system-of-record for dashboard routing config. Tables are created
// idempotently here (CREATE TABLE IF NOT EXISTS) so no db/migrations file is
// touched — sibling migration owners stay conflict-free. All reads are
// zero-state safe: when Postgres is unreachable the routes serve compiled
// defaults with source:"default" and never 500. Writes return 503 only when
// the durable write itself failed.
//
// Value-sync contract: DEFAULT_TIERS matches spec 17 §Routing exactly
// (simple $0.075/M · moderate $0.80/M · complex $3.00/M · frontier $5.00/M);
// REGISTRY_RATES mirrors data/prices.json + internal/pricing/registry.go
// DefaultPrices() exactly. Sync only — value changes need a human.
//
// Proxy wiring: the Go proxy has no /v1/routing management endpoint yet, so
// writes persist to Postgres and return proxySynced:false. The coordinator
// step (file-watch reload or mgmt route) is documented in /WIRING.md.

import { queryOrNull } from "@/lib/db";

export type TierId = "simple" | "moderate" | "complex" | "frontier";

export const TIER_ORDER: TierId[] = ["simple", "moderate", "complex", "frontier"];

export type TierView = {
  id: TierId;
  model: string;
  /** Documented tier price $/1M — spec 17 exact, sync only. */
  blendedPer1M: number;
  /** Live registry $/1M (mirror of data/prices.json). Null when unpriced. */
  inputPer1M: number | null;
  outputPer1M: number | null;
  known: boolean;
  description: string;
};

export type RoutingRule = {
  id: string;
  agentId: string;
  taskType: string;
  model: string;
  tier: string;
  priority: number;
  updatedAt: string;
};

// Documented tier table — spec 17 §Routing exact strings.
const DEFAULT_TIERS: { id: TierId; model: string; blendedPer1M: number; description: string }[] = [
  { id: "simple", model: "gemini-2.0-flash", blendedPer1M: 0.075, description: "Fast + cheap classification, extraction" },
  { id: "moderate", model: "claude-3-5-haiku", blendedPer1M: 0.8, description: "Everyday drafting, summarization" },
  { id: "complex", model: "claude-3-5-sonnet", blendedPer1M: 3.0, description: "Reasoning, planning, review" },
  { id: "frontier", model: "gpt-4o", blendedPer1M: 5.0, description: "High-stakes, evals, final review" },
];

// Mirror of data/prices.json (USD per 1M tokens). Sync only.
export const REGISTRY_RATES: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10.0 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-5.5-pro": { inputPer1M: 15.0, outputPer1M: 120.0 },
  o1: { inputPer1M: 15.0, outputPer1M: 60.0 },
  "o3-mini": { inputPer1M: 1.1, outputPer1M: 4.4 },
  "claude-sonnet-4": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "claude-3-5-sonnet": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "claude-3-5-haiku": { inputPer1M: 0.8, outputPer1M: 4.0 },
  "gemini-1.5-pro": { inputPer1M: 1.25, outputPer1M: 5.0 },
  "gemini-1.5-flash": { inputPer1M: 0.075, outputPer1M: 0.3 },
  "gemini-2.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4 },
  "deepseek-chat": { inputPer1M: 0.14, outputPer1M: 0.28 },
  "deepseek-reasoner": { inputPer1M: 0.55, outputPer1M: 2.19 },
  "deepseek-v4-flash": { inputPer1M: 0.07, outputPer1M: 0.28 },
  "mistral-large-latest": { inputPer1M: 2.0, outputPer1M: 6.0 },
};

export const REGISTRY_MODELS = Object.keys(REGISTRY_RATES).sort();

export function priceOf(model: string): { inputPer1M: number; outputPer1M: number } | null {
  const key = model.trim().toLowerCase();
  for (const [k, v] of Object.entries(REGISTRY_RATES)) {
    if (k.toLowerCase() === key) return v;
  }
  // Prefix family fallback (mirrors Registry.Get): longest stored key prefix.
  let best = "";
  for (const k of Object.keys(REGISTRY_RATES)) {
    if (key.startsWith(k.toLowerCase()) && k.length > best.length) best = k;
  }
  return best ? REGISTRY_RATES[best] : null;
}

/** Price tokens at a model rate (USD). Unknown models price at 0 (excluded from baseline). */
export function costAt(model: string, tokensIn: number, tokensOut: number): number | null {
  const p = priceOf(model);
  if (!p) return null;
  return (Math.max(0, tokensIn) / 1e6) * p.inputPer1M + (Math.max(0, tokensOut) / 1e6) * p.outputPer1M;
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS routing_tiers (
     tier TEXT PRIMARY KEY,
     model TEXT NOT NULL DEFAULT '',
     blended_per_1m DOUBLE PRECISION NOT NULL DEFAULT 0,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS routing_rules (
     id TEXT PRIMARY KEY,
     agent_id TEXT NOT NULL DEFAULT '',
     task_type TEXT NOT NULL DEFAULT '',
     model TEXT NOT NULL DEFAULT '',
     tier TEXT NOT NULL DEFAULT '',
     priority INT NOT NULL DEFAULT 0,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS routing_fallback (
     id INT PRIMARY KEY CHECK (id = 1),
     models JSONB NOT NULL DEFAULT '[]',
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
];

let ensured: Promise<void> | null = null;

/** Best-effort ensure of routing-owned tables (idempotent, additive). */
export function ensureRoutingTables(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      for (const sql of DDL) await queryOrNull(sql);
    })();
  }
  return ensured;
}

type TierRow = { tier: string; model: string; blended_per_1m: string | number; updated_at: string };

function toView(id: TierId, model: string, blended: number): TierView {
  const p = priceOf(model);
  const def = DEFAULT_TIERS.find((t) => t.id === id);
  return {
    id,
    model,
    blendedPer1M: blended,
    inputPer1M: p?.inputPer1M ?? null,
    outputPer1M: p?.outputPer1M ?? null,
    known: p !== null,
    description: def?.description ?? "",
  };
}

export async function getTiers(): Promise<{ tiers: TierView[]; source: "db" | "default"; updatedAt: string | null }> {
  await ensureRoutingTables();
  const rows = await queryOrNull<TierRow>(`SELECT tier, model, blended_per_1m, updated_at FROM routing_tiers`);
  if (!rows || rows.length === 0) {
    return { tiers: DEFAULT_TIERS.map((t) => toView(t.id, t.model, t.blendedPer1M)), source: "default", updatedAt: null };
  }
  const byId = new Map(rows.map((r) => [r.tier, r]));
  const tiers = TIER_ORDER.map((id) => {
    const r = byId.get(id);
    const def = DEFAULT_TIERS.find((t) => t.id === id)!;
    return r
      ? toView(id, r.model, Number(r.blended_per_1m))
      : toView(id, def.model, def.blendedPer1M);
  });
  const updatedAt = rows.map((r) => r.updated_at).sort().pop() ?? null;
  return { tiers, source: "db", updatedAt };
}

export async function saveTiers(items: { id: string; model: string }[]): Promise<TierView[] | null> {
  await ensureRoutingTables();
  for (const it of items) {
    const def = DEFAULT_TIERS.find((t) => t.id === it.id);
    if (!def) return null; // unknown tier id — caller returns 400
    const rows = await queryOrNull<TierRow>(
      `INSERT INTO routing_tiers (tier, model, blended_per_1m, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (tier) DO UPDATE SET model = EXCLUDED.model, updated_at = now()
       RETURNING tier, model, blended_per_1m, updated_at`,
      [it.id, it.model, def.blendedPer1M]
    );
    if (!rows?.[0]) return null;
  }
  return (await getTiers()).tiers;
}

type RuleRow = {
  id: string;
  agent_id: string;
  task_type: string;
  model: string;
  tier: string;
  priority: number | string;
  updated_at: string;
};

const toRule = (r: RuleRow): RoutingRule => ({
  id: r.id,
  agentId: r.agent_id,
  taskType: r.task_type,
  model: r.model,
  tier: r.tier,
  priority: Number(r.priority),
  updatedAt: r.updated_at,
});

export async function getRules(): Promise<{ rules: RoutingRule[]; source: "db" | "default" }> {
  await ensureRoutingTables();
  const rows = await queryOrNull<RuleRow>(
    `SELECT id, agent_id, task_type, model, tier, priority, updated_at
     FROM routing_rules ORDER BY priority DESC, updated_at ASC`
  );
  if (!rows) return { rules: [], source: "default" };
  return { rules: rows.map(toRule), source: "db" };
}

// Documented cascade root (mirrors router.DefaultFallbackModels): complex
// tier model first, then the spec 06 example fallbacks. Seeded per current
// tier config so every entry is a priced model.
export const DEFAULT_FALLBACK_TAIL = ["gpt-4o", "claude-3-5-haiku", "gemini-2.0-flash"];

export async function defaultChain(): Promise<string[]> {
  const { tiers } = await getTiers();
  const byId = new Map(tiers.map((t) => [t.id, t.model]));
  const head = byId.get("complex") ?? "claude-3-5-sonnet";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of [head, ...DEFAULT_FALLBACK_TAIL]) {
    const k = m.trim().toLowerCase();
    if (m.trim() && !seen.has(k)) {
      seen.add(k);
      out.push(m.trim());
    }
  }
  return out;
}

export async function getFallback(): Promise<{ chain: string[]; source: "db" | "default"; updatedAt: string | null }> {
  await ensureRoutingTables();
  const rows = await queryOrNull<{ models: unknown; updated_at: string }>(
    `SELECT models, updated_at FROM routing_fallback WHERE id = 1`
  );
  const raw = rows?.[0]?.models;
  const chain = Array.isArray(raw) ? (raw as unknown[]).filter((m): m is string => typeof m === "string" && m.trim() !== "") : null;
  if (!chain || chain.length === 0) {
    return { chain: await defaultChain(), source: "default", updatedAt: null };
  }
  return { chain, source: "db", updatedAt: rows?.[0]?.updated_at ?? null };
}

export async function saveFallback(chain: string[]): Promise<string[] | null> {
  await ensureRoutingTables();
  const rows = await queryOrNull<{ models: unknown }>(
    `INSERT INTO routing_fallback (id, models, updated_at)
     VALUES (1, $1::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET models = EXCLUDED.models, updated_at = now()
     RETURNING models`,
    [JSON.stringify(chain)]
  );
  if (!rows?.[0]) return null;
  const raw = rows[0].models;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((m): m is string => typeof m === "string");
    } catch {
      return null;
    }
  }
  return Array.isArray(raw) ? (raw as unknown[]).filter((m): m is string => typeof m === "string") : null;
}
