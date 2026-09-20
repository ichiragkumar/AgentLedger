// Demo before/after data hooks — Demo-UI builder (spec 21).
// NEW file: fetchers live in-file (lib/api.ts / lib/api-ext.ts are owned by
// sibling flows — do not add there). All fetchers are zero-state safe:
// network/DB failures surface as {error} and pages render skeletons or the
// demo/README.md empty state, never a crash.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  problem: string;
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
  problem: string;
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

export type DemoRunStatus = {
  proxyHealthy: boolean;
  mockReachable: boolean;
  proxy: string;
};

export type DemoRunResult = {
  ran: number;
  ok: number;
  failed: number;
  agents: string[];
  cycles: number;
  warning: string | null;
  transcript?: DemoTranscriptEntry[] | null;
};

// --- live-transcript contract (POST /api/demo/run, both modes) ---
// Backend sibling lands `transcript` in parallel — built to its exact shape:
//   transcript: [{agent, model, prompt, completion, ms, ok, error?}]
// (600-char truncated server-side). Token extras render when present but are
// never required; absent transcript degrades to null, never a crash.

export type DemoTranscriptEntry = {
  agent: string;
  model: string;
  prompt: string;
  completion: string;
  ms: number;
  ok: boolean;
  error?: string;
  tokensIn?: number;
  tokensOut?: number;
  tokens?: number;
};

/** Client fetch timeout for demo runs (free-tier reasoning models are slow). */
export const DEMO_RUN_TIMEOUT_MS = 300_000;

export const DEMO_RUN_TIMEOUT_MESSAGE =
  "ran past 5:00 — free-tier reasoning models are slow; try per-agent run";

function pickTranscript(r: unknown): DemoTranscriptEntry[] | null {
  const t = (r as { transcript?: unknown } | null)?.transcript;
  return Array.isArray(t) ? (t as DemoTranscriptEntry[]) : null;
}

function toRunError(e: unknown): string {
  if (e instanceof DOMException && e.name === "TimeoutError") return DEMO_RUN_TIMEOUT_MESSAGE;
  if (e instanceof Error && /timeout/i.test(e.message)) return DEMO_RUN_TIMEOUT_MESSAGE;
  return e instanceof Error ? e.message : "unavailable";
}

async function postJSON<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    // Demo runs hit free-tier reasoning models — bound the wait instead of
    // hanging on "Running…" forever (maps to DEMO_RUN_TIMEOUT_MESSAGE).
    signal: AbortSignal.timeout(DEMO_RUN_TIMEOUT_MS),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const code = (data as { error?: string } | null)?.error ?? `http_${res.status}`;
    throw new Error(code);
  }
  return data as T;
}

export function getDemoRunStatus(): Promise<DemoRunStatus> {
  return fetchJSON<DemoRunStatus>("/api/demo/run");
}

export function runDemoTraffic(opts?: { cycles?: number; agent?: string }): Promise<DemoRunResult> {
  return postJSON<DemoRunResult>("/api/demo/run", { cycles: opts?.cycles ?? 1, agent: opts?.agent ?? "" });
}

export type DirectRunResult = {
  mode: "direct";
  ran: number;
  ok: number;
  failed: number;
  agents: string[];
  cycles: number;
  tokensIn: number;
  tokensOut: number;
  modeledSpend: number;
  realCalls: number;
  mockReachable: boolean;
  warning: string | null;
  visibility: string;
  perAgent: Record<string, { requests: number; tokensIn: number; tokensOut: number; modeledSpend: number }>;
  transcript?: DemoTranscriptEntry[] | null;
};

export function runDirectTraffic(opts?: { cycles?: number; agent?: string }): Promise<DirectRunResult> {
  return postJSON<DirectRunResult>("/api/demo/run", { mode: "direct", cycles: opts?.cycles ?? 1, agent: opts?.agent ?? "" });
}

export function resetDemo(): Promise<{ purged: { keys: number; budgets: number; logs: number } }> {
  return fetch(`/api/demo/run`, { method: "DELETE", cache: "no-store" }).then(async (res) => {
    if (!res.ok) throw new Error(`http_${res.status}`);
    return (await res.json()) as { purged: { keys: number; budgets: number; logs: number } };
  });
}

export function resetDemoAgent(id: string): Promise<{ purged: { agent: string; keys: number; budgets: number; logs: number } }> {
  return fetch(`/api/demo/run?agent=${encodeURIComponent(id)}`, { method: "DELETE", cache: "no-store" }).then(async (res) => {
    if (!res.ok) throw new Error(`http_${res.status}`);
    return (await res.json()) as { purged: { agent: string; keys: number; budgets: number; logs: number } };
  });
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

export function getDemoSummary(): Promise<DemoSummary> {
  return fetchJSON<DemoSummary>("/api/demo/summary");
}

// --- run hook (action state for the /demo action bar) ---

export function useDemoRun(onDone?: () => void) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<DemoRunStatus | null>(null);
  const [lastRun, setLastRun] = useState<DemoRunResult | null>(null);
  const [lastDirect, setLastDirect] = useState<DirectRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  // Latest run's live transcript (set from run responses, cleared on reset).
  const [transcript, setTranscript] = useState<DemoTranscriptEntry[] | null>(null);
  // Elapsed-seconds ticker while `running` — the run buttons show this
  // instead of an infinite bare "Running…".
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    getDemoRunStatus().then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    if (!running) {
      startRef.current = null;
      setElapsedSecs(0);
      return;
    }
    startRef.current = Date.now();
    setElapsedSecs(0);
    const t = setInterval(() => {
      if (startRef.current !== null) {
        setElapsedSecs(Math.floor((Date.now() - startRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(t);
  }, [running]);

  const run = useCallback(
    async (opts?: { cycles?: number; agent?: string }) => {
      setRunning(true);
      setRunError(null);
      try {
        const r = await runDemoTraffic(opts);
        setLastRun(r);
        setLastDirect(null);
        setTranscript(pickTranscript(r));
        onDone?.();
      } catch (e) {
        setRunError(toRunError(e));
      } finally {
        setRunning(false);
      }
    },
    [onDone]
  );

  const runWithout = useCallback(
    async (opts?: { cycles?: number; agent?: string }) => {
      setRunning(true);
      setRunError(null);
      try {
        const r = await runDirectTraffic(opts);
        setLastDirect(r);
        setLastRun(null);
        setTranscript(pickTranscript(r));
      } catch (e) {
        setRunError(toRunError(e));
      } finally {
        setRunning(false);
      }
    },
    []
  );

  const reset = useCallback(async () => {
    setRunning(true);
    try {
      const r = await resetDemo();
      setLastRun(null);
      setLastDirect(null);
      setTranscript(null);
      onDone?.();
      return r;
    } finally {
      setRunning(false);
    }
  }, [onDone]);

  const resetOne = useCallback(async (id: string) => {
    setRunning(true);
    try {
      const r = await resetDemoAgent(id);
      setTranscript(null);
      onDone?.();
      return r;
    } finally {
      setRunning(false);
    }
  }, [onDone]);

  return { running, elapsedSecs, status, lastRun, lastDirect, transcript, runError, run, runWithout, reset, resetOne };
}

/** Single demo-agent detail (requests, model split, budgets). */
export function useDemoAgent(id: string | null) {
  const [agent, setAgent] = useState<DemoAgentDetail | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

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
  }, [id, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { agent, loading, error, refresh };
}
