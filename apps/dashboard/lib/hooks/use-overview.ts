"use client";

import { useCallback, useEffect, useState } from "react";
import { getAlerts, getStats, type Alert, type Stats } from "@/lib/api-ext";

export type OverviewRange = "24h" | "7d" | "30d";

/** Overview data: public stats aggregate + recent alerts. Zero-state safe. */
export function useOverview(range: OverviewRange = "24h") {
  const [stats, setStats] = useState<Stats | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, a] = await Promise.all([getStats(), getAlerts(5)]);
      setStats(s);
      setAlerts(a.alerts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, range]);

  return { stats, alerts, loading, error, refresh };
}
