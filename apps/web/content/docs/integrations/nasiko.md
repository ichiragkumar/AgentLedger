# Nasiko + AgentLedger

Run Nasiko's open-source agents with one env var pointed at AgentLedger:
every agent call metered per-agent, with semantic caching and hard
budgets enforced.

## Positioning

Nasiko OSS agents (CrewAI template) run with `OPENAI_API_BASE` pointed
at AgentLedger's OpenAI-compatible proxy, so every Nasiko agent call is
metered per-agent with semantic caching and hard budgets enforced.

## Setup

Nasiko is Apache-2.0 and brings your own LLM, so there is no vendor UI
in the way — it is one environment variable:

1. Start the AgentLedger stack (`docker compose up`) and issue one
   virtual key per Nasiko agent (e.g. `nasiko-crew-researcher`).
2. In your Nasiko checkout (Docker Compose deployment), set the crew's
   LLM endpoint to the proxy:
   ```bash
   export OPENAI_API_BASE=http://YOUR-AGENTLEDGER-HOST:8787/v1
   export OPENAI_API_KEY=vk_YOUR_AGENT_KEY
   ```
   The CrewAI template reads the OpenAI-compatible base URL from the
   environment, so no template edits are needed.
3. Pass attribution headers per agent (`X-Agent-Id`, `X-Team-Id`,
   `X-Project-Id`) or use one key per agent and attribute by key.
4. Run a crew, then check the AgentLedger dashboard: per-agent spend,
   cache hits on near-duplicate calls, and budget burn.
5. Enforce a hard budget on the Nasiko team so long-running crews stop
   at 100% instead of billing blind.

## What gets metered

Everything the proxy always meters — tokens in/out, per-model cost,
latency, attribution — plus the Phase 2/3/4 wins that matter most for
chatty multi-agent crews: semantic-cache deduplication of repeated tool
calls, quality-gated routing to cheaper models, and threshold budgets
with kill. See [Getting Started](/docs/getting-started).

## Honesty notes

- No Nasiko account or paywall is involved: the seam is verified by code
  inspection (the CrewAI template honors `OPENAI_API_BASE`), not by a
  proprietary UI. The exact template files/lines are cited in the
  ecosystem verification notes.
- We do not run the full Nasiko stack for you — you run `docker compose`
  on your own machine with your own checkout.
- CrewAI-shaped payloads are payload-identical through the
  OpenAI-compatible endpoint, so metering proven by the live-demo runs
  applies to Nasiko traffic unchanged.
