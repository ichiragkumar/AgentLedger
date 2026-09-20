# 22 — Ecosystem Integrations (DronaHQ · Anakin · Nasiko)

> Prev: [21-live-demo-proof-plan](./21-live-demo-proof-plan.md) | Parent: [00-index](./00-index.md)

One pattern, three platforms: point the platform's agents at
AgentLedger's OpenAI-compatible proxy with a per-agent virtual key, and
every inference dollar is metered, cached, routed, and budgeted.

## Shared pattern (base URL + vk key)

All three integrations are the same seam (spec 04 proxy contract):

```bash
OPENAI_BASE_URL=http://YOUR-AGENTLEDGER-HOST:8787/v1   # local: http://localhost:8787/v1
API key = vk_<per-agent-virtual-key>                    # sent as AgentLedger-Key
```

Attribution via `X-Agent-Id`, `X-Team-Id`, `X-Project-Id` headers where
the platform allows custom headers; otherwise one key per agent and
attribute by key. Payload shape is plain OpenAI-compatible
`POST /v1/chat/completions` (`{model, messages}`) — proven by
`demo/runner.py` (`call()`), which sends exactly this shape with
`AgentLedger-Key` + attribution headers.

## Per-platform status

| Platform | Status | What it means |
|----------|--------|---------------|
| Nasiko | LIVE | OSS (Apache-2.0), bring-your-own-LLM, CrewAI templates honor `OPENAI_API_BASE` — one env var, no vendor account. Verified by code inspection of the Nasiko template. |
| DronaHQ | WIRED-NEEDS-ACCOUNT | Proxy side is live; the DronaHQ-side steps (custom LLM / BYOK endpoint per agent, exact settings path, plan availability) require the user's DronaHQ account to click through and confirm. |
| Anakin | WIRED-NEEDS-ACCOUNT | Proxy side is live; the Anakin-side steps (agent LLM endpoint + API-key fields, exact settings path) require the user's Anakin account to click through and confirm. |

LIVE here means: traffic shaped like that platform's agents would send
is metered, attributed, and budgeted end-to-end through the proxy today
(spec 21 live runs: 21/21 calls metered, cache HITs, budget burn,
purge-to-zero). WIRED-NEEDS-ACCOUNT means: only the proprietary-UI
click path remains unverified, never the metering pipeline.

## Seam evidence pointers

- Proxy contract: [04-phase-1-mirror](./04-phase-1-mirror.md) (OpenAI-compatible
  reverse proxy, `vk_*` virtual-key vault, `X-Agent-Id`/`X-Team-Id`/`X-Project-Id`
  attribution, Postgres request log).
- Live metering proof: [21-live-demo-proof-plan](./21-live-demo-proof-plan.md)
  (real proxy metering, per-agent spend, cache-hit savings, budget threshold
  states, purge-to-zero).
- Payload shape any OpenAI-compatible agent sends: `demo/runner.py` (`call()`).
- Key/budget provisioning pattern: `demo/seed.py` (issues `vk_demo_*` keys +
  team budgets via dashboard APIs).
- Web docs (user-facing setup guides): `apps/web/content/docs/integrations/`
  (`dronahq.md`, `anakin.md`, `nasiko.md`) — positioning, setup steps, what
  gets metered, honesty notes.
- Sibling-track evidence (parallel work, same pattern): `docs/integrations/`
  at repo root — `dronahq-seams.md` (per-seam verdicts with doc URLs + quoted
  evidence), `anakin.md` / `nasiko.md` (step-by-step with VERIFIED-BY-DOCS /
  NEEDS-ACCOUNT marks, Nasiko template file/line cites), `VERIFICATION.md`
  (live transcript: scoped `vk_int_*` keys, per-platform payloads, metered
  figures, purge proof).

## Eligibility one-liners (verbatim — keep exact)

- Nasiko: "Nasiko OSS agents (CrewAI template) run with OPENAI_API_BASE pointed at AgentLedger's OpenAI-compatible proxy, so every Nasiko agent call is metered per-agent with semantic caching and hard budgets enforced."
- DronaHQ: "DronaHQ AI agents configured with AgentLedger as a custom OpenAI-compatible endpoint; each agent gets a virtual key (vk_*) so DronaHQ spend is attributed per agent/team with budget guardrails."
- Anakin: "Anakin agents pointed at AgentLedger as their LLM endpoint (one base-URL change); all Anakin inference spend flows through per-agent budgets with runaway-loop kill."

## What only a real account can prove (NEEDS list)

- DronaHQ: custom-LLM/BYOK availability per plan + exact agent settings path
  for an arbitrary OpenAI-compatible base URL + key; Tool Builder HTTPS-step
  auth options; MCP support verdict. (Owner: dronahq-seams research.)
- Anakin: agent LLM endpoint / API-key settings path; header customization
  availability. (Owner: anakin guide.)
- Neither platform's credentials ever touch this repo (mirror owns `.env`;
  no new deps; no Go/dashboard/landing changes in this spec).

## In-App Completion (2026-09-20)
`POST /api/integrations/:id/verify` completes the loop inside the app: fresh
scoped key → platform-shaped call through the live proxy → metered row read
back → key ONCE + proof (model/tokens/cost/latency). Verified live for all
three (dronahq 38/103 $0.000045, anakin 29/83 $0.000036, nasiko 29/47
$0.000022; router served Flash throughout). Registry GET carries live
`{keys, calls, spend}` per card; Nasiko is beta with real setup steps.
Test artifacts purged (one user-created `anakin-prod` key intentionally kept).

## Next step

Ship the three web docs (done this pass), land sibling seam evidence in
`docs/integrations/`, then record one real-account click-through per
WIRED-NEEDS-ACCOUNT platform and flip its status to LIVE with dated proof.
