// POST /api/integrations/dronahq/run — the working loop in one call:
// 1) call an allowlisted READ-ONLY Vibe MCP tool (default: vibe_list_apps),
// 2) summarize the result (truncated to 2k chars) via an LLM call through the
//    live proxy (fresh key issued via Go POST /v1/keys, agent `dronahq`,
//    team `ecosystem`, model `gemini-2.0-flash`),
// 3) read back the metered request_logs row,
// 4) return { toolResult, summary, metered, key prefix/last4 }.
// Full key material is used server-side and NEVER returned (or logged).
// Purge nothing — the verify track owns cleanup.
//
// Coordinator decision (2026-09-20): inline helper stays (verified live;
// see tools/route.ts note re sibling `_lib/mcp.ts`).

import { queryOrNull } from "@/lib/db";
import { proxyBase, mgmtHeaders } from "../../../_lib/proxy-mgmt";

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

const DEFAULT_TOOL = "vibe_list_apps";
const SUMMARY_MODEL = "gemini-2.0-flash";
const RESULT_TRUNCATE = 2000; // chars of tool-result JSON fed to the summarizer
const TOOL_RESULT_CAP = 20000; // chars of tool-result JSON echoed back

type IssuedKey = { key: string; id: string; name: string; prefix: string; last4: string };

// Fresh vk_dronahq_* key from the Go management plane (POST /v1/keys).
// Full material is returned ONCE and stays server-side.
async function issueRunKey(): Promise<IssuedKey> {
  const res = await fetch(`${proxyBase()}/v1/keys`, {
    method: "POST",
    headers: mgmtHeaders(),
    body: JSON.stringify({
      name: `vk_dronahq_run_${Date.now().toString(36)}`,
      agent_scope: "dronahq",
      team_scope: "ecosystem",
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`key issue ${res.status}`);
  const body = (await res.json()) as Partial<IssuedKey>;
  if (!body.key || !body.prefix || !body.last4) throw new Error("key issue malformed");
  return body as IssuedKey;
}

function argsByteSize(args: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(args ?? {}), "utf8");
  } catch {
    return -1;
  }
}

export async function POST(req: Request) {
  let body: { tool?: unknown; args?: unknown; prompt?: unknown };
  try {
    body = (await req.json()) as { tool?: unknown; args?: unknown; prompt?: unknown };
  } catch {
    body = {};
  }
  const tool = typeof body.tool === "string" && body.tool.trim() ? body.tool.trim() : DEFAULT_TOOL;
  const args =
    body.args && typeof body.args === "object" ? (body.args as Record<string, unknown>) : {};
  const userPrompt = typeof body.prompt === "string" ? body.prompt.slice(0, 1000) : "";
  if (!isAllowed(tool)) {
    console.log(`[dronahq/run] blocked tool=${tool} argsBytes=${argsByteSize(args)}`);
    return Response.json({ error: "tool_not_allowed", tool }, { status: 403 });
  }
  const env = mcpEnv();
  if (!env) return Response.json({ error: "mcp_not_configured" }, { status: 503 });

  // 1) Allowlisted MCP tool call (log name + size only, never args).
  console.log(`[dronahq/run] tool=${tool} argsBytes=${argsByteSize(args)}`);
  let toolResult: unknown;
  try {
    toolResult = await callTool(env, tool, args);
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

  // 2) Fresh proxy key + LLM summarization through the live proxy.
  let issued: IssuedKey;
  try {
    issued = await issueRunKey();
  } catch {
    return Response.json({ error: "key_issue_failed", tool }, { status: 503 });
  }
  console.log(`[dronahq/run] key prefix=${issued.prefix} tool=${tool}`);

  const rawResult = (() => {
    try {
      return JSON.stringify(toolResult);
    } catch {
      return '"<unserializable result>"';
    }
  })();
  const truncated = rawResult.slice(0, RESULT_TRUNCATE);
  const content =
    `Summarize this DronaHQ MCP tool result for an operator dashboard in 3-5 short bullets ` +
    `(names, counts, anything needing attention). Do not invent data not present.\n\n` +
    `Tool: ${tool}\nResult JSON (truncated to ${RESULT_TRUNCATE} chars):\n${truncated}` +
    (userPrompt ? `\n\nOperator instruction: ${userPrompt}` : "");
  let summary = "";
  try {
    const chat = await fetch(`${proxyBase()}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "AgentLedger-Key": issued.key,
        "X-Agent-Id": "dronahq",
        "X-Team-Id": "ecosystem",
        "X-Project-Id": "dronahq-run",
      },
      body: JSON.stringify({ model: SUMMARY_MODEL, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(90000),
    });
    if (!chat.ok) {
      return Response.json(
        { error: "proxy_call_failed", tool, proxyStatus: chat.status },
        { status: 502 }
      );
    }
    const chatBody = (await chat.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
    } | null;
    summary = String(chatBody?.choices?.[0]?.message?.content ?? "").slice(0, 4000);
  } catch (e) {
    return Response.json(
      {
        error: "proxy_unreachable",
        tool,
        detail: e instanceof Error ? e.message.slice(0, 120) : "unreachable",
      },
      { status: 502 }
    );
  }

  // 3) Read back the metered row (agent+team+recency; prefix formats differ).
  await new Promise((r) => setTimeout(r, 1200));
  const rows = await queryOrNull<{
    model: string;
    tokens_in: string;
    tokens_out: string;
    cost_usd: string;
    latency_ms: string;
    status_code: number;
  }>(
    `SELECT model, tokens_in, tokens_out, cost_usd, latency_ms, status_code
     FROM request_logs
     WHERE agent_id = $1 AND team_id = 'ecosystem' AND ts > now() - interval '2 minutes'
     ORDER BY ts DESC LIMIT 1`,
    ["dronahq"]
  );
  const row = rows?.[0] ?? null;

  // 4) Proof bundle. Full key material NEVER leaves the server.
  let echoed: unknown = toolResult;
  let resultTruncated = false;
  if (rawResult.length > TOOL_RESULT_CAP) {
    echoed = `${rawResult.slice(0, TOOL_RESULT_CAP)}…[truncated ${rawResult.length - TOOL_RESULT_CAP} chars]`;
    resultTruncated = true;
  }
  return Response.json(
    {
      tool,
      toolResult: echoed,
      toolResultTruncated: resultTruncated,
      summary,
      summaryModel: SUMMARY_MODEL,
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
      key: { prefix: issued.prefix, last4: issued.last4 },
    },
    { status: 200 }
  );
}
