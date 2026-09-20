// Demo before/after data hooks — Demo-UI builder (spec 21).
// NEW file: fetchers live in-file (lib/api.ts / lib/api-ext.ts are owned by
// sibling flows — do not add there). All fetchers are zero-state safe:
// network/DB failures surface as {error} and pages render skeletons or the
// demo/README.md empty state, never a crash.

"use client";

import { useCallback, useEffect, useState } from "react";

// --- in-file fetchers ---

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) code = body.error;
    } catch {
      // keep status code
    }
    throw new Error(code);
  }
  return (await res.json()) as T;
}

// --- shapes (mirror the demo Route Handlers) ---

export type DemoModelPath = {
  model: string;
  spend: number;
  requests: number;
  tokens: number;
};

export type DemoCard = {
  id: string;
  label: string;
  team: string;
  blurb: string;
  memberAgentIds: string[];
  hasTraffic: boolean;
  requests: number;
  tokens: number;
  tokensIn: number;
  tokensOut: number;
  afterSpend: number;
  afterKind: "metered";
  beforeSpend: number;
  beforeKind: "modeled";
  savedUsd: number;
  savingsPct: number;
  modelPath: DemoModelPath[];
  lastSeen: string | null;
};

export type DemoSummary = {
  baseline: {
    model: string;
    inputPer1M: number;
    outputPer1M: number;
    kind: "modeled";
    note: string;
  };
  totals: {
    afterSpend: number;
    afterKind: "metered";
    beforeSpend: number;
    beforeKind: "modeled";
    savedUsd: number;
    savingsPct: number;
    requests: number;
    tokens: number;
  };
  agents: DemoCard[];
  hasTraffic: boolean;
};

export type DemoRequest = {
  id: number;
  ts: string;
  model: string;
  agentId: string;
  teamId: string;
  projectId: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  costKind: "metered";
  latencyMs: number;
  statusCode: number;
  chainId: string | null;
  parentAgentId: string | null;
  cache: { status: "unknown"; kind: "unknown" };
  keyPrefix: string | null;
};

export type DemoBudget = {
  id: string;
  level: string;
  scopeKey: string;
  window: string;
  tokenLimit: number;
  dollarLimit: number;
  spentTokens: number;
  spentUsd: number;
  utilizationPct: number;
  state: "ok" | "notice" | "watch" | "exceeded";
  resetAt: string;
};

export type DemoAgentDetail = {
  id: string;
  label: string;
  team: string;
  blurb: string;
  memberAgentIds: string[];
  hasTraffic: boolean;
  requests: number;
  afterSpend: number;
  afterKind: "metered";
  beforeSpend: number;
  beforeKind: "modeled";
  baselineModel: string;
  savedUsd: number;
  savingsPct: number;
  modelSplit: (DemoModelPath & { spendKind: "metered"; tier: string; tierKind: "inferred" })[];
  routingNote: string;
  requests20: DemoRequest[];
  cacheNote: string;
  budgets: DemoBudget[];
  keyPrefixes: string[];
};

export function getDemoSummary(): Promise<DemoSummary> {
  return fetchJSON<DemoSummary>("/api/demo/summary");
}

export function getDemoAgent(id: string): Promise<{ agent: DemoAgentDetail }> {
  return fetchJSON<{ agent: DemoAgentDetail }>(`/api/demo/agents/${encodeURIComponent(id)}`);
}

// --- hooks ---

/** Before/after summary across all 5 kitchen-sink demo agents. */
export function useDemoSummary() {
  const [summary, setSummary] = useState<DemoSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await getDemoSummary());
    } catch (e) {
      setError(e instanceof Error ? e.message : "unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { summary, loading, error, refresh };
}

/** Single demo-agent detail (requests, model split, budgets). */
export function useDemoAgent(id: string | null) {
  const [agent, setAgent] = useState<DemoAgentDetail | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getDemoAgent(id)
      .then((res) => {
        if (!cancelled) setAgent(res.agent);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "unavailable");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return { agent, loading, error };
}
