import { mgmtHeaders, proxyFetch } from "../../_lib/proxy-mgmt";

export const dynamic = "force-dynamic";

// POST /api/cache/flush — Saver invalidation (spec 05 §2.7).
//
// Body {scope?: "all"|"agent"|"team"|"model", value?: string} (default all).
// Proxies to the Go management plane (DELETE /v1/cache[…]) best-effort:
// those routes land with Mirror's WIRING.md patch, so until then this
// returns 200 + {proxySynced:false} and purges nothing — never 500s, never
// touches the append-only request_logs.

const SCOPES = ["all", "agent", "team", "model"] as const;
type Scope = (typeof SCOPES)[number];

function proxyPath(scope: Scope, value: string): string {
  if (scope === "all") return "/v1/cache";
  const p = new URLSearchParams({ [scope]: value });
  return `/v1/cache?${p.toString()}`;
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const scope = String(body.scope ?? "all") as Scope;
  const value = String(body.value ?? "").trim();

  if (!(SCOPES as readonly string[]).includes(scope)) {
    return Response.json({ error: "invalid_scope", detail: "scope ∈ all|agent|team|model" }, { status: 400 });
  }
  if (scope !== "all" && value === "") {
    return Response.json({ error: "invalid_scope", detail: `value required for scope ${scope}` }, { status: 400 });
  }

  const r = await proxyFetch<{ exact_removed?: number; semantic_removed?: number }>(proxyPath(scope, value), {
    method: "DELETE",
    headers: mgmtHeaders(),
  });

  if (!r.ok) {
    return Response.json({
      flushed: false,
      scope,
      ...(value ? { value } : {}),
      purged: { exactRemoved: 0, semanticRemoved: 0 },
      proxySynced: false,
      note: "proxy has no /v1/cache route yet (WIRING.md pending) — nothing purged",
    });
  }
  return Response.json({
    flushed: true,
    scope,
    ...(value ? { value } : {}),
    purged: {
      exactRemoved: Number(r.data?.exact_removed ?? 0),
      semanticRemoved: Number(r.data?.semantic_removed ?? 0),
    },
    proxySynced: true,
  });
}
