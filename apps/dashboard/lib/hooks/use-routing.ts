// use-routing — Routing page data (owner: routing ship-track, spec 06/17).
//
// NOTE: lib/api.ts / lib/api-ext.ts are sibling-owned — fetchers live in
// this file only. All fetchers throw on non-OK; the hook exposes {error}
// and zero-state values, never fake data.

"use client";

import { useCallback, useEffect, useState } from "react";

export type Tier = {
  id: "simple" | "moderate" | "complex" | "frontier";
  model: string;
  blendedPer1M: number;
  inputPer1M: number | null;
  outputPer1M: number | null;
  known: boolean;
  description: string;
};

export type PricedModel = { model: string; inputPer1M: number; outputPer1M: number };

export type RoutingRule = {
  id: string;
  agentId: string;
  taskType: string;
  model: string;
  tier: string;
  priority: number;
  updatedAt: string;
};

export type DistributionSlice = { model: string; requests: number; spend: number; tokens: number; share: number };

export type Distribution = {
  window: string;
  byModel: DistributionSlice[];
  daily: { day: string; model: string; requests: number; spend: number }[];
  summary: { wouldHaveSpent: number; spent: number; saved: number; savedPct: number; requests: number };
  frontier: { model: string; inputPer1M: number | null; outputPer1M: number | null };
};

class RoutingError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const code = (body as { error?: string } | null)?.error ?? `http_${res.status}`;
    throw new RoutingError(res.status, code);
  }
  return body as T;
}

const jsonHeaders = { "content-type": "application/json" };

export function useRouting() {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [models, setModels] = useState<PricedModel[]>([]);
  const [tiersSource, setTiersSource] = useState<"db" | "default">("default");
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [fallback, setFallback] = useState<string[]>([]);
  const [fallbackSource, setFallbackSource] = useState<"db" | "default">("default");
  const [distribution, setDistribution] = useState<Distribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, r, f, d] = await Promise.all([
        fetchJSON<{ tiers: Tier[]; models: PricedModel[]; source: "db" | "default" }>("/api/routing/tiers"),
        fetchJSON<{ rules: RoutingRule[] }>("/api/routing/rules"),
        fetchJSON<{ chain: string[]; source: "db" | "default" }>("/api/routing/fallback"),
        fetchJSON<Distribution>("/api/routing/distribution"),
      ]);
      setTiers(t.tiers);
      setModels(t.models);
      setTiersSource(t.source);
      setRules(r.rules);
      setFallback(f.chain);
      setFallbackSource(f.source);
      setDistribution(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveTiers = useCallback(async (items: { id: string; model: string }[]) => {
    const res = await fetchJSON<{ tiers: Tier[]; proxySynced: boolean }>("/api/routing/tiers", {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ tiers: items }),
    });
    setTiers(res.tiers);
    setTiersSource("db");
    return res;
  }, []);

  const createRule = useCallback(async (input: { agentId?: string; taskType?: string; model: string; tier?: string; priority?: number }) => {
    const res = await fetchJSON<{ rule: RoutingRule; proxySynced: boolean }>("/api/routing/rules", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(input),
    });
    setRules((prev) => [...prev, res.rule].sort((a, b) => b.priority - a.priority));
    return res;
  }, []);

  const updateRule = useCallback(async (id: string, patch: { agentId?: string; taskType?: string; model?: string; tier?: string; priority?: number }) => {
    const res = await fetchJSON<{ rule: RoutingRule }>(`/api/routing/rules/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(patch),
    });
    setRules((prev) => prev.map((r) => (r.id === id ? res.rule : r)));
    return res.rule;
  }, []);

  const deleteRule = useCallback(async (id: string) => {
    await fetchJSON(`/api/routing/rules/${encodeURIComponent(id)}`, { method: "DELETE" });
    setRules((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const saveFallback = useCallback(async (chain: string[]) => {
    const res = await fetchJSON<{ chain: string[]; proxySynced: boolean }>("/api/routing/fallback", {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ chain }),
    });
    setFallback(res.chain);
    setFallbackSource("db");
    return res;
  }, []);

  return {
    tiers,
    models,
    tiersSource,
    rules,
    fallback,
    fallbackSource,
    distribution,
    loading,
    error,
    refresh,
    saveTiers,
    createRule,
    updateRule,
    deleteRule,
    saveFallback,
  };
}
