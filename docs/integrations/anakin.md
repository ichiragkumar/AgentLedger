# Anakin × AgentLedger

Point Anakin's agents at AgentLedger's OpenAI-compatible proxy so every
token is metered, cached, routed, and budget-enforced. One endpoint swap —
nothing else in your agent logic changes.

> **Scope note (read first):** this guide covers **anakin.ai** (no-code AI app
> builder: Quick Apps, Chatbots, Workflows, Auto Agents). It does **not**
> cover **anakin.io** (Anakin-Inc's web-scraping/search developer API,
> `@anakin-io/sdk`, `ak-…` keys) — that is a different product with no agent
> LLM endpoint to rewire. The work order's "anakin.io" reference is treated
> here as **anakin.ai**; the promo-credit note below is user-supplied context,
> not a verified claim.

## How it maps

| Anakin concept | AgentLedger equivalent |
|---|---|
| Model call inside a Workflow / Auto Agent / custom-code node | `POST {LEDGER_BASE_URL}/v1/chat/completions` (OpenAI shape, see `demo/runner.py`) |
| Anakin API access token (`Authorization: Bearer …`, `X-Anakin-Api-Version` header) | AgentLedger virtual key (`AgentLedger-Key: vk_anakin_*` header) — provisioned per the `demo/seed.py` pattern (`POST /api/keys`) |
| App / agent identity in Anakin | Attribution headers: `X-Agent-Id`, `X-Team-Id`, `X-Project-Id` (optional chaining: `X-Request-Chain-Id`, `X-Parent-Agent-Id`) |
| Usage/credits screen in Anakin | AgentLedger dashboard (cost by agent/team, cache hit rate, budget burndown) |

## Prerequisites

- AgentLedger proxy reachable from wherever your Anakin workflow executes
  (self-host default `http://localhost:8787`; production: your public
  `https://<ledger-host>/v1`). Anakin's cloud executes server-side, so
  `localhost` will **not** work for cloud runs — the base URL must be
  publicly reachable.
- One virtual key scoped to Anakin, e.g. `vk_anakin_main`
  (provision via `POST /api/keys` with `agentScope`/`teamScope`, same pattern
  as `demo/seed.py`).

## Step-by-step

### 1. Log in to Anakin — NEEDS-ACCOUNT
Go to `https://anakin.ai` and sign in (Google / email). The marketing site
renders a desktop-only notice on small screens, so use a desktop browser.
**[NEEDS-ACCOUNT — login flow not verifiable without credentials.]**

### 2. Open your agent (Workflow / Auto Agent / custom app) — NEEDS-ACCOUNT
Anakin.ai ships Quick Apps, Chatbots, Workflows (drag-and-drop nodes, chains,
agents), Batch Processes, and Auto Agents — **VERIFIED-BY-DOCS**
(homepage fetch 2026-09-20: "edit prompt parameters, create chains and
agents"; "Auto Agent builder lets you create custom AI assistants").
Open the agent whose LLM spend you want metered.
**[NEEDS-ACCOUNT — exact navigation labels inside the builder are not in the
public docs.]**

### 3. Find the LLM / model / HTTP step that performs the model call — NEEDS-ACCOUNT
Anakin supports OpenAI, Claude, DeepSeek, Gemini, Mistral, Llama models
natively — **VERIFIED-BY-DOCS** (homepage model list), and "advanced users
can call various AI models, external APIs, write custom code to build very
powerful AI applications" — **VERIFIED-BY-DOCS** (homepage). The
AgentLedger-compatible seam is therefore the step that issues an
**OpenAI-compatible HTTPS call**: a custom-code node, an external-API /
HTTP-request node, or a bring-your-own-model field if your plan exposes one.
There is **no public-docs evidence** of a first-class "custom base URL" field
in Anakin's model picker (public API docs at `apidocs.anakin.ai` cover
*calling Anakin apps outbound* — `POST /v1/quickapps/{appId}/runs`,
`POST /v1/chatbots/{appId}/messages` with `Authorization: Bearer` +
`X-Anakin-Api-Version` — not pointing Anakin at an external LLM).
**[NEEDS-ACCOUNT — confirm which node type in your workspace accepts an
arbitrary HTTPS endpoint + headers.]**

### 4. Set the base URL to AgentLedger — NEEDS-ACCOUNT
In that node, replace the provider endpoint with your AgentLedger base URL:

- Cloud Anakin → `https://<your-ledger-host>/v1`
- Self-hosted runner on the same machine → `http://localhost:8787/v1`

Keep the request body OpenAI-shaped (`model`, `messages`, `stream`), exactly
the payload shape in `demo/runner.py`. Keep `stream: true` support if the
node streams — the proxy passes SSE through.
**[NEEDS-ACCOUNT — field names vary by node type; the *values* above are the
contract.]**

### 5. Set the key to your `vk_anakin_*` key — NEEDS-ACCOUNT
Anakin authenticates its own API with `Authorization: Bearer <token>`
(**VERIFIED-BY-DOCS**, `apidocs.anakin.ai`). AgentLedger instead expects:

```http
AgentLedger-Key: vk_anakin_main
X-Agent-Id: anakin-main
X-Team-Id: growth
X-Project-Id: anakin-demo
```

Set these as headers on the node (custom headers / auth-headers field).
Never paste a real upstream provider key into Anakin — the virtual key
resolves server-side via the Key Vault.
**[NEEDS-ACCOUNT — header configuration UI is account-specific.]**

### 6. Run a test prompt and verify on the AgentLedger dashboard
Send one test message through the Anakin agent, then check the AgentLedger
dashboard: the request appears under agent `anakin-main` with token counts
and cost. Compare the dashboard request count against your run (same
cross-check pattern as `demo/runner.py`'s run-id digest). If nothing appears,
the base URL is likely unreachable from Anakin's cloud (see Prerequisites) or
the headers were dropped by the node — re-check steps 4–5.
**(Verifiable end-to-end once steps 1–5 are done — no account needed on the
AgentLedger side beyond a running proxy.)**

## Promo-credit note (user-supplied context — NOT a verified claim)

> The user supplied the code `ANAKIN600` as promo-credit context. This repo
> makes no claim about its validity, value, expiry, or applicability. If you
> use it, apply it in Anakin's own billing/credits screen and confirm the
> balance there before running metered traffic.

## References (fetched 2026-09-20)

- `https://anakin.ai/` — platform surface: Quick Apps, Chatbots, Workflows,
  Auto Agents, multi-model support, external-API/custom-code extensibility.
- `https://apidocs.anakin.ai/api-6919075` — `POST /v1/quickapps/{appId}/runs`
  (outbound app-call API; Bearer + `X-Anakin-Api-Version` auth).
- `https://apidocs.anakin.ai/api-6924681` — `POST /v1/chatbots/{appId}/messages`
  (outbound chatbot API, SSE streaming).
- `https://github.laiyagushi.com/Anakin-Inc/anakin-node` — **different product**
  (anakin.io scraping SDK); cited only for the disambiguation above.
- `https://anakin.ai/docs/` — exists but renders client-side; content not
  retrievable without JS (reason steps above are NEEDS-ACCOUNT, not docs-cited).
