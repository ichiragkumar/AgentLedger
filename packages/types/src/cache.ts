export type CacheStats = {
  hitRatePct: number;
  hits: number;
  misses: number;
  savedUSD: number;
  savedWeekUSD: number;
  cacheSize: number;
  avgLookupMs: number;
  threshold: number;
  topQueries: { query: string; agent: string; hits: number; savedUSD: number }[];
};

export type RoutingStats = {
  distribution: { model: string; share: number; requests: number }[];
  wouldHaveSpent: number;
  spent: number;
  savedPct: number;
  escalationRate: number;
  qualityPerModel: { model: string; score: number }[];
};

// --- Additive (ledger-web-system): lookup outcome for cache panels. ---

/** Single semantic/exact cache lookup outcome. */
export type CacheLookupResult = {
  hit: boolean;
  kind: "exact" | "semantic" | "miss";
  similarity?: number;
  savedUSD: number;
  lookupMs: number;
};
