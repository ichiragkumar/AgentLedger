import { mgmtHeaders, proxyFetch } from "../../_lib/proxy-mgmt";
import { issueKey as localIssue } from "../../_lib/virtual-keys";

export const dynamic = "force-dynamic";

// Onboarding step 2: first virtual key — full key shown ONCE + copy.
// The response is the only place the secret ever appears (never logged,
// never persisted — only sha256 + prefix + last4 hit the store).
// Issues via the Go vault first (shared virtual_keys table), local PG
// fallback when the proxy is unreachable.
// POST /api/onboarding/key {workspaceId?, agentScope?}
export async function POST(req: Request) {
  let body: { workspaceId?: string; agentScope?: string };
  try {
    body = (await req.json()) as { workspaceId?: string; agentScope?: string };
  } catch {
    body = {};
  }
  const agentScope = (body.agentScope ?? "").trim().slice(0, 80);

  const live = await proxyFetch<{ id: string; key: string }>(`/v1/keys`, {
    method: "POST",
    headers: mgmtHeaders(),
    body: JSON.stringify({ name: "first-key", agent_scope: agentScope, team_scope: "" }),
  });
  if (live.ok && live.data.key) {
    return Response.json(
      {
        key: { id: live.data.id },
        fullKey: live.data.key,
        workspaceId: body.workspaceId ?? null,
        warning: "Shown ONCE — copy now. It is never stored or shown again.",
      },
      { status: 201 }
    );
  }
  try {
    const { key, fullKey } = await localIssue({ name: "first-key", agentScope, teamScope: "" });
    return Response.json(
      { key, fullKey, workspaceId: body.workspaceId ?? null, warning: "Shown ONCE — copy now. It is never stored or shown again.", proxySynced: false },
      { status: 201 }
    );
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
