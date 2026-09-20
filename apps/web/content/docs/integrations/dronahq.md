# DronaHQ + AgentLedger

DronaHQ agents call AgentLedger as a Tool-Builder REST connector with a scoped virtual key, and the DronaHQ Vibe MCP tool calls run live inside the app — every DronaHQ-triggered inference metered, attributed, and budget-capped end-to-end.

## Positioning

DronaHQ exposes no documented arbitrary-LLM-endpoint seam: agents run on
the built-in DronaHQ key, and bring-your-own-key is Enterprise-gated — so
AgentLedger does not intercept DronaHQ's model traffic. The integration is
tool-level instead: a Tool Builder REST connector (or a Code-tool `fetch`)
calls AgentLedger with a scoped virtual key, and every call is metered,
attributed, and budget-capped. That loop completes inside the app today.

## The working loop (live in-app)

The dashboard Verify-live action proves our side end-to-end without
leaving AgentLedger:

1. **Verify-live** — `POST /api/integrations/dronahq/verify` fires one
   DronaHQ-shaped call through the live proxy.
2. **Fresh scoped key** — the route issues a scoped virtual key
   (`dronahq-verify-*`, agent scope `dronahq`, team `ecosystem`) and
   returns the full key material ONCE (shown once — copy now, paste it
   into the platform, then revoke it in Keys).
3. **Tool-Builder-shaped call** — the route POSTs a Tool Builder JSON
   task envelope (`summarize_ticket` for ticket `T-1042`) to
   `/v1/chat/completions` with `AgentLedger-Key` plus `X-Agent-Id:
   dronahq` / `X-Team-Id: ecosystem` / `X-Project-Id:
   integrations-verify` attribution headers.
4. **Metered proof** — the route reads back the fresh `request_logs`
   row and returns model, tokens in/out, cost USD, and latency next to
   the key.

Proven live 2026-09-20 (verification transcript at
`docs/integrations/VERIFICATION.md`): DronaHQ-shaped call → `200`,
19 tokens in / 70 out, `$0.0000299`, per-agent spend plus team-budget
movement, then full purge (keys, rows, budget — zero residue).

## Setup (your DronaHQ account)

1. In AgentLedger, run Verify-live once and copy the shown-once key.
2. In DronaHQ, create the connector: `Connectors → + Connector → REST
   API → Method POST → URL
   http(s)://YOUR-AGENTLEDGER-HOST:8787/v1/chat/completions`, header
   `AgentLedger-Key: vk_YOUR_KEY` plus `X-Agent-Id` / `X-Team-Id` /
   `X-Project-Id` headers, JSON body with `{model, messages}`. Pasting
   the cURL auto-fills the connector fields.
3. Attach it to the agent: `Agents → <agent> → + Add Tools → Connector
   Library / Connector Query → select the AgentLedger query → Add
   Tools`.
4. Run the agent once, then confirm on the AgentLedger dashboard that
   spend is attributed to the right agent and model.
5. Put the agent's team on a budget (alert at 75%, guardrail at 90%,
   stop at 100%) so a runaway DronaHQ loop can never blow the month.

## What runs where

- **DronaHQ side (your account):** the agent, the Tool Builder REST
  connector from Setup, and any MCP tool wiring. DronaHQ-side audit
  source: each run stays traceable in DronaHQ Traces (90-day retention)
  to reconcile against AgentLedger logs.
- **AgentLedger side (this stack):** virtual-key issuance, the
  OpenAI-compatible proxy (metering, router, budgets), Postgres
  `request_logs`, and the dashboard spend views.
- **Vibe MCP console (dashboard card):** the `DronaHQ live console`
  picks a read-only tool, edits JSON args, and runs it live — MCP
  result next to metered LLM cost. Status 2026-09-20: console UI and the
  server-side `.../dronahq/tools|run|invoke` routes are BOTH live and
  verified end-to-end (read-only allowlist gate proven with 403s on write
  tools). The Vibe MCP probe itself is verified live (initialize 200,
  57 tools listed).

## What gets metered

Every call through the proxy: model served (the router may downgrade
to the cheapest tier live — cost math follows the served model),
prompt / completion tokens, computed cost, latency, and attribution
tags — logged to Postgres and visible on the dashboard. See
[Getting Started](/docs/getting-started).

## Honesty notes

- Steps 2–3 need **your DronaHQ account**: the exact connector/agent
  click path lives in the DronaHQ UI, and custom LLM endpoints / BYOK
  availability depends on your DronaHQ plan. Per-seam verdicts (custom
  LLM: not supported; Tool Builder HTTPS step: works; JS/Python
  endpoint override: not supported; MCP-consume: works, tool-level
  only) with doc-URL evidence are tracked in the ecosystem
  verification notes.
- Routing DronaHQ's **own LLM traffic** through the proxy is an
  Enterprise-BYOK question: BYOK is plan-gated and it is unverified
  whether the BYOK screen accepts an arbitrary OpenAI-compatible base
  URL. Do not claim a proxy seam for DronaHQ model calls until that is
  verified in-account.
- The DronaHQ MCP token is **server-side only** (`DRONAHQ_MCP_URL` /
  `DRONAHQ_MCP_TOKEN` env, never in repo files, never sent to the
  client). Rotate the token after sharing it, and revoke Verify-live
  keys after pasting them into the platform.
- Your real provider keys never leave the AgentLedger server — DronaHQ
  only ever sees the virtual key.
- What AgentLedger proves without your account: any DronaHQ-shaped
  payload sent to the proxy with a valid `vk_*` key is metered,
  attributed, and budgeted end-to-end (live transcript linked above).
