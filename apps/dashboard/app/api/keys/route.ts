import { issueKey, listKeys, revokeKey, rotateKey } from "../_lib/virtual-keys";

export const dynamic = "force-dynamic";

// Virtual Key Vault API.
//
// Semantics mirror the Go vault contract (internal/auth/auth.go + spec 17):
// full key shown ONCE at creation/rotation, last-4 + prefix afterwards,
// revoke is instant, rotate carries a configurable grace window. Plaintext
// provider keys are NEVER logged or stored — only sha256 + safe slices.
//
// TODO(PROXY): sync with the Go management plane once it exposes a key
// vault API. Needed proxy endpoints: POST /v1/keys, DELETE /v1/keys/{id},
// POST /v1/keys/{id}/rotate, GET /v1/keys (prefix-only).

// GET /api/keys — prefix/last4 list only. Full keys are never returned here.
export async function GET() {
  try {
    return Response.json({ keys: await listKeys() });
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
  try {
    const { key, fullKey } = await issueKey({
      name,
      agentScope: body.agentScope ?? "",
      teamScope: body.teamScope ?? "",
    });
    return Response.json(
      {
        key,
        fullKey,
        warning: "Shown ONCE — copy now. It is never stored or shown again.",
      },
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
  try {
    const key = await revokeKey(id);
    if (!key) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ revoked: id, key });
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
  try {
    const rotated = await rotateKey(id, graceSeconds);
    if (!rotated) return Response.json({ error: "not_found_or_revoked" }, { status: 404 });
    return Response.json({
      ...rotated,
      warning: "New key shown ONCE. Old key stays valid until graceExpiresAt.",
    });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
