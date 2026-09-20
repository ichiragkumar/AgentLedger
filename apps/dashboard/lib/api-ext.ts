// Extended dashboard API client (new Route Handlers).
// NOTE: lib/api.ts is owned by a sibling flow — new fetchers live here only.
// All fetchers throw ApiError on non-OK; hooks catch and expose {error} while
// server callers should catch and render zero-state (fail-closed, never 500).

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
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
    throw new ApiError(res.status, code);
  }
  return body as T;
}

// --- Agents ---

export type AgentSummary = {
  name: string;
  spend: number;
  tokens: number;
  requests: number;
  avgLatencyMs: number;
  models: number;
  cacheHitRate: number | null;
  lastSeen: string | null;
};

export type AgentDetail = {
  name: string;
  spend30d: number;
  tokens30d: number;
  requests30d: number;
  byModel: { model: string; spend: number; requests: number; tokens: number }[];
  timeline7d: { day: string; spend: number; requests: number }[];
  topRequests: unknown[];
  budgets: unknown[];
  keyPrefixes: string[];
};

export function getAgents(opts?: { range?: string; q?: string; limit?: number }): Promise<{
  agents: AgentSummary[];
  total: number;
  range: string;
}> {
  const p = new URLSearchParams();
  if (opts?.range) p.set("range", opts.range);
  if (opts?.q) p.set("q", opts.q);
  if (opts?.limit) p.set("limit", String(opts.limit));
  const qs = p.toString();
  return fetchJSON(`/api/agents${qs ? `?${qs}` : ""}`);
}

export async function getAgent(id: string): Promise<{ agent: AgentDetail }> {
  return fetchJSON(`/api/agents/${encodeURIComponent(id)}`);
}

// --- Budgets ---

export type Budget = {
  id: string;
  level: string;
  key: string;
  ownerTeam: string;
  window: string;
  tokenLimit: number;
  dollarLimit: number;
  spentTokens: number;
  spentUsd: number;
  utilizationPct: number;
  state: "ok" | "notice" | "watch" | "downgrade" | "hard_stop";
  thresholdsCrossed: number[];
  forecastUsd: number;
  windowStart: string;
  resetAt: string;
};

export function getBudgets(history = false): Promise<{ budgets: Budget[] }> {
  return fetchJSON(`/api/budgets${history ? "?history=1" : ""}`);
}

export function createBudget(input: {
  level: string;
  key: string;
  window: string;
  tokenLimit: number;
  dollarLimit: number;
  ownerTeam?: string;
}): Promise<{ budget: Budget }> {
  return fetchJSON("/api/budgets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateBudget(
  id: string,
  patch: { tokenLimit?: number; dollarLimit?: number; window?: string }
): Promise<{ budget: Budget }> {
  return fetchJSON(`/api/budgets?id=${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function deleteBudget(id: string): Promise<{ deleted: string }> {
  return fetchJSON(`/api/budgets?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

// --- Alerts ---

export type Alert = {
  id: string;
  ts: string;
  severity: "info" | "warning" | "critical";
  kind: string;
  title: string;
  detail: string;
  budgetId: string;
  source: "audit_log" | "derived";
};

export function getAlerts(limit = 20): Promise<{ alerts: Alert[] }> {
  return fetchJSON(`/api/alerts?limit=${limit}`);
}

// --- Keys (full key material appears ONLY in issue/rotate responses) ---

export type VirtualKey = {
  id: string;
  name: string;
  agentScope: string;
  teamScope: string;
  prefix: string;
  last4: string;
  createdAt: string;
  lastUsedAt: string | null;
  status: "active" | "revoked" | "grace";
  rotatedFrom: string | null;
  graceExpiresAt: string | null;
};

export function getKeys(): Promise<{ keys: VirtualKey[] }> {
  return fetchJSON("/api/keys");
}

export function issueKey(input: { name: string; agentScope?: string; teamScope?: string }): Promise<{
  key: VirtualKey;
  fullKey: string;
  warning: string;
}> {
  return fetchJSON("/api/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function revokeKey(id: string): Promise<{ revoked: string; key: VirtualKey }> {
  return fetchJSON(`/api/keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function rotateKey(
  id: string,
  graceSeconds = 3600
): Promise<{ key: VirtualKey; fullKey: string; warning: string }> {
  return fetchJSON(`/api/keys?id=${encodeURIComponent(id)}&graceSeconds=${graceSeconds}`, { method: "PUT" });
}

// --- Stats (public, cached) ---

export type Stats = {
  totals: Record<string, number | string | null>;
  cache: { hitRatePct: number; savedUsd7d: number; source: "stub" };
  routing: { savedUsd7d: number; source: "stub" };
  updatedAt: string;
};

export function getStats(): Promise<Stats> {
  return fetchJSON("/api/stats");
}

// --- Onboarding ---

export type Workspace = { id: string; name: string; created_at: string };

export function getWorkspaces(): Promise<{ workspaces: Workspace[] }> {
  return fetchJSON("/api/onboarding/workspace");
}

export function createWorkspace(name: string): Promise<{ workspace: Workspace; reused?: boolean }> {
  return fetchJSON("/api/onboarding/workspace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function issueFirstKey(agentScope = ""): Promise<{ key: VirtualKey; fullKey: string; warning: string }> {
  return fetchJSON("/api/onboarding/key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentScope }),
  });
}

export type ConnectionTest = {
  connected: boolean;
  requestsSeen: number;
  chainsSeen: number;
  lastSeen: string | null;
  sample: unknown;
  hint: string | null;
};

export function testConnection(opts?: { keyPrefix?: string; chainId?: string }): Promise<ConnectionTest> {
  const p = new URLSearchParams();
  if (opts?.keyPrefix) p.set("keyPrefix", opts.keyPrefix);
  if (opts?.chainId) p.set("chainId", opts.chainId);
  const qs = p.toString();
  return fetchJSON(`/api/onboarding/test${qs ? `?${qs}` : ""}`);
}
