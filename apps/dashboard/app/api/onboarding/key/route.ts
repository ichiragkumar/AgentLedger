import { issueKey } from "../../_lib/virtual-keys";

export const dynamic = "force-dynamic";

// Onboarding step 2: first virtual key — full key shown ONCE + copy.
// The response is the only place the secret ever appears (never logged,
// never persisted — only sha256 + prefix + last4 hit the store).
// POST /api/onboarding/key {workspaceId?, agentScope?}
export async function POST(req: Request) {
  let body: { workspaceId?: string; agentScope?: string };
  try {
    body = (await req.json()) as { workspaceId?: string; agentScope?: string };
  } catch {
    body = {};
  }
  try {
    const { key, fullKey } = await issueKey({
      name: "first-key",
      agentScope: (body.agentScope ?? "").trim().slice(0, 80),
      teamScope: "",
    });
    return Response.json(
      {
        key,
        fullKey,
        workspaceId: body.workspaceId ?? null,
        warning: "Shown ONCE — copy now. It is never stored or shown again.",
      },
      { status: 201 }
    );
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
