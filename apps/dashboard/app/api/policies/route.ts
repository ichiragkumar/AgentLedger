import { randomBytes } from "node:crypto";
import { queryOrNull } from "@/lib/db";
import { mgmtHeaders, proxyFetch } from "../_lib/proxy-mgmt";

export const dynamic = "force-dynamic";

// Policies API (dashboard side, Postgres system-of-record).
//
// The Phase 4 policy engine lives in Go (internal/enforce, spec 07): YAML
// rules for model access, PII redact/block, max tokens, deny hours. This
// route persists policy docs to Postgres first (durable), then mirrors
// best-effort to the live management plane (POST/PUT/DELETE /v1/policies[/{id}])
// so the in-memory engine enforces the same rules without a restart.
// Responses carry proxySynced:false when the mirror failed — the durable
// write still won; enforcement catches up on the next successful write.
//
// Go policy IDs are `pol-N` (registry-assigned); Postgres IDs are `pol_<hex>`.
// The mirror lookup matches Go policies by (name, team) since the Go ID is
// not stored in Postgres (no schema change — see db/migrations/002).

export type PolicyKind = "model-access" | "pii" | "max-tokens" | "time-window" | "mixed";

export type PolicyView = {
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

type PolicyRow = {
  id: string;
  name: string;
  team: string;
  config: string;
  enabled: boolean;
  updated_at: string;
};

type GoPolicy = { id: string; name: string; team: string; config: string };

function firstMatch(re: RegExp, s: string): string | null {
  const m = re.exec(s);
  return m ? m[1].trim() : null;
}

function listOf(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

/** Derive a spec-17 list row (kind + one-line summary) from a YAML doc. */
export function summarizePolicy(name: string, config: string): { kind: PolicyKind; summary: string } {
  const flat = config.replace(/\s+/g, " ");
  const deny = listOf(firstMatch(/deny_models\s*:\s*(\[[^\]]*\]|[^,\n\]]+)/i, flat));
  const allow = listOf(firstMatch(/allow_models\s*:\s*(\[[^\]]*\]|[^,\n\]]+)/i, flat));
  const maxTok = firstMatch(/max_tokens_per_request\s*:\s*(\d+)/i, flat);
  const denyHours = firstMatch(/deny_hours\s*:\s*["']?([\d,\-\s]+)["']?/i, flat);
  const redact = /redact_pii\s*:\s*(true|yes|1|on)/i.test(flat);
  const block = /block_pii_to_external\s*:\s*(true|yes|1|on)/i.test(flat);

  const kinds: PolicyKind[] = [];
  if (deny.length > 0 || allow.length > 0) kinds.push("model-access");
  if (redact || block) kinds.push("pii");
  if (maxTok) kinds.push("max-tokens");
  if (denyHours) kinds.push("time-window");

  const parts: string[] = [];
  if (deny.length > 0) parts.push(`deny ${deny.join(", ")}`);
  if (allow.length > 0) parts.push(`allow ${allow.join(", ")}`);
  if (maxTok) parts.push(`max ${maxTok} tokens`);
  if (denyHours) parts.push(`deny ${denyHours.trim()} UTC`);
  if (redact && block) parts.push("redact + block PII");
  else if (redact) parts.push("redact PII");
  else if (block) parts.push("block PII to external");

  return {
    kind: kinds.length === 1 ? kinds[0] : kinds.length === 0 ? "model-access" : "mixed",
    summary: parts.join(" · ") || name,
  };
}

async function goPolicies(): Promise<GoPolicy[]> {
  const r = await proxyFetch<{ policies: GoPolicy[] }>("/v1/policies", { headers: mgmtHeaders() });
  if (!r.ok) return [];
  return (r.data as { policies: GoPolicy[] }).policies ?? [];
}

function goMatch(list: GoPolicy[], name: string, team: string): GoPolicy | null {
  return list.find((p) => p.name === name && p.team === team) ?? null;
}

function toView(b: PolicyRow, proxyId: string | null): PolicyView {
  const s = summarizePolicy(b.name, b.config);
  return {
    id: b.id,
    name: b.name,
    team: b.team,
    config: b.config,
    enabled: b.enabled,
    kind: s.kind,
    summary: s.summary,
    updatedAt: b.updated_at,
    proxyId,
  };
}

// GET /api/policies — durable list + live engine reachability.
export async function GET() {
  const rows = (await queryOrNull<PolicyRow>(
    `SELECT id, name, team, config, enabled, updated_at FROM policies ORDER BY team, name`
  )) ?? [];
  const live = await goPolicies();
  const reachable = (await proxyFetch<unknown>("/v1/policies", { headers: mgmtHeaders() })).ok;
  return Response.json({
    policies: rows.map((r) => toView(r, goMatch(live, r.name, r.team)?.id ?? null)),
    engine: { rules: live.length, reachable },
  });
}

// POST /api/policies {name, team, config, enabled?} — validate, persist, mirror.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_policy", message: "Policy needs a name, team, and YAML config." }, { status: 400 });
  }
  const name = String(body.name ?? "").trim();
  const team = String(body.team ?? "").trim();
  const config = String(body.config ?? "");
  const enabled = body.enabled === undefined ? true : Boolean(body.enabled);
  if (!name || !team || !config.trim()) {
    return Response.json(
      { error: "invalid_policy", message: "Policy needs a name, team scope, and YAML config." },
      { status: 400 }
    );
  }

  const id = `pol_${randomBytes(6).toString("hex")}`;
  const rows = await queryOrNull<PolicyRow>(
    `INSERT INTO policies (id, name, team, config, enabled) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, team = EXCLUDED.team,
       config = EXCLUDED.config, enabled = EXCLUDED.enabled, updated_at = now()
     RETURNING id, name, team, config, enabled, updated_at`,
    [id, name, team, config, enabled]
  );
  if (!rows?.[0]) return Response.json({ error: "unavailable", message: "Policy store is unreachable — try again." }, { status: 503 });

  // Mirror to the live engine. Invalid YAML is rejected by Go with 400 —
  // surface the human message, keep the durable row (engine skips it until fixed).
  const live = await proxyFetch<GoPolicy>("/v1/policies", {
    method: "POST",
    headers: mgmtHeaders(),
    body: JSON.stringify({ name, team, config }),
  });
  const res: Record<string, unknown> = { policy: toView(rows[0], live.ok ? live.data.id : null) };
  if (!live.ok && live.status === 400) {
    (res as Record<string, unknown>).engineError =
      "Live engine rejected the YAML (not applied yet) — fix the config and save again.";
  } else if (!live.ok && live.status === 403) {
    (res as Record<string, unknown>).engineError =
      "Only admins can change live policies — your draft is saved, ask an admin to apply it.";
  } else if (!live.ok) {
    res.proxySynced = false;
  }
  return Response.json(res, { status: 201 });
}

