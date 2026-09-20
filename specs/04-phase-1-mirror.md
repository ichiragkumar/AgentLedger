# 04 — Phase 1: "The Mirror" (Week 1-2)

> Prev: [03-phase-0-foundation](./03-phase-0-foundation.md) | Parent: [00-index](./00-index.md) | Next: [05-phase-2-saver](./05-phase-2-saver.md)

### *Pitch: "Point your agents at us. See where every dollar goes."*
### *Pitch line: "One env var. Full visibility. Free."*

## North Star Link
> As agents move from prototypes to production, token cost is a primary engineering constraint. Agents make 3–10x more calls than chatbots. AgentLedger is what you install the day this becomes your problem. Phase 1 is that install.

## The Problem You're Solving
Model API spending doubled from $3.5 billion to $8.4 billion between late 2024 and mid-2025. Without dedicated cost tracking, teams discover overruns only when the monthly bill arrives.

## What You Ship
OpenAI-compatible reverse proxy that logs every request with token counts, costs, and attribution tags.

```
✓ OpenAI-compatible proxy  →  one env var, zero code changes
✓ Token counter            →  exact counts per request
✓ Cost calculator          →  live price registry, all providers
✓ Attribution tags         →  X-Agent-Id, X-Team-Id, X-Project-Id headers
✓ Virtual key vault        →  agents never see real API keys
✓ Request logger           →  Postgres: timestamp, model, tokens, cost, latency
✓ Streaming support        →  SSE handled, tokens counted on completion
✓ Dashboard v0.1           →  spend by agent / model / team / day
✓ Health + Prometheus       →  ops-ready from day one
```

## User Story
> *As a developer running 5+ AI agents, I want to change one environment variable and instantly see per-agent, per-model, per-team cost breakdowns so I can identify which agents are burning money.*

## Tasks

| # | Task | Output | Time |
|---|------|--------|------|
| 1.1 | **HTTP reverse proxy** — accept OpenAI-format requests at `/v1/chat/completions`, forward to upstream provider, return response | Working proxy | 2 days |
| 1.2 | **Multi-provider support** — route to OpenAI, Anthropic, Google, DeepSeek based on `model` field | Provider mapping | 2 days |
| 1.3 | **Token counter** — extract `usage.prompt_tokens`, `usage.completion_tokens`, compute cost via price table | Accurate counting | 1 day |
| 1.4 | **Price registry** — JSON file with per-model pricing, auto-updateable → live price feed foundation | Current prices | 4hr |
| 1.5 | **Request logger** — write metadata to Postgres (timestamp, model, tokens_in, tokens_out, cost, latency, tags) | Audit trail | 1 day |
| 1.6 | **Attribution tags** — read `X-Agent-Id`, `X-Team-Id`, `X-Project-Id` headers | Cost attribution | 4hr |
| 1.7 | **Virtual keys** — agents send `AgentLedger-Key: vk_xxx`, proxy resolves to real key server-side | Key security | 1 day |
| 1.8 | **Streaming support** — handle `stream: true` SSE, count tokens on stream completion | Full compatibility | 1.5 days |
| 1.9 | **Dashboard v0.1 (Next.js 15 + shadcn)** — total spend (24h/7d/30d), spend by model/agent/team, top 10 costliest requests | Visual | 3 days |
| 1.10 | **Health + metrics** — `/health`, `/metrics` (Prometheus-compatible) | Ops-ready | 4hr |

## Acceptance Criteria
```
□ Change OPENAI_BASE_URL → works identically to direct API call
□ Token counts match provider within 1%
□ Cost matches invoice within 5%
□ Streaming adds <15ms latency p99
□ Dashboard live within 5 seconds of request
□ Virtual keys work — real key never in logs
□ docker compose up → full stack in <60 seconds
```
- [ ] 3 providers work out of the box: OpenAI, Anthropic, Google
- [ ] Attribution tags flow through and appear on dashboard
- [ ] Handles 500 concurrent requests without dropping connections
- [ ] Dashboard loads in <2s

## Definition of Done
- [ ] README has quickstart: 3 commands to go from zero to seeing first cost dashboard
- [ ] At least one real agent framework tested (CrewAI or LangGraph) end-to-end
- [ ] All tests pass, >80% coverage on proxy core

## Pitch Deck (3 slides)
1. **Problem:** "You're spending $X/month on LLM APIs. You don't know which agent costs what."
2. **Demo:** Live dashboard showing per-agent cost breakdown
3. **CTA:** "One env var. Full visibility. Free and open source."

## Who You Tell
- Devs spending $500+/month on LLM APIs
- r/LocalLLaMA, HackerNews, AI Twitter
- "Show HN: I built an open-source LLM cost dashboard"
- Discord: CrewAI, LangChain, AutoGen; Indie hackers $200-2000/mo

## Through Line
> Phase 1 → "I can finally see where my AI money goes"

## Metrics Target
500 GitHub stars, 100+ Docker pulls, 50+ weekly active proxy users. See [13-metrics-risks-next-actions](./13-metrics-risks-next-actions.md).
