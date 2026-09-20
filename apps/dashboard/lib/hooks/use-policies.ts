"use client";

import { useCallback, useEffect, useState } from "react";

// use-policies: live policy docs from GET /api/policies (durable Postgres +
// live Go engine mirror). Self-contained fetcher — lib/api-ext.ts is owned
// by a sibling flow, so this hook speaks HTTP directly. Zero-state safe.

export type PolicyKind = "model-access" | "pii" | "max-tokens" | "time-window" | "mixed";

export type Policy = {
  id: string;
  name: string;
  team: string;
  config: string;
  enabled: boolean;
  kind: PolicyKind;
  summary: string;
  updatedAt: string;
  proxyId: string | null;
};

export class PolicyError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function friendly(status: number, code: string, fallback: string): string {
  if (status === 403 || code === "forbidden")
    return "Only admins can change policies — your draft was not applied.";
  if (status === 400 || code === "invalid_policy") return fallback;
  if (status === 404) return "Policy not found — it may have been deleted.";
  if (status === 503) return "Policy store is unreachable — try again in a moment.";
  return fallback;
}

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  let body: { error?: string; message?: string } | null = null;
  try {
    body = (await res.json()) as { error?: string; message?: string };
  } catch {
    body = null;
  }
  if (!res.ok) {
    const code = body?.error ?? `http_${res.status}`;
    throw new PolicyError(res.status, code, body?.message ?? friendly(res.status, code, code));
  }
  return body as T;
}

/** Build a Go-engine YAML doc from form fields (keys match LoadPolicyYAML). */
export function buildPolicyYAML(input: {
  name: string;
  team: string;
  allowModels: string;
  denyModels: string;
  maxTokens: string;
  denyHours: string;
  redactPii: boolean;
  blockPii: boolean;
}): string {
  const list = (s: string) =>
    s
      .split(/[,\n]/)
      .map((m) => m.trim())
      .filter(Boolean);
  const lines = ["policies:", `  - name: ${input.name.trim() || "unnamed"}`, `    team: ${input.team.trim() || "*"}`];
  const allow = list(input.allowModels);
  const deny = list(input.denyModels);
  if (allow.length > 0) lines.push(`    allow_models: [${allow.join(", ")}]`);
  if (deny.length > 0) lines.push(`    deny_models: [${deny.join(", ")}]`);
  const maxTok = input.maxTokens.trim();
  if (maxTok) lines.push(`    max_tokens_per_request: ${maxTok}`);
  const hours = input.denyHours.trim();
  if (hours) lines.push(`    deny_hours: "${hours}"`);
  lines.push(`    redact_pii: ${input.redactPii ? "true" : "false"}`);
  lines.push(`    block_pii_to_external: ${input.blockPii ? "true" : "false"}`);
  return lines.join("\n") + "\n";
}

export function usePolicies() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [engineRules, setEngineRules] = useState(0);
  const [engineReachable, setEngineReachable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJSON<{ policies: Policy[]; engine: { rules: number; reachable: boolean } }>(
        "/api/policies"
      );
      setPolicies(res.policies);
      setEngineRules(res.engine.rules);
      setEngineReachable(res.engine.reachable);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: { name: string; team: string; config: string }) => {
      const res = await fetchJSON<{ policy: Policy; engineError?: string; proxySynced?: boolean }>(
        "/api/policies",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }
      );
      setNotice(
        res.engineError ??
          (res.proxySynced === false ? "Saved — live engine will pick it up on the next successful sync." : "Rule saved and hot-applied.")
      );
      await refresh();
      return res.policy;
    },
    [refresh]
  );

  const update = useCallback(
    async (id: string, patch: { name?: string; team?: string; config?: string; enabled?: boolean }) => {
      const res = await fetchJSON<{ policy: Policy; proxySynced?: boolean }>(
        `/api/policies?id=${encodeURIComponent(id)}`,
        { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }
      );
      setNotice(
        res.proxySynced === false ? "Saved — live engine will pick it up on the next successful sync." : "Rule saved and hot-applied."
      );
      await refresh();
      return res.policy;
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      await fetchJSON(`/api/policies?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setNotice("Rule deleted from store and live engine.");
      await refresh();
    },
    [refresh]
  );

  return { policies, engineRules, engineReachable, loading, error, notice, setNotice, refresh, create, update, remove };
}
