"use client";

import { useCallback, useEffect, useState } from "react";
import { getStats } from "@/lib/api-ext";

export type CacheConfig = { threshold: number; ttlSeconds: number };

/**
 * Cache overview. Live hit/savings numbers have no dashboard source yet
 * (Phase 2 stores are cache-only, not Postgres) — /api/stats returns an
 * explicit stub so the UI renders "not connected" instead of fake data.
 * Config save applies locally and documents the saver wiring (TODO).
 */
export function useCache() {
  const [hitRatePct, setHitRatePct] = useState(0);
  const [savedUsd7d, setSavedUsd7d] = useState(0);
  const [connected, setConnected] = useState(false);
  const [config, setConfig] = useState<CacheConfig>({ threshold: 0.92, ttlSeconds: 3600 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await getStats();
      setHitRatePct(s.cache.hitRatePct);
      setSavedUsd7d(s.cache.savedUsd7d);
      setConnected(s.cache.source !== "stub");
    } catch (e) {
      setError(e instanceof Error ? e.message : "unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Local apply; TODO(SAVER): persist via saver config API when it lands. */
  const saveConfig = useCallback((next: CacheConfig) => {
    setConfig(next);
    return { applied: "local" as const, todo: "SAVER: persist threshold/TTL to cache config API" };
  }, []);

  return { hitRatePct, savedUsd7d, connected, config, saveConfig, loading, error, refresh };
}
