# DronaHQ Seams — How AgentLedger Can Intercept DronaHQ Agent Traffic

> Research date: 2026-09-20. Question: EXACTLY how can a DronaHQ agent's LLM traffic flow through AgentLedger (`OPENAI_BASE_URL=http://agentledger:8787/v1` model)?
> Short answer: **there is no documented arbitrary-base-URL seam for agent LLM calls.** The viable seams are all **tool-level** (REST connector, Code tool, MCP-consume), not LLM-transport-level.

## Verdict table

| # | Seam | Verdict | What it means for AgentLedger |
|---|------|---------|-------------------------------|
| 1a | Custom LLM / arbitrary OpenAI-compatible `base_url` per agent (proxy insertion) | **NOT-SUPPORTED** (no doc evidence) | Cannot point a DronaHQ agent's model calls at `http://agentledger:8787/v1`. Model picker is a closed provider list on the built-in DronaHQ key. |
| 1b | BYOK (own provider API key) | **ACCOUNT-NEEDED** (Enterprise plan gate) | FAQ gates BYOK to Enterprise; no public doc shows the settings screen or whether a custom base URL is accepted. Needs in-account verification. |
| 2 | Tool Builder → arbitrary HTTPS API call (POST to AgentLedger proxy / management plane as a *tool*) | **WORKS** | Agent can call any REST endpoint (incl. AgentLedger) as a Connector Query tool, with full auth + header + JSON-body support. Observes tool traffic, NOT LLM traffic. |
| 3a | JS/Python Code tool sets a custom LLM endpoint | **NOT-SUPPORTED** (no doc evidence) | Code runs as an agent *tool* (data transform / business rules), not as LLM-transport override. No doc shows setting `base_url` from workflow code. |
| 3b | JS/Python Code tool calls AgentLedger via `fetch` | **WORKS** | Same transport as Seam 2, from inside a Code tool. Viable for management-plane logging. |
| 4a | DronaHQ agent *consumes* external MCP server (AgentLedger exposed as MCP) | **WORKS** | Tools-overview documents Streamable HTTP + SSE, no-auth / token / custom headers. AgentLedger could be an MCP tool source. Tool-level only. |
| 4b | Agent LLM traffic routed *over* MCP / DronaHQ exposes its LLM via MCP | **NOT-SUPPORTED** | DronaHQ's MCP-server add-on exposes *connectors/queries* to third-party agents (Cursor/Claude/Windsurf), not its agents' LLM calls. MCP is a tool protocol here, not an LLM proxy. |

## Evidence (all URLs fetched HTTP 200 on 2026-09-20)

### Seam 1 — Custom LLM / BYOK

- E1 — https://www.dronahq.com/agents/faq/
  - Quote: *"Agents use the built-in DronaHQ key by default. Bring your own LLM key is available on the Enterprise plan."* (answer to "Can I use my own LLM provider's API key?")
  - Quote: *"DronaHQ Agents support multiple LLM providers and models through the built-in DronaHQ key. You can view the updated list of supported models and their credit usage here."*
  - Quote: *"Can each Agent use a different model or provider? Yes. You can mix providers and models across Agents."* — per-agent model choice exists, but only within the supported list, on the DronaHQ key.
- E2 — https://www.dronahq.com/agents/custom-agents/
  - Quote: *"DronaHQ Agents currently support multiple LLM providers and models through the built-in DronaHQ key. … Agents currently use the built-in DronaHQ key for all supported LLM providers and models."*
  - Quote (builder steps): *"1. Pick a model - choose from GPT-4o, Claude, Gemini, Azure OpenAI, or AWS Bedrock. You can swap this later without rebuilding anything."* — closed provider list, no base-URL field documented.
- E3 — https://docs.dronahq.com/agents/getting-started/credit-usage/
  - Quote: model tables list only OpenAI / Anthropic / Google families (e.g. `gpt-4o`, `claude-sonnet-4-5-20250929`, `gemini-2.5-flash`) with per-1K input/output credit costs. No custom-endpoint model entry. Confirms LLM billing is DronaHQ-metered (credits), incompatible with an external proxy transparently intercepting calls.
