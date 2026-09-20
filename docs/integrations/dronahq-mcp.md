# DronaHQ Vibe MCP — Client Protocol Notes

> Live-verified 2026-09-20 against the user's DronaHQ Vibe MCP server
> (`DRONAHQ_MCP_URL` in gitignored `apps/dashboard/.env.local`).
> Counts and shapes only — no secrets recorded here.
>
> Client: `apps/dashboard/app/api/integrations/dronahq/_lib/mcp.ts`
> (`McpClient`, stdlib `fetch`, no new deps, server-only).

## Transport

- **Streamable HTTP**: single `POST` endpoint; every call is a JSON-RPC 2.0
  object with `Content-Type: application/json` and
  `Accept: application/json, text/event-stream`.
- **Handshake**: `initialize` → `200` with
  `serverInfo = { name: "DronaHQ Vibe MCP", version: "1.0.0" }`,
  then the `notifications/initialized` notification → `202` empty body.
  Recommended `protocolVersion`: `"2024-11-05"`.
- **Sessions**: the server is **stateless** — it issues no `mcp-session-id`
  header, so each call stands alone. `McpClient` still captures and re-sends
  `Mcp-Session-Id` when a server provides one (forward-compatible).
- **Response shape**: plain `application/json` in practice; the client also
  parses `text/event-stream` (SSE `data:` lines) per the Streamable-HTTP spec.
- **Timeout**: 30 s per call (`AbortController` → `McpError(kind="timeout")`).

## Auth model

- `Authorization: Bearer <jwt>` header on every request. The stored token
  already carries the `Bearer` prefix; the client sends it as-is and only
  adds the prefix when missing.
- Token lives **only** in `apps/dashboard/.env.local` (gitignored) as
  `DRONAHQ_MCP_URL` / `DRONAHQ_MCP_TOKEN`, read server-side via
  `McpClient.fromEnv()`. Never logged, never sent to the browser, never
  written to repo files. `McpError` messages contain counts/statuses only.

## Error taxonomy (`McpError.kind`)

| kind | Meaning |
|---|---|
| `config` | Missing/bad URL, token, or tool name (client-side, pre-flight). |
| `transport` | Network failure or non-2xx HTTP (includes `.status`). |
| `protocol` | JSON-RPC `error` member, malformed envelope, non-JSON body (includes `.jsonRpcCode`). |
| `timeout` | No response within 30 s. |
| `tool` | `tools/call` returned `result.isError === true` (includes `.toolName` + truncated tool text). Unknown tools surface here, e.g. `Tool 'x' is not executable on the direct MCP server.` |

## Tool catalog — 57 builder tools (live `tools/list` count: 57)

Vibe tools use the `vibe_*` prefix (micro-apps, connectors, data agents,
subcats, catalogues/groups); `automation_*` covers workflow automations.
Single-get variants exist for most list tools.

### Safe read-only subset (AgentLedger may call these)

Enforced in code via `READ_ONLY_TOOLS` / `isReadOnlyTool()`:

| Tool | Returns |
|---|---|
| `vibe_list_apps` | App list (live probe returned `{"apps":[]}`) |
| `vibe_get_app` | Single app detail |
| `vibe_list_files` / `vibe_read_file` | App file listing / file content |
| `vibe_preview_url` | Preview URL for an app |
| `vibe_list_connectors` | Connector catalog |
| `vibe_get_connector_accounts` | Accounts for a connector |
| `vibe_get_db_schema` | DB schema for a user-picked `catId` |
| `vibe_get_data_agent_context` | Data-agent context |
| `vibe_list_data_agents` | Data-agent list |
| `vibe_prepare_sql_query_instructions` | Required prep step before inventing subcat/test SQL |
| `vibe_list_subcats` | Sub-category list |
| `vibe_get_subcat` / `vibe_get_subcat_input_schema` | Subcat detail / input schema |
| `vibe_list_catalogues` / `vibe_get_catalogue_users` | Catalogue list / members |
| `vibe_list_groups` / `vibe_check_users` | Group list / user lookup |
| `vibe_get_app_permissions` | App permission map |
| `vibe_get_connector_job` | Async connector-setup job status (poll target) |
| `automation_list` | Automation list |
| `automation_get` / `automation_get_task_schema` / `automation_get_tasks` | Automation detail / task schema / tasks |

### Write / publish / delete / create tools (NEVER call)

Blocked by convention (`WRITE_TOOLS` list, route layers must gate on
`isReadOnlyTool`). Includes all `vibe_create_*`, `vibe_write_file`,
`vibe_delete_file`, `vibe_save_app`, `vibe_publish`, `vibe_set_access`,
`vibe_*_permissions` setters, `vibe_run_db_query`, `vibe_run_subcat`,
`vibe_request_connector_setup`, `vibe_bind_connectors`,
catalogue/group mutators, and all `automation_*` mutators
(`automation_create/rename/delete/duplicate/set_active/publish`,
`automation_add_tasks/update_task/remove_tasks/move_tasks/set_trigger`).

> Server-side operating rules (from the server's own instructions): new builds
> start with clarifying questions, never scan `vibe_get_db_schema` across many
> `catId`s, never put secrets in chat / create calls, and always run
> `vibe_prepare_sql_query_instructions(catId)` before inventing SQL.

## Live verification (2026-09-20, counts only)

- `initialize` → 200 (`DronaHQ Vibe MCP v1.0`).
- `notifications/initialized` → 202, empty.
- `tools/list` → 200, **57 tools**.
- `tools/call vibe_list_apps {}` → 200, `isError: false`,
  payload `{"apps":[]}`.
- `tools/call <unknown>` → 200 with `isError: true`
  (tool-level error, not JSON-RPC error).

## Next step

Sibling route agent wires `GET/POST` handlers on top of `McpClient`
(list-tools + gated `callTool` for the read-only subset), reusing
`isReadOnlyTool()` — no client changes needed.
