export type AgentSummary = {
  agent: string;
  spend: number;
  tokens: number;
  requests: number;
  cacheHitRate: number;
  model: string;
};

export type AgentDetail = AgentSummary & {
  timeline: { day: string; spend: number }[];
  models: { model: string; spend: number; requests: number }[];
  budget: { limit: number; spent: number; utilizationPct: number } | null;
  virtualKey: string;
};

// --- Additive (ledger-web-system): provider/tier/filter helpers. ---

/** Known LLM provider families for ModelChip tone mapping. */
export type ProviderName = "openai" | "anthropic" | "google" | "open" | "other";

/** Cost-tier semantics: cheap → frontier (matches TIER_COLORS order). */
export type ModelTier = "cheap" | "balanced" | "quality" | "frontier" | "custom";

/** Filter surface for agents tables (dashboard filter.store conforms). */
export type AgentFilter = {
  query?: string;
  team?: string;
  model?: string;
  tier?: ModelTier;
  sort?: "spend" | "requests" | "tokens" | "cacheHitRate";
  dir?: "asc" | "desc";
};
