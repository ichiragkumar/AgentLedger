# 04 — Phase 1: "The Mirror" (Week 1-2)

> Prev: [03-phase-0-foundation](./03-phase-0-foundation.md) | Parent: [00-index](./00-index.md) | Next: [05-phase-2-saver](./05-phase-2-saver.md)

### *Pitch: "Point your agents at us. See where every dollar goes."*

## What You Ship
OpenAI-compatible reverse proxy that logs every request with token counts, costs, and attribution tags.

## User Story
> *As a developer running 5+ AI agents, I want to change one environment variable and instantly see per-agent, per-model, per-team cost breakdowns so I can identify which agents are burning money.*

## Tasks

| # | Task | Output | Time |
|---|------|--------|------|
| 1.1 | **HTTP reverse proxy** — accept OpenAI-format requests at `/v1/chat/completions`, forward to upstream provider, return response | Working proxy | 2 days |
| 1.2 | **Multi-provider support** — route to OpenAI, Anthropic, Google, DeepSeek based on `model` field | Provider mapping | 2 days |
| 1.3 | **Token counter** — extract `usage.prompt_tokens`, `usage.completion_tokens`, compute cost via price table | Accurate counting | 1 day |
| 1.4 | **Price registry** — JSON file with per-model pricing, auto-updateable | Current prices | 4hr |
| 1.5 | **Request logger** — write metadata to Postgres (timestamp, model, tokens_in, tokens_out, cost, latency, tags) | Audit trail | 1 day |
| 1.6 | **Attribution tags** — read `X-Agent-Id`, `X-Team-Id`, `X-Project-Id` headers | Cost attribution | 4hr |
| 1.7 | **Virtual keys** — agents send `AgentLedger-Key: vk_xxx`, proxy resolves to real key server-side | Key security | 1 day |
| 1.8 | **Streaming support** — handle `stream: true` SSE, count tokens on stream completion | Full compatibility | 1.5 days |
| 1.9 | **Dashboard v0.1** — total spend (24h/7d/30d), spend by model/agent/team, top 10 costliest requests | Visual | 3 days |
| 1.10 | **Health + metrics** — `/health`, `/metrics` (Prometheus-compatible) | Ops-ready | 4hr |

## Acceptance Criteria
- [ ] Agent sets `OPENAI_BASE_URL=http://agentledger:8787/v1` and works identically to direct API call
- [ ] Token counts match provider `usage` field within 1% accuracy
- [ ] Cost calculation matches actual provider invoice within 5% margin
- [ ] Streaming responses arrive with <15ms added latency (p99)
- [ ] Dashboard loads in <2s and shows real-time data within 5s delay
- [ ] Virtual keys work — agent never sees or logs real API keys
- [ ] 3 providers work out of the box: OpenAI, Anthropic, Google
- [ ] Attribution tags flow through and appear on dashboard
- [ ] Handles 500 concurrent requests without dropping connections
- [ ] Docker Compose brings up full stack (proxy + db + dashboard) in one command

## Definition of Done
- [ ] README has quickstart: 3 commands to go from zero to seeing first cost dashboard
- [ ] At least one real agent framework tested (CrewAI or LangGraph) end-to-end
- [ ] All tests pass, >80% coverage on proxy core

## Pitch Deck (3 slides)
1. **Problem:** "You're spending $X/month on LLM APIs. You don't know which agent costs what."
2. **Demo:** Live dashboard showing per-agent cost breakdown
3. **CTA:** "One env var. Full visibility. Free and open source."

## GTM / Who to Show
- **r/LocalLLaMA, HackerNews, AI Twitter** — "I built an open-source LLM cost dashboard"
- **Discord servers** — CrewAI, LangChain, AutoGen communities
- **Indie hackers** spending $200-2000/month

## Metrics Target
500 GitHub stars, 100+ Docker pulls, 50+ weekly active proxy users. See [13-metrics-risks-next-actions](./13-metrics-risks-next-actions.md).
