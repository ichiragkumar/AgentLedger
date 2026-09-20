# 21 — Live Demo Proof Plan: Kitchen-Sink Workspace (local-first)

> Prev: [20-frontend-build-status](./20-frontend-build-status.md) | Parent: [00-index](./00-index.md)

Local-first proof: 5 real agents, 3 teams, real metering. Cloud always-on demo
is explicitly deferred with production setup (spec 20). What runs HERE is
`demo/` against the local stack — every dollar on the dashboard comes from
real proxy metering, not mocks.

## The Demo Workspace
Acme Inc (fictional): Support (`support-bot`, `ticket-classifier`), Content
(`summarizer`), Engineering (`code-reviewer`, `research-agent` 3-step with
chain headers). Before = direct-to-provider (unmetered, billed blind);
after = one env var per agent (`OPENAI_BASE_URL=http://localhost:8787/v1` +
`vk_demo_*` key) → full visibility, caching, routing, budgets.

## Honesty Contract (what is real vs mock locally)
- REAL: token counting, cost math (live price registry, real model names),
  attribution (agent/team/project/chain), request logging, budget burn +
  threshold states, key issuance/revoke/rotate, dashboard views, SSE event
  stream. No provider API keys required.
- MOCK (labeled, one place): the LLM *text* — `demo/mock_upstream.py`
  returns deterministic completions with realistic `usage` (tokens ≈
  len/4, scaled per model). The proxy meters it exactly like a real
  provider response. Swap `*_BASE_URL` to real providers when keys exist —
  zero demo code changes.
- PENDING chain patches: cache-HIT and route-decide proof moments activate
  when the 3 queued `WIRING.md` patches land (spec 20 §1). Fixtures already
  contain ~40% near-duplicates so hits fire on day one. Until then the demo
  proves Observe + Budgets + Keys + Topology-fallback live.

## Layout (`demo/`, session-local, never shipped to prod)
```
demo/
  mock_upstream.py      # deterministic completions + realistic usage
  runner.py             # cycles 5 agents on a timer (stdlib only)
  seed.py               # issues vk_demo_* keys + team budgets via dashboard APIs
  fixtures/*.json       # faqs, tickets, articles, code, research
  README.md             # run order
```

## Proof Moments (local)
1. **Attribution:** 5 agents × headers → spend by agent/team/model tables move.
2. **Budget burn:** tiny team budgets → utilization climbs → 75/90/100 states
   + derived alerts + Go mirror in sync.
3. **Keys:** issue → use on data plane → rotate (grace) → revoke → 401.
4. **Topology fallback:** research-agent chain headers rebuild the graph from
   `request_logs` today (Brain weights later).
5. **Cache/routing:** fixtures are duplicate-rich; moments go live with chain
   patches (no fixture changes needed).

## Claim → Proof Table
"One env var" → runner diff vs direct SDK. "Full visibility" → live
dashboard, 5 agents, real metered rows. "Budgets enforce themselves" →
threshold states + 429 path proven (spec 20 §3). "Works with any framework" →
raw-SDK-shaped payloads for all 5 agents (LangChain/CrewAI parity is
payload-identical through the OpenAI-compatible endpoint).

## First Live Run (2026-09-20, local)
- 3 cycles, **21/21 calls ok** (7/cycle: 4 single + 3 chained research steps).
- Dashboard `/api/spend`: all 8 agent steps metered with real model prices
  (e.g. researcher/claude-3-5-sonnet $0.0018, support-bot/gemini-2.0-flash
  $0.00004); issued keys resolved on the data plane (401s seen were upstream
  OpenAI rejecting the mock hop — i.e. the vk itself was accepted).
- Budgets burned for real (engineering 0.1% after 3 cycles); topology
  fallback rebuilt `demo-chain-*` (3 steps each) from `request_logs`.
- Purged after: 5 keys, 3 budgets, 21 log rows; proxy restarted without mock
  env (normal dev). Fixtures + runner kept; rerun anytime via demo/README.md.

## Second Live Run (2026-09-20, full live pipeline)
- Chain patches applied: identical 2nd cycle → **7/7 exact HITs, 50% hit
  rate, $0.0044 saved**, surfaced on the dashboard as `source:live`.
- `/demo` renders 5 before/after cards (BEFORE modeled, AFTER metered).
- Purged after (10 keys incl. leftovers, 3 budgets, 7 log rows); proxy
  restored to normal dev (no mock env).
