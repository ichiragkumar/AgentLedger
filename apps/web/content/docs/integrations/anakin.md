# Anakin + AgentLedger

Point your Anakin agents at AgentLedger as their LLM endpoint — one
base-URL change — and every inference dollar flows through per-agent
budgets with runaway-loop kill.

## Positioning

Anakin agents pointed at AgentLedger as their LLM endpoint (one
base-URL change); all Anakin inference spend flows through per-agent
budgets with runaway-loop kill.

## Setup

1. In AgentLedger, issue one virtual key per Anakin agent (e.g.
   `anakin-research-agent`). One key per agent gives you per-agent
   attribution even if Anakin can't send custom headers.
2. In Anakin, open your agent's settings and change its LLM endpoint to
   your AgentLedger proxy base URL with the virtual key:
   ```bash
   Base URL = http://YOUR-AGENTLEDGER-HOST:8787/v1
   API key  = vk_YOUR_AGENT_KEY
   ```
3. If Anakin lets you set extra request headers, add `X-Agent-Id`,
   `X-Team-Id`, and `X-Project-Id` for team/project-level attribution.
4. Run the agent once, then confirm on the AgentLedger dashboard that
   spend is attributed to the right agent and model.
5. Put the agent's team on a budget: 75% alert, 90% downgrade, 100%
   stop — the runaway-loop kill is what makes this more than a meter.

## What gets metered

Token counts, per-model cost math, latency, and attribution for every
request — the same pipeline as every AgentLedger agent: request logging,
semantic caching, quality-gated routing, budget burn with threshold
states. See [Getting Started](/docs/getting-started).

## Honesty notes

- Steps 2–3 need **your Anakin account**: the exact agent-settings path
  for custom model endpoints and API-key fields lives in the Anakin UI
  and may vary by plan. Each step is marked NEEDS-ACCOUNT until verified
  against Anakin docs with a fetched URL.
- Any promo credit you received from Anakin (e.g. a coupon code) is
  yours to apply inside Anakin — it is unrelated to AgentLedger metering
  and we make no claim about it.
- What AgentLedger proves without your account: an agent-shaped
  OpenAI-compatible payload with a valid `vk_*` key is metered and
  budgeted end-to-end through the live proxy.
