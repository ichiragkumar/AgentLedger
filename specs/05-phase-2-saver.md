# 05 — Phase 2: "The Saver" (Week 3-5)

> Prev: [04-phase-1-mirror](./04-phase-1-mirror.md) | Parent: [00-index](./00-index.md) | Next: [06-phase-3-router](./06-phase-3-router.md)

### *Pitch: "Stop paying for the same answer twice."*
### *Pitch line: "Same question, different words. One API call instead of five."*

## The Problem You're Solving
Semantic caching eliminates roughly 31% of redundant queries before any API call is made and can cut LLM calls by 30–60% in production.

Real-world example: naive MCP (all 200+ tool definitions per request) across eight servers. Code mode alone cut tokens per request by 55%. Adding semantic caching for FAQ cut inference calls by another 40%.

## What You Ship
Semantic caching + exact-match caching that eliminates redundant LLM calls.

```
✓ Exact-match cache        →  SHA-256 hash → Redis → <1ms lookup
✓ Semantic cache           →  embed prompt → Qdrant → similar = cached
✓ Dual-layer pipeline      →  exact first, semantic second, provider third
✓ Per-agent TTL config     →  different expiry per agent/model
✓ Cache bypass header      →  X-AgentLedger-No-Cache: true
✓ Streaming cache replay   →  cached responses replayed as SSE
✓ Cache analytics          →  hit rate %, $ saved, top cached queries
```

## User Story
> *As a team running customer support agents, I want repeated/similar questions to be served from cache so I stop paying for the same answer twice.*

## Tasks

| # | Task | Output | Time |
|---|------|--------|------|
| 2.1 | **Exact-match cache** — SHA-256 hash of (model + messages + temperature), store response in Redis with configurable TTL | Fast cache | 1.5 days |
| 2.2 | **Semantic cache** — embed incoming prompt via lightweight model (e.g. `all-MiniLM-L6-v2`), vector search in Qdrant, return cached response if similarity > threshold | Smart cache | 3 days |
| 2.3 | **Dual-layer pipeline** — check exact first (0ms overhead), then semantic (5-20ms), then forward to provider | Optimal path | 1 day |
| 2.4 | **Cache configuration** — per-model, per-agent TTL, similarity threshold (0.85-0.99), cache bypass header (`X-AgentLedger-No-Cache: true`) | Flexible control | 1 day |
| 2.5 | **Cache analytics on dashboard** — hit rate, miss rate, estimated savings ($), cache size, top cached queries | ROI visibility | 2 days |
| 2.6 | **Streaming cache replay** — cached responses replayed as SSE chunks (same format as live stream) | UX parity | 1 day |
| 2.7 | **Cache invalidation API** — `DELETE /v1/cache/{key}`, bulk purge by agent/team/model | Stale data control | 4hr |
| 2.8 | **Conversation-aware guard** — don't cache if messages contain unique user context (configurable heuristic) | Quality protection | 1 day |

## Acceptance Criteria
```
□ Exact cache: <1ms lookup, 100% precision
□ Semantic cache: <25ms lookup, >90% precision at 0.92 threshold
□ Cache hit rate >30% on 1000 diverse customer support queries
□ Dashboard shows "$X saved this week via caching"
□ Cached streaming responses byte-compatible with live responses
```
- [ ] Estimated savings matches actual saved API calls within 10%
- [ ] Cache bypass header works — always hits provider when set
- [ ] No stale responses after TTL expiry
- [ ] Semantic lookup 5-20ms, saves 1-5s by skipping LLM call. Hits typically 2-4x faster.
- [ ] Drill-down by agent

## Definition of Done
- [ ] Blog post: "How we saved $X with semantic caching — benchmarks included" / "We eliminated 35% of our LLM bill with semantic caching"
- [ ] Benchmark suite: 1000 queries, measured hit rate, latency overhead, cost savings
- [ ] Integration test with CrewAI multi-agent workflow showing cache hits across agents

## Pitch (add 2 slides)
4. **Cache Demo:** "Same question rephrased 5 ways → 1 API call instead of 5"
5. **ROI:** "30% of agent calls are near-duplicates. That's 30% of your bill, eliminated."

## Who You Tell
- Teams with customer support agents (repeat questions = repeat costs)
- Target Helicone users (maintenance mode post-Mintlify, 16K orgs) + Portkey users (acquired by Palo Alto Networks May 2026, uncertainty) — "Migrating to AgentLedger in 5 minutes"
- See [11-gtm-timeline](./11-gtm-timeline.md).

## Through Line
> Phase 2 → "I stopped paying for duplicate calls"
