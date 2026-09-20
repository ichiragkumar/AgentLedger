// Shared Go management-plane client (dashboard server-side only).
//
// The proxy mounts budgets/alerts/audit (enforce.RegisterRoutes) plus the
// key vault at /v1/* (see internal/proxy/mgmt.go). Reads stay on Postgres
// (rich views); writes mirror here best-effort. All helpers are fail-open:
// network failure returns {ok:false}, never throws, so routes can fall back
// to local Postgres and pages never 500.

export function proxyBase(): string {
  return process.env.PROXY_MGMT_BASE ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
}

// Dashboard acts as operator: admin actor for RBAC writes + optional bearer
// when the proxy sets MGMT_TOKEN (mirrored server-side from PROXY_MGMT_TOKEN).
export function mgmtHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    "X-Ledger-Role": "admin",
    "X-Ledger-Actor": "dashboard",
    ...extra,
  };
  const token = process.env.PROXY_MGMT_TOKEN;
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

export type ProxyResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number };

export async function proxyFetch<T>(path: string, init?: RequestInit, timeoutMs = 2500): Promise<ProxyResult<T>> {
  try {
    const res = await fetch(`${proxyBase()}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      data = null as T;
    }
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, status: res.status, data: data as T };
  } catch {
    return { ok: false, status: 0 };
  }
}
