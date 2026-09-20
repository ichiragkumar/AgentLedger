// POST /api/integrations/dronahq/invoke — call one allowlisted READ-ONLY
// Vibe MCP tool. Anything else → 403 `tool_not_allowed`.
//
// Coordinator decision (2026-09-20): inline helper stays (verified live;
// sibling `_lib/mcp.ts` class has a different result shape — swapping risks
// behavior change for zero functional gain).
//
// Logging discipline: NEVER log args verbatim (may carry user data) —
// tool name + byte size only. 503 when env/token missing.

export const dynamic = "force-dynamic";

// ---- Minimal local MCP helper (INLINE — deliberately not imported) ----
// See tools/route.ts coordinator note re sibling `_lib/mcp.ts`.
type McpEnv = { url: string; auth: string };

function mcpEnv(): McpEnv | null {
  const url = (process.env.DRONAHQ_MCP_URL ?? "").trim();
  const raw = (process.env.DRONAHQ_MCP_TOKEN ?? "").trim();
  if (!url || !raw) return null;
  // .env.local stores the full header value ("Bearer …"); accept bare tokens too.
  return { url, auth: /^bearer\s+/i.test(raw) ? raw : `Bearer ${raw}` };
}

function parseMcpBody(text: string, contentType: string | null): unknown[] {
  if ((contentType ?? "").includes("text/event-stream")) {
    return text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter((d) => d && d !== "[DONE]")
      .map((d) => JSON.parse(d) as unknown);
  }
  return [JSON.parse(text) as unknown];
}

async function mcpRpc(
  env: McpEnv,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number
): Promise<unknown> {
  const base: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: env.auth,
  };
  const initRes = await fetch(env.url, {
    method: "POST",
    headers: base,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "agentledger-dronahq", version: "1.0.0" },
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!initRes.ok) throw new Error(`mcp initialize ${initRes.status}`);
  const headers: Record<string, string> = { ...base };
  const sessionId = initRes.headers.get("mcp-session-id");
  if (sessionId) headers["mcp-session-id"] = sessionId;
  await initRes.text().catch(() => "");
  try {
    await fetch(env.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // best-effort: stateless servers ignore this
  }
  const res = await fetch(env.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`mcp ${method} ${res.status}`);
  const msgs = parseMcpBody(text, res.headers.get("content-type"));
  for (const m of msgs) {
    const rec = m as { result?: unknown; error?: { message?: string } };
    if (rec && typeof rec === "object" && "result" in rec) return rec.result;
    if (rec && typeof rec === "object" && rec.error) {
      throw new Error(`mcp ${method}: ${String(rec.error.message ?? "error").slice(0, 160)}`);
    }
  }
  throw new Error(`mcp ${method}: empty response`);
}

async function callTool(env: McpEnv, name: string, args: Record<string, unknown>): Promise<unknown> {
  return mcpRpc(env, "tools/call", { name, arguments: args }, 30000);
}
// ---- end inline MCP helper ----

// ---- READ-ONLY allowlist (exact contract from work order) ----
const ALLOWLIST = new Set([
  "vibe_list_apps",
  "vibe_list_connectors",
  "vibe_list_groups",
  "vibe_list_catalogues",
  "vibe_list_data_agents",
  "vibe_list_subcats",
  "vibe_get_data_agent_context",
  "automation_list",
]);
// + vibe_get_* single-reads (vibe_get_app, vibe_get_subcat, …).
const SINGLE_READ_RE = /^vibe_get_[A-Za-z0-9_]+$/;

function isAllowed(tool: string): boolean {
  return ALLOWLIST.has(tool) || SINGLE_READ_RE.test(tool);
}

function argsByteSize(args: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(args ?? {}), "utf8");
  } catch {
    return -1;
  }
}

export async function POST(req: Request) {
  let body: { tool?: unknown; args?: unknown };
  try {
    body = (await req.json()) as { tool?: unknown; args?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const tool = typeof body.tool === "string" ? body.tool.trim() : "";
  const args =
    body.args && typeof body.args === "object" ? (body.args as Record<string, unknown>) : {};
  if (!tool) return Response.json({ error: "tool_required" }, { status: 400 });
  if (!isAllowed(tool)) {
    console.log(`[dronahq/invoke] blocked tool=${tool} argsBytes=${argsByteSize(args)}`);
    return Response.json({ error: "tool_not_allowed", tool }, { status: 403 });
  }
  const env = mcpEnv();
  if (!env) return Response.json({ error: "mcp_not_configured" }, { status: 503 });
  console.log(`[dronahq/invoke] tool=${tool} argsBytes=${argsByteSize(args)}`);
  try {
    const result = await callTool(env, tool, args);
    return Response.json({ tool, result });
  } catch (e) {
    return Response.json(
      {
        error: "mcp_call_failed",
        tool,
        detail: e instanceof Error ? e.message.slice(0, 160) : "call failed",
      },
      { status: 502 }
    );
  }
}
