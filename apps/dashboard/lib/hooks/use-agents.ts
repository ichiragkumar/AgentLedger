"use client";

import { useCallback, useEffect, useState } from "react";
import { getAgent, getAgents, type AgentDetail, type AgentSummary } from "@/lib/api-ext";

/** Agent list with server-side search; zero-state safe. */
export function useAgents(opts?: { range?: string; limit?: number }) {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAgents({ range: opts?.range, q, limit: opts?.limit });
      setAgents(res.agents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unavailable");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, opts?.range, opts?.limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { agents, q, setQ, loading, error, refresh };
}

/** Single-agent detail (scoped cards, timeline, requests, budgets). */
export function useAgent(id: string | null) {
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAgent(id)
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
