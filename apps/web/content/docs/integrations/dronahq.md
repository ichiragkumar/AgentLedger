# DronaHQ + AgentLedger

Route your DronaHQ AI agents' LLM spend through AgentLedger: one custom
endpoint, per-agent virtual keys, full metering with budget guardrails.

## Positioning

DronaHQ AI agents configured with AgentLedger as a custom
OpenAI-compatible endpoint; each agent gets a virtual key (`vk_*`) so
DronaHQ spend is attributed per agent/team with budget guardrails.

## Setup

1. In AgentLedger, issue one virtual key per DronaHQ agent (name it after
   the agent, e.g. `dronahq-support-agent`). Keep the key material
   server-side — agents only ever carry the `vk_*` value.
2. In DronaHQ, open your agent's LLM / model configuration and set the
   provider endpoint to your AgentLedger proxy base URL with the virtual
   key as the API key:
   ```bash
   Base URL = http://YOUR-AGENTLEDGER-HOST:8787/v1
   API key  = vk_YOUR_AGENT_KEY
   ```
3. Tag the agent so spend attributes correctly (`X-Agent-Id`,
   `X-Team-Id`, `X-Project-Id` headers where your DronaHQ tier lets you
   set custom headers; otherwise use one key per agent and attribute by
   key).
4. Send a test prompt from the DronaHQ agent, then check the AgentLedger
   dashboard — spend by agent/team/model should move within seconds.
5. Set a team budget (alert at 75%, guardrail at 90%, stop at 100%) so a
   runaway DronaHQ loop can never blow the month.

## What gets metered

Every `/v1/chat/completions` call through the proxy: model, prompt /
completion tokens, computed cost (live price registry), latency, and
attribution tags — logged to Postgres and visible on the dashboard.
Semantic-cache hits and routed-to-cheaper-model savings show up the same
as any other agent. See [Getting Started](/docs/getting-started).

## Honesty notes

- Steps 2–3 need **your DronaHQ account**: custom LLM endpoints / BYOK
  availability depends on your DronaHQ plan, and the exact settings path
  lives in the DronaHQ UI. Per-seam verdicts (custom LLM, Tool Builder
  HTTPS step, JS/Python endpoint override, MCP) with doc-URL evidence are
  tracked in the ecosystem verification notes.
- What AgentLedger proves without your account: any OpenAI-compatible
  payload sent to the proxy with a valid `vk_*` key is metered,
  attributed, and budgeted end-to-end (see the live-demo proof plan in
  the repo specs).
- Your real provider keys never leave the AgentLedger server — DronaHQ
  only ever sees the virtual key.
