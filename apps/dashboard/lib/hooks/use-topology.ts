"use client";

// useTopology — client data for the Topology page (owner: ledger-ship-topology).
//
// Plain fetch/EventSource-free polling (no react-query — same contract as
// the web-backend hooks). Fetches the NEW /api/topology routes only;
// lib/api.ts + lib/api-ext.ts are sibling-owned and untouched.
// Zero-state safe: empty workflows => page keeps Coming banner + mock graph.

import { useCallback, useEffect, useState } from "react";

export type TopologyTier = "frontier" | "standard" | "cheap";

export type WorkflowSummary = {
  chainId: string;
  steps: number;
  edges: number;
  costUsd: number;
  requests: number;
  updatedAt: string | null;
  source: "workflow_graphs" | "request_logs";
};

export type TopologyStep = {
  id: string;
  depth: number;
  model: string;
  costUsd: number;
  quality: number;
  failureRate: number;
  criticality: number;
  tier: TopologyTier;
  calls: number;
  tokens: number;
};

export type TopologyDetail = {
  chainId: string;
  steps: TopologyStep[];
  edges: { from: string; to: string }[];
  expectedTotalUsd: number;
  savingsVsUniform: number | null;
  criticalitySource: "heuristic";
  source: "workflow_graphs" | "request_logs";
  updatedAt: string | null;
};

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`topology ${res.status}`);
  return (await res.json()) as T;
}

export function useTopology() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [chainId, setChainId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TopologyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = await fetchJSON<{ workflows: WorkflowSummary[] }>("/api/topology");
      setWorkflows(body.workflows ?? []);
      setChainId((prev) => {
        if (prev && (body.workflows ?? []).some((w) => w.chainId === prev)) return prev;
        return body.workflows?.[0]?.chainId ?? null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "unavailable");
      setWorkflows([]);
      setChainId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!chainId) {
      setDetail(null);
      return;
    }
    let live = true;
    setDetailLoading(true);
    fetchJSON<{ workflow: TopologyDetail }>(`/api/topology/${encodeURIComponent(chainId)}`)
      .then((body) => {
        if (live) setDetail(body.workflow);
      })
      .catch(() => {
        if (live) setDetail(null);
      })
      .finally(() => {
        if (live) setDetailLoading(false);
      });
    return () => {
      live = false;
    };
  }, [chainId]);

  return {
    workflows,
    chainId,
    setChainId,
    detail,
    loading,
    detailLoading,
    error,
    refresh,
    hasData: workflows.length > 0,
  };
}
