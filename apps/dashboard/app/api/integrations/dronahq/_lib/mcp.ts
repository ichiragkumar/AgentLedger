/**
 * DronaHQ Vibe MCP client — SERVER ONLY.
 *
 * Typed JSON-RPC client for the DronaHQ Vibe MCP server (Streamable HTTP +
 * bearer auth). Pure server-side: the token is read from env
 * (`DRONAHQ_MCP_URL` / `DRONAHQ_MCP_TOKEN`) and must never leave the server —
 * never import this module (or its callers) from a client component.
 *
 * Protocol (verified live 2026-09-20):
 * - `initialize` → 200, `serverInfo.name === "DronaHQ Vibe MCP"`.
 * - `notifications/initialized` → 202, empty body.
 * - `tools/list` → 200 with 57 tools. The server is stateless: it issues no
 *   `mcp-session-id`, so the client sends the session header only when a
 *   server actually returns one (forward-compatible).
 * - `tools/call` → 200 `application/json`; tool-level failures arrive as
 *   `result.isError === true` (NOT as JSON-RPC errors).
 *
 * No dependencies — stdlib `fetch` only.
 */

export const MCP_PROTOCOL_VERSION = "2024-11-05";
export const MCP_DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ERROR_BODY_CHARS = 500;

export type McpErrorKind =
  | "config"
  | "transport"
  | "protocol"
  | "timeout"
  | "tool";

export class McpError extends Error {
  readonly kind: McpErrorKind;
  readonly status?: number;
  readonly jsonRpcCode?: number;
  readonly toolName?: string;

  constructor(
    kind: McpErrorKind,
    message: string,
    opts?: { status?: number; jsonRpcCode?: number; toolName?: string },
  ) {
    super(message);
    this.name = "McpError";
    this.kind = kind;
    this.status = opts?.status;
    this.jsonRpcCode = opts?.jsonRpcCode;
    this.toolName = opts?.toolName;
  }
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
}

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface McpInitializeResult {
  protocolVersion: string;
  serverInfo: McpServerInfo;
}

/** Parsed outcome of a successful (non-error) `tools/call`. */
export interface McpCallResult<T = unknown> {
  /** Tool that was called. */
  tool: string;
  /** Concatenated `text` content items (raw string form). */
  text: string;
  /**
   * `text` parsed as JSON when possible, otherwise the raw string.
   * Vibe tools return JSON-encoded strings (e.g. `"{\"apps\":[]}"`).
   */
  data: T;
  /** Raw `result` payload from the JSON-RPC envelope. */
  raw: unknown;
}

/**
 * Safe read-only tools. AgentLedger must NEVER invoke write / publish /
 * delete / create tools on the user's DronaHQ server — route layers should
 * gate `callTool` against this list.
 */
export const READ_ONLY_TOOLS: readonly string[] = [
  "vibe_list_apps",
  "vibe_get_app",
  "vibe_list_files",
  "vibe_read_file",
  "vibe_preview_url",
  "vibe_list_connectors",
  "vibe_get_connector_accounts",
  "vibe_get_db_schema",
  "vibe_get_data_agent_context",
  "vibe_list_data_agents",
  "vibe_prepare_sql_query_instructions",
  "vibe_list_subcats",
  "vibe_get_subcat",
  "vibe_get_subcat_input_schema",
  "vibe_list_catalogues",
  "vibe_get_catalogue_users",
  "vibe_list_groups",
  "vibe_check_users",
  "vibe_get_app_permissions",
  "vibe_get_connector_job",
  "automation_list",
  "automation_get",
  "automation_get_task_schema",
  "automation_get_tasks",
];