- Click path (documented, no account needed to cite): `agents.dronahq.com → Agents → + Add Agent → Model (OpenAI, Gemini, Anthropic)` per https://docs.dronahq.com/agents/getting-started/introduction/ ("Configure the basic properties: Agent Name, Agent Description, Model (OpenAI, Gemini, Anthropic)"). No documented `base_url` / custom-endpoint field anywhere on this path.
- NEEDS-ACCOUNT: Enterprise BYOK screen — exact path, whether it accepts an arbitrary OpenAI-compatible base URL + key (vs. selecting a provider and pasting that provider's key), and whether per-agent keys vs. workspace keys. **Do not claim a proxy seam until this is verified in-account.**

### Seam 2 — Tool Builder → arbitrary HTTPS API

- E4 — https://docs.dronahq.com/rest-apis/configuring-apis/
  - Quote: *"DronaHQ has different options including the use of the REST API that allows you to easily connect to the Third Party APIs and access to important systems."*
  - Quote: *"Method — Specifies the REST method (such as POST, GET, DELETE, etc.) to be utilized for the request."* / *"URL — Specifies the endpoint to be queried."* / *"Headers — Sets key/value pairs to send in the request header."* / *"RAW - application/json is used for sending JSON-encoded data in the request body."*
  - Quote: *"Pasting a cURL request it auto-fills all the relevant API information, including authorization, request method, headers, parameters, and more."* — fastest way to point a connector at AgentLedger: paste the proxy/management-plane cURL.
- E5 — https://docs.dronahq.com/rest-apis/api-authentication/
  - Quote: auth dropdown supports *"API Key Authentication, Basic, AWS, Digest, Hawk, JWT Bearer, NTLM, OAuth-V2 / PKCE / Client Credentials / JWT / 1.0a, Multistep"*. AgentLedger `vk_xxx` virtual keys can travel as API-key-in-header or raw `{{key}}` template variable (connector supports `{{variablename}}` dynamic params).
  - AgentLedger mapping: `AgentLedger-Key: vk_xxx` + attribution headers (`X-Agent-Id`, `X-Team-Id`, `X-Project-Id`) per specs/02 are all expressible as connector headers.
- E6 — https://docs.dronahq.com/agents/getting-started/tools-overview/ + https://docs.dronahq.com/agents/getting-started/introduction/
  - Quote (tools-overview): *"Connector Library — … fetch, insert, update, or remove data across various databases and APIs"*; *"Connector Query — … seamlessly query most databases and APIs."*
  - Quote (introduction): *"1. Click + Add Tools. 2. Choose tools from available list under - DronaHQ Tools, Connector Library, Automations, Code, MCP etc. 3. Configure Account for selected tool…"*
  - Quote (FAQ, E1): *"Can I use my existing connectors as Agent tools? Yes. Agents can use your existing connectors from the global connector library."*
- Click path (all steps documented): `DronaHQ → Connectors → + Connector → REST API → Authentication + Method + URL + Headers + Body → Test → Save` (E4), then `Agents → <agent> → + Add Tools → Connector Library / Connector Query → select the AgentLedger query → Add Tools` (E6).
- Limitation (honesty note): this observes **tool-call** traffic the builder explicitly wires, not the agent's **LLM token** traffic (which stays on the DronaHQ key / credit meter). AgentLedger gets management-plane events, not `usage.prompt_tokens` from DronaHQ's model calls.

### Seam 3 — JS/Python execution / prompt chains

- E7 — https://www.dronahq.com/ai-agents-for-business/ ("What are AI tools?")
  - Quote: *"With DronaHQ's Tool Builder, you can: Build custom integrations or connect to APIs. Create LLM prompt chains for reasoning or structured outputs. Use pre-built third-party integrations from DronaHQ's library. Execute custom code directly inside your workflow."*
- E8 — tools-overview Code section (E6 URL): Quote: *"A dedicated environment for custom logic … It supports code written in JavaScript and Python."*
- E9 — FAQ (E1 URL): Quote: *"Can I add my own code or logic to an Agent? Yes. You can write JavaScript or Python and expose it as a custom tool for the Agent to use during execution."*
- Verdict basis: every Code citation frames JS/Python as a **tool** ("expose it as a custom tool", "custom logic … beyond standard configurations"). No doc shows a Code block configuring the agent's model transport (`base_url`, client constructor, provider SDK init against a custom endpoint). Prompt chains are listed as a Tool Builder capability for "reasoning or structured outputs" — i.e., DronaHQ-managed LLM steps, still on the DronaHQ key.
- Click path (documented): `Agents → <agent> → + Add Tools → Code → write JavaScript/Python → expose as tool` (E6+E9). NEEDS-ACCOUNT: whether the Code sandbox has network egress (`fetch`) to reach a self-hosted AgentLedger URL, and which allowlist/firewall rules apply.

### Seam 4 — MCP

- E10 — tools-overview MCP section (E6 URL):
  - Quote: *"You can connect your existing MCP servers directly to DronaHQ, enabling agentic workflows to securely access and interact with external tools and standardized data protocols."*
  - Quote: *"Server Types: Supports Streamable HTTP and SSE. Configuration: Define the server name, URL, and description. Security: Supports no authentication, access tokens, or custom headers."*
- E11 — https://docs.dronahq.com/agents/getting-started/introduction/ tool list: Quote: *"MCP – Integrate with your MCP servers in your account."*
- E12 — https://docs.dronahq.com/mcp%20server/configuring-mcp-server/ (reverse direction — DronaHQ *exposes* MCP):
  - Quote: console path *"navigate to the Add-ons section … Locate the MCP Server add-on"*, *"Click on the Add MCP button … Connector — Select the connector you wish to expose … choose the specific queries you want to expose via this MCP."* — DronaHQ wraps its **connectors/queries** as MCP tools, not its LLM stream.
- E13 — https://docs.dronahq.com/mcp%20server/exposing-mcp-to-ai-agents/:
  - Quote: *"Once your MCP server is set up in DronaHQ, you can expose it to your AI agents such as Cursor, Claude, Windsurf, and others"* with per-client `mcp.json` (`Server URL` + `Authorization: Bearer <JWT_TOKEN>`). Consumers are third-party coding agents, not a proxy for DronaHQ's own agent LLM calls.
- Click path (consume, documented): `Agents → <agent> → + Add Tools → MCP → define server name, URL, description → auth (none / access token / custom headers)` (E10). NEEDS-ACCOUNT: exact MCP tool schema surfacing in traces, and whether Streamable HTTP works against a non-public (VPC) AgentLedger URL.
- AgentLedger implication: exposing AgentLedger as an MCP server that DronaHQ agents consume is architecturally clean (standard tool protocol, header auth for `vk_xxx`), but yields the same tool-level-only visibility as Seam 2.

### Bonus (integration-relevant, not an LLM seam)

- https://docs.dronahq.com/agents/developer/api-keys/ — workspace `sk_`-prefixed keys, `api-key: sk_…` header (NOT `Authorization: Bearer`), scoped to Agent / Data Agent / Voice Agent, with 30-day Request Logs. Useful if AgentLedger ever calls *into* DronaHQ (dispatch/trigger), not for intercepting LLM traffic.
- FAQ traceability (E1): *"Every Agent run is logged with full traceability, including inputs, outputs, tool calls, and timestamps … in the Traces section. Trace data is retained for ninety days."* — DronaHQ-side audit source to reconcile against AgentLedger tool-call logs.

## What was NOT found (negative results, also evidence)

- No `base_url` / custom-endpoint / OpenAI-compatible-proxy setting in any agent doc page fetched (introduction, tools-overview, credit-usage, structured-output concept known from search).
- No "bring your own model endpoint" or "custom LLM provider" connector; the Managed-AI / OpenAI connector docs cover *app* builders using OpenAI keys, not *agent* LLM transport override.
- No MCP-as-LLM-transport doc; MCP appears exclusively as a tool protocol in both directions.
- `agents.dronahq.com` builder UI itself is behind login — click paths above are doc-derived, not screen-verified (flagged NEEDS-ACCOUNT where the doc stops).

## NEEDS list (accounts / creds / access)

1. [ACCOUNT] DronaHQ account (free trial suffices for Seams 2/3/4a) — verify REST-connector → AgentLedger POST, Code-tool egress, MCP-consume against a public test endpoint; capture screenshots + trace IDs.
2. [ACCOUNT] Enterprise-plan workspace (or sales-led trial) — verify Seam 1b BYOK screen: fields accepted (provider dropdown vs. free-form base URL), per-agent vs. workspace scope, key storage/rotation.
3. [NETWORK] Publicly reachable AgentLedger test endpoint (or ngrok) for 1–2 — DronaHQ Cloud must reach it; self-hosted AgentLedger on localhost is insufficient.
4. [CREDS] One `vk_test_xxx` virtual key + one throwaway DronaHQ `sk_…` developer key for the verification run (revoke after).
5. [DOC] DronaHQ support/sales confirmation (link or ticket ID) on whether agent LLM egress can ever leave DronaHQ's key/credit path — closes Seam 1a definitively.

## Next step

Verify Seam 2 end-to-end (cheapest, no Enterprise needed): create REST connector → `POST https://<public-agentledger>/v1/logs` (or management-plane ingest) with `AgentLedger-Key: vk_test_xxx` header, attach as Connector Query tool to a test agent, run a prompt, and confirm the call lands in AgentLedger DB **and** appears in DronaHQ Traces. Record request/response + trace screenshot; if green, spec the MCP variant (Seam 4a) as the productized path and mark Seam 1a closed as NOT-SUPPORTED pending Enterprise BYOK verification.

## Sources (all fetched 200, 2026-09-20)

1. https://www.dronahq.com/agents/faq/
2. https://www.dronahq.com/agents/custom-agents/
3. https://www.dronahq.com/ai-agents-for-business/
4. https://docs.dronahq.com/agents/getting-started/introduction/
5. https://docs.dronahq.com/agents/getting-started/tools-overview/
6. https://docs.dronahq.com/agents/getting-started/credit-usage/
7. https://docs.dronahq.com/rest-apis/configuring-apis/
8. https://docs.dronahq.com/rest-apis/api-authentication/
9. https://docs.dronahq.com/mcp%20server/configuring-mcp-server/
10. https://docs.dronahq.com/mcp%20server/exposing-mcp-to-ai-agents/
11. https://docs.dronahq.com/agents/developer/api-keys/