// PUT /api/policies?id= {name?, team?, config?, enabled?}
export async function PUT(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "missing_id", message: "Policy id is required." }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_policy", message: "Could not read the policy update." }, { status: 400 });
  }
  const rows = await queryOrNull<PolicyRow>(
    `UPDATE policies SET
       name = COALESCE($2, name),
       team = COALESCE($3, team),
       config = COALESCE($4, config),
       enabled = COALESCE($5, enabled),
       updated_at = now()
     WHERE id = $1
     RETURNING id, name, team, config, enabled, updated_at`,
    [
      id,
      body.name === undefined ? null : String(body.name),
      body.team === undefined ? null : String(body.team),
      body.config === undefined ? null : String(body.config),
      body.enabled === undefined ? null : Boolean(body.enabled),
    ]
  );
  if (!rows?.[0]) return Response.json({ error: "not_found", message: "Policy not found." }, { status: 404 });
  const b = rows[0];

  const live = await goPolicies();
  const match = goMatch(live, b.name, b.team);
  let synced = true;
  let proxyId: string | null = match?.id ?? null;
  if (match) {
    const r = await proxyFetch<GoPolicy>(`/v1/policies/${encodeURIComponent(match.id)}`, {
      method: "PUT",
      headers: mgmtHeaders(),
      body: JSON.stringify({ name: b.name, team: b.team, config: b.config }),
    });
    synced = r.ok;
  } else {
    const r = await proxyFetch<GoPolicy>("/v1/policies", {
      method: "POST",
      headers: mgmtHeaders(),
      body: JSON.stringify({ name: b.name, team: b.team, config: b.config }),
    });
    synced = r.ok;
    if (r.ok) proxyId = r.data.id;
  }
  const res: Record<string, unknown> = { policy: toView(b, proxyId) };
  if (!synced) res.proxySynced = false;
  return Response.json(res);
}

// DELETE /api/policies?id=
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "missing_id", message: "Policy id is required." }, { status: 400 });
  const rows = await queryOrNull<PolicyRow>(`DELETE FROM policies WHERE id = $1 RETURNING id, name, team`, [id]);
  if (!rows?.[0]) return Response.json({ error: "not_found", message: "Policy not found." }, { status: 404 });

  const match = goMatch(await goPolicies(), rows[0].name, rows[0].team);
  let synced = true;
  if (match) {
    const r = await proxyFetch(`/v1/policies/${encodeURIComponent(match.id)}`, {
      method: "DELETE",
      headers: mgmtHeaders(),
    });
    synced = r.ok || r.status === 404;
  }
  const res: Record<string, unknown> = { deleted: id };
  if (!synced) res.proxySynced = false;
  return Response.json(res);
}