/** Tools that mutate server state — blocked by convention (see above). */
export const WRITE_TOOLS: readonly string[] = [
  "vibe_create_app",
  "vibe_write_file",
  "vibe_delete_file",
  "vibe_save_app",
  "vibe_publish",
  "vibe_set_access",
  "vibe_set_app_permissions",
  "vibe_create_data_agent",
  "vibe_update_data_agent",
  "vibe_run_db_query",
  "vibe_run_subcat",
  "vibe_create_rest_connector",
  "vibe_create_graphql_connector",
  "vibe_create_db_connector",
  "vibe_create_connector_account",
  "vibe_request_connector_setup",
  "vibe_bind_connectors",
  "vibe_create_subcat",
  "vibe_set_catalogue_groups",
  "vibe_add_catalogue_groups",
  "vibe_create_group",
  "vibe_add_user_to_group",
  "automation_create",
  "automation_rename",
  "automation_delete",
  "automation_duplicate",
  "automation_set_active",
  "automation_publish",
  "automation_add_tasks",
  "automation_update_task",
  "automation_remove_tasks",
  "automation_move_tasks",
  "automation_set_trigger",
];

export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.includes(name);
}

export interface McpClientOptions {
  url: string;
  token: string;
  timeoutMs?: number;
  protocolVersion?: string;
  /** Override for tests. Defaults to global `fetch`. */
  fetcher?: typeof fetch;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcEnvelope {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export class McpClient {
  private readonly url: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly protocolVersion: string;
  private readonly fetcher: typeof fetch;
  private sessionId: string | null = null;
  private nextId = 1;
  private initializedFlag = false;

  constructor(opts: McpClientOptions) {
    if (!opts.url || !opts.url.startsWith("http")) {
      throw new McpError("config", "McpClient requires an http(s) url.");
    }
    if (!opts.token) {
      throw new McpError("config", "McpClient requires a token.");
    }
    this.url = opts.url;
    this.token = opts.token;
    this.timeoutMs =
      opts.timeoutMs && opts.timeoutMs > 0
        ? opts.timeoutMs
        : MCP_DEFAULT_TIMEOUT_MS;
    this.protocolVersion = opts.protocolVersion ?? MCP_PROTOCOL_VERSION;
    this.fetcher = opts.fetcher ?? fetch;
  }

  /**
   * Build a client from env. Reads `DRONAHQ_MCP_URL` / `DRONAHQ_MCP_TOKEN`
   * (never logs them). Throws `McpError(kind="config")` when missing.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): McpClient {
    const url = env["DRONAHQ_MCP_URL"] ?? "";
    const token = env["DRONAHQ_MCP_TOKEN"] ?? "";
    if (!url) {
      throw new McpError("config", "Missing DRONAHQ_MCP_URL.");
    }
    if (!token) {
      throw new McpError("config", "Missing DRONAHQ_MCP_TOKEN.");
    }
    return new McpClient({ url, token });
  }

  get isInitialized(): boolean {
    return this.initializedFlag;
  }

  /** Session id captured from the server (null when stateless). */
  get session(): string | null {
    return this.sessionId;
  }

  private authHeader(): string {
    const t = this.token.trim();
    // The stored token may already carry a scheme prefix — don't double it.
    if (/^(bearer|basic|token)\s+/i.test(t)) return t;
    return `Bearer ${t}`;
  }

  /**
   * Full handshake: `initialize` then the `notifications/initialized`
   * notification. Safe to call once per request lifecycle; re-calling
   * re-handshakes (stateless servers treat each call independently).
   */
  async initialize(): Promise<McpInitializeResult> {
    const result = (await this.rpc("initialize", {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: { name: "agentledger-dashboard", version: "0.1.0" },
    })) as {
      protocolVersion?: string;
      serverInfo?: { name?: string; version?: string };
    };
    if (!result || typeof result !== "object" || !result.serverInfo?.name) {
      throw new McpError(
        "protocol",
        "Malformed initialize result: missing serverInfo.name.",
      );
    }
    // Notification: no id, empty/202 response expected — never fatal.
    try {
      await this.rpc("notifications/initialized", undefined, {
        notification: true,
      });
    } catch {
      // Stateless servers may 202 with no body; rpc() already tolerates that.
      // Any other failure here is non-fatal for subsequent calls.
    }
    this.initializedFlag = true;
    return {
      protocolVersion: result.protocolVersion ?? this.protocolVersion,
      serverInfo: {
        name: result.serverInfo.name,
        version: result.serverInfo.version ?? "unknown",
      },
    };
  }

  /** `tools/list` — returns the server's tool catalog. */
  async listTools(): Promise<McpTool[]> {
    const result = (await this.rpc("tools/list", {})) as {
      tools?: Array<{
        name?: string;
        description?: string;
        inputSchema?: unknown;
        annotations?: unknown;
      }>;
    };
    if (!result || !Array.isArray(result.tools)) {
      throw new McpError(
        "protocol",
        "Malformed tools/list result: missing tools array.",
      );
    }
    return result.tools.map((t) => ({
      name: t.name ?? "",
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
    }));
  }

  /**
   * `tools/call` with timeout. Throws `McpError(kind="tool")` when the
   * server reports `isError: true`. Callers should gate `name` against
   * `READ_ONLY_TOOLS` before invoking.
   */
  async callTool<T = unknown>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<McpCallResult<T>> {
    if (!name) throw new McpError("config", "callTool requires a tool name.");
    const result = (await this.rpc("tools/call", {
      name,
      arguments: args,
    })) as {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    };
    const text = Array.isArray(result?.content)
      ? result.content
          .filter((c) => c?.type === "text" && typeof c.text === "string")
          .map((c) => c.text as string)
          .join("\n")
      : "";
    if (result?.isError) {
      throw new McpError(
        "tool",
        `Tool "${name}" reported an error: ${truncate(text, MAX_ERROR_BODY_CHARS)}`,
        { toolName: name },
      );
    }
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = text as unknown as T;
    }
    return { tool: name, text, data, raw: result };
  }

  private async rpc(
    method: string,
    params: unknown,
    opts?: { notification?: boolean },
  ): Promise<unknown> {
    const id = this.nextId++;
    const body =
      opts?.notification
        ? { jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) }
        : { jsonrpc: "2.0", id, method, params: params ?? {} };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: this.authHeader(),
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetcher(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new McpError(
          "timeout",
          `MCP request "${method}" timed out after ${this.timeoutMs}ms.`,
        );
      }
      throw new McpError(
        "transport",
        `MCP request "${method}" failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const session = res.headers?.get?.("mcp-session-id");
    if (session) this.sessionId = session;

    if (!res.ok) {
      throw new McpError(
        "transport",
        `MCP request "${method}" failed with HTTP ${res.status}.`,
        { status: res.status },
      );
    }

    const envelope = await this.parseEnvelope(res, method);
    if (!envelope || typeof envelope !== "object") {
      if (opts?.notification) return null;
      throw new McpError(
        "protocol",
        `MCP request "${method}" returned an empty response.`,
      );
    }
    if (envelope.error) {
      throw new McpError(
        "protocol",
        `MCP request "${method}" failed: ${envelope.error.message ?? "unknown error"}`,
        { jsonRpcCode: envelope.error.code },
      );
    }
    if (!("result" in envelope)) {
      if (opts?.notification) return null;
      throw new McpError(
        "protocol",
        `MCP request "${method}" returned no result.`,
      );
    }
    return envelope.result ?? null;
  }

  /**
   * Parse a Streamable-HTTP response: plain `application/json` or an
   * SSE (`text/event-stream`) framing of JSON-RPC messages.
   */
  private async parseEnvelope(
    res: Response,
    method: string,
  ): Promise<JsonRpcEnvelope | null> {
    const contentType = res.headers?.get?.("content-type") ?? "";
    const raw = await res.text();
    if (!raw) return null;
    if (!contentType.includes("text/event-stream")) {
      return tryParseJson(raw, method);
    }
    // SSE: collect `data:` payloads, prefer one carrying result/error.
    let fallback: JsonRpcEnvelope | null = null;
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice("data:".length).trim();
      if (!payload || payload === "[DONE]") continue;
      const parsed = tryParseJson(payload, method, false);
      if (!parsed || typeof parsed !== "object") continue;
      if ("result" in parsed || "error" in parsed) return parsed;
      fallback ??= parsed;
    }
    return fallback;
  }
}

function tryParseJson(
  raw: string,
  method: string,
  strict = true,
): JsonRpcEnvelope | null {
  try {
    return JSON.parse(raw) as JsonRpcEnvelope;
  } catch {
    if (!strict) return null;
    throw new McpError(
      "protocol",
      `MCP request "${method}" returned non-JSON body.`,
    );
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
