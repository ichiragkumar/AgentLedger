"use client";

import { useCallback, useEffect, useState } from "react";

// NOTE: fetchers live in this file — lib/api.ts / lib/api-ext.ts are owned
// by a sibling flow and must not be touched (see track work order).

export type CacheConfig = {
  threshold: number;
  ttlSeconds: number;
  enabled: boolean;
  guardEnabled: boolean;
};

export type CacheSeriesPoint = { day: string; exact: number; semantic: number };
export type CacheTopQuery = { query: string; hits: number; savedUSD: number };

export type CacheStats = {
  hitRatePct: number;
  hits: number;
  misses: number;
  savedUsd: number;
  savedWeekUsd: number;
  cacheSize: number;
  avgLookupMs: number | null;
  threshold: number;
  series7d: CacheSeriesPoint[];
  topQueries: CacheTopQuery[];
  requests7d: number;
  spend7d: number;
  source: "live" | "stub";
  connected: boolean;
  updatedAt: string;
};

export type FlushScope = "all" | "agent" | "team" | "model";
export type FlushResult = {
  flushed: boolean;
  scope: FlushScope;
  value?: string;
  purged: { exactRemoved: number; semanticRemoved: number };
  proxySynced: boolean;
  note?: string;
};

const DEFAULT_CONFIG: CacheConfig = { threshold: 0.92, ttlSeconds: 3600, enabled: true, guardEnabled: true };

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const code = (body as { error?: string; detail?: string } | null)?.error ?? `http_${res.status}`;
    const detail = (body as { detail?: string } | null)?.detail;
    throw new Error(detail ? `${code}: ${detail}` : code);
  }
  return body as T;
}

/**
 * Cache overview, live on /api/cache/* (zero-state safe server-side).
 * Before the saver is wired into the proxy chain, stats return
 * {connected:false, source:"stub"} and the page renders empty states.
 */
export function useCache() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [config, setConfig] = useState<CacheConfig>({ ...DEFAULT_CONFIG });
  const [configSource, setConfigSource] = useState<"stored" | "defaults">("defaults");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, c] = await Promise.all([
        fetchJSON<CacheStats>("/api/cache/stats"),
        fetchJSON<{ config: CacheConfig; source: "stored" | "defaults" }>("/api/cache/config"),
      ]);
      setStats(s);
      setConfig(c.config);
      setConfigSource(c.source);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Persist via PUT /api/cache/config; throws (page toasts) on failure. */
  const saveConfig = useCallback(async (next: CacheConfig) => {
    setSaving(true);
    try {
      const r = await fetchJSON<{ config: CacheConfig; persisted: boolean; proxySynced: boolean; note?: string }>(
        "/api/cache/config",
        { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) }
      );
      setConfig(r.config);
      setConfigSource("stored");
      return r;
    } finally {
      setSaving(false);
    }
  }, []);

  /** Purge via POST /api/cache/flush; throws (page toasts) on transport failure. */
  const flush = useCallback(async (scope: FlushScope = "all", value = "") => {
    setFlushing(true);
    try {
      const r = await fetchJSON<FlushResult>("/api/cache/flush", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope, value }),
      });
      return r;
    } finally {
      setFlushing(false);
    }
  }, []);

  return {
    stats,
    // Convenience aliases (back-compat with the previous stub hook shape).
    hitRatePct: stats?.hitRatePct ?? 0,
    savedUsd7d: stats?.savedWeekUsd ?? 0,
    connected: stats?.connected ?? false,
    config,
    configSource,
    saveConfig,
    flush,
    loading,
    saving,
    flushing,
    error,
    refresh,
  };
}
