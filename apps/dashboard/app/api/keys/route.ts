import { mgmtHeaders, proxyFetch } from "../_lib/proxy-mgmt";
import {
  issueKey as localIssue,
  listKeys as localList,
  revokeKey as localRevoke,
  rotateKey as localRotate,
  type PublicKey,
} from "../_lib/virtual-keys";

export const dynamic = "force-dynamic";

// Virtual Key Vault API — proxy-first, Postgres fallback.
//
// The Go vault (internal/auth/vault.go, mounted at /v1/keys) shares the SAME
// virtual_keys table the dashboard used to own, so either issuer's keys
// resolve on the data plane. Dashboard routes forward to Go first (single
// live issuer → budgets/enforcement see the same keys) and fall back to the
// local PG helpers when the proxy is unreachable, so pages never 500.
// Shapes below map Go's snake_case KeyInfo/IssuedKey onto the existing
// PublicKey contract — UI and hooks are untouched.

type GoKeyInfo = {
  id: string;
  name: string;
  agent_scope: string;
  team_scope: string;
  prefix: string;
  last4: string;
  created_at: string;
  last_used_at?: string | null;
  revoked: boolean;
  grace_expires_at?: string | null;
  rotated_from?: string | null;
};

type GoIssued = GoKeyInfo & { key: string };

function toPublic(g: GoKeyInfo): PublicKey {
  const grace = g.grace_expires_at ?? null;
  const inGrace = g.revoked && grace !== null && new Date(grace).getTime() > Date.now();
  return {
    id: g.id,
    name: g.name,
    agentScope: g.agent_scope ?? "",
    teamScope: g.team_scope ?? "",
    prefix: g.prefix,
    last4: g.last4,
    createdAt: g.created_at,
    lastUsedAt: g.last_used_at ?? null,
    status: inGrace ? "grace" : g.revoked ? "revoked" : "active",
    rotatedFrom: g.rotated_from ?? null,
    graceExpiresAt: grace,
  };
}

// GET /api/keys — prefix/last4 list only. Full keys are never returned here.
export async function GET() {
  const live = await proxyFetch<{ keys: GoKeyInfo[] }>("/v1/keys", { headers: mgmtHeaders() });
  if (live.ok) return Response.json({ keys: (live.data.keys ?? []).map(toPublic), source: "proxy" });
  try {
    return Response.json({ keys: await localList(), source: "postgres-fallback" });
  } catch {
    return Response.json({ keys: [] });
  }
}

// POST /api/keys {name, agentScope?, teamScope?} — fullKey appears ONCE.
export async function POST(req: Request) {
  let body: { name?: string; agentScope?: string; teamScope?: string };
  try {
    body = (await req.json()) as { name?: string; agentScope?: string; teamScope?: string };
  } catch {
    return Response.json({ error: "invalid_key_request" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (!name) return Response.json({ error: "missing_name" }, { status: 400 });

  const live = await proxyFetch<GoIssued>("/v1/keys", {
    method: "POST",
    headers: mgmtHeaders(),
    body: JSON.stringify({ name, agent_scope: body.agentScope ?? "", team_scope: body.teamScope ?? "" }),
  });
  if (live.ok) {
    return Response.json(
      { key: toPublic(live.data), fullKey: live.data.key, warning: "Shown ONCE — copy now. It is never stored or shown again." },
      { status: 201 }
    );
  }
  try {
    const { key, fullKey } = await localIssue({ name, agentScope: body.agentScope ?? "", teamScope: body.teamScope ?? "" });
    return Response.json(
      { key, fullKey, warning: "Shown ONCE — copy now. It is never stored or shown again.", proxySynced: false },
      { status: 201 }
    );
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}

// DELETE /api/keys?id= — instant revoke.
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

  // Capture the pre-image for the {revoked, key} contract before revoking.
  const before = await proxyFetch<{ keys: GoKeyInfo[] }>("/v1/keys", { headers: mgmtHeaders() });
  if (before.ok) {
    const found = (before.data.keys ?? []).find((k) => k.id === id);
    const res = await proxyFetch(`/v1/keys/${encodeURIComponent(id)}`, { method: "DELETE", headers: mgmtHeaders() });
    if (res.ok) return Response.json({ revoked: id, key: found ? toPublic(found) : null, source: "proxy" });
    if (res.status === 404) return Response.json({ error: "not_found" }, { status: 404 });
  }
  try {
    const key = await localRevoke(id);
    if (!key) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ revoked: id, key, proxySynced: false });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}

// PUT /api/keys?id=&graceSeconds= — rotate with grace (default 1h).
export async function PUT(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const graceSeconds = Math.min(Math.max(Number(url.searchParams.get("graceSeconds") ?? 3600) || 3600, 0), 7 * 86400);
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

  const live = await proxyFetch<GoIssued>(`/v1/keys/${encodeURIComponent(id)}/rotate`, {
    method: "POST",
    headers: mgmtHeaders(),
    body: JSON.stringify({ grace_seconds: graceSeconds }),
  });
  if (live.ok) {
    return Response.json({
      key: toPublic(live.data),
      fullKey: live.data.key,
      warning: "New key shown ONCE. Old key stays valid until grace expires.",
      source: "proxy",
    });
  }
  if (live.status === 404) return Response.json({ error: "not_found_or_revoked" }, { status: 404 });
  try {
    const rotated = await localRotate(id, graceSeconds);
    if (!rotated) return Response.json({ error: "not_found_or_revoked" }, { status: 404 });
    return Response.json({ ...rotated, warning: "New key shown ONCE. Old key stays valid until graceExpiresAt.", proxySynced: false });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
