import { proxyBase } from "../../../_lib/proxy-mgmt";
import { queryOrNull } from "@/lib/db";
import { issueKey } from "../../../_lib/virtual-keys";

export const dynamic = "force-dynamic";

// POST /api/integrations/:id/verify — complete the integration loop INSIDE
// the app: issue a fresh scoped key, fire one platform-shaped call through
// the live proxy, read back the metered row, return key material ONCE plus
// the proof. Old verify keys accumulate; revoke them in Keys (or reset).
// The platform-side step (paste the key into DronaHQ/Anakin/Nasiko) remains
// genuinely outside — this proves OUR side end-to-end.

const SCOPES = ["dronahq", "anakin", "nasiko"] as const;

// The exact payload shape each platform would send (documented in
// docs/integrations/*): Tool-Builder JSON task, generic agent task,
// CrewAI-style research task. Same OpenAI-compatible envelope.
function promptFor(scope: string): { model: string; content: string } {
  switch (scope) {
    case "dronahq":
      return { model: "gemini-2.0-flash", content: 'Tool task: {"action":"summarize_ticket","ticket_id":"T-1042","text":"Customer reports duplicate charge on the March invoice; wants a refund to the original card."} Return JSON with category, priority, suggested_reply.' };
    case "anakin":
      return { model: "gemini-2.0-flash", content: "App task: draft a three-bullet launch announcement for Acme Analytics v2, upbeat tone, under 60 words." };
    default:
      return { model: "gpt-4o-mini", content: "CrewAI research task: list three best practices for Redis caching in 2026 with one-line rationale each." };
  }
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const scope = decodeURIComponent(id ?? "").trim();
  if (!(SCOPES as readonly string[]).includes(scope)) {
    return Response.json({ error: "unknown_integration" }, { status: 404 });
  }

  let fullKey = "";
  let keyName = "";
  let keyPrefix = "";
  let keyLast4 = "";
  try {
    const issued = await issueKey({
      name: `${scope}-verify-${Date.now().toString(36)}`,
      agentScope: scope,
      teamScope: "ecosystem",
    });
    fullKey = issued.fullKey;
    keyName = issued.key.name;
    keyPrefix = issued.key.prefix;
    keyLast4 = issued.key.last4;
  } catch {
    return Response.json({ error: "key_issue_failed" }, { status: 503 });
  }

  const { model, content } = promptFor(scope);
  const t0 = Date.now();
  let status = 0;
  try {
    const res = await fetch(`${proxyBase()}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "AgentLedger-Key": fullKey,
        "X-Agent-Id": scope,
        "X-Team-Id": "ecosystem",
        "X-Project-Id": "integrations-verify",
      },
      body: JSON.stringify({ model, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(90000),
    });
    status = res.status;
    await res.json().catch(() => null);
  } catch (e) {
    return Response.json(
      { error: "proxy_unreachable", detail: e instanceof Error ? e.message.slice(0, 120) : "unreachable" },
      { status: 502 }
    );
  }

  // Read back the metered row: newest row for this scope within the window
  // (prefix formats differ between issuers; agent+team+recency is exact).
  await new Promise((r) => setTimeout(r, 1200));
  const rows = await queryOrNull<{
    model: string; tokens_in: string; tokens_out: string; cost_usd: string; latency_ms: string; status_code: number;
  }>(
    `SELECT model, tokens_in, tokens_out, cost_usd, latency_ms, status_code
     FROM request_logs
     WHERE agent_id = $1 AND team_id = 'ecosystem' AND ts > now() - interval '2 minutes'
     ORDER BY ts DESC LIMIT 1`,
    [scope]
  );
  const row = rows?.[0] ?? null;

  return Response.json(
    {
      key: { name: keyName, prefix: keyPrefix, last4: keyLast4 },
      fullKey,
      warning: "Shown ONCE — copy now. Paste it into the platform, then revoke it in Keys.",
      call: { requestedModel: model, proxyStatus: status, ms: Date.now() - t0 },
      metered: row
        ? {
          model: row.model,
          tokensIn: Number(row.tokens_in),
          tokensOut: Number(row.tokens_out),
          costUsd: Number(row.cost_usd),
          latencyMs: Number(row.latency_ms),
          statusCode: row.status_code,
        }
        : null,
    },
    { status: 201 }
  );
}
