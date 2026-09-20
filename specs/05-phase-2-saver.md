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

## Implementation Status

> Built by ledger-saver (stdlib-only Go + props-only TSX). Mirror owns
> proxy wiring; this package is NOT yet live in the chain — see WIRING.md.

### Design (dual-layer pipeline: exact → semantic → provider)

| Piece | File | Notes |
|---|---|---|
| `Cache` interface (`Check`/`Store`), `Key = SHA-256(model+messages+temperature)`, `Entry` (verbatim wire bytes), `Stats` (hit %, $ saved) | `internal/cache/cache.go` | 100% precision by construction: equal keys ⇒ byte-identical inputs |
| In-memory TTL store (Redis-semantics stand-in) | `internal/cache/memory.go` | Lazy expiry on every `Check` → no stale after TTL; purge by agent/team/model |
| `Embedder` iface + in-memory cosine index + Qdrant HTTP stubs (search/upsert payloads, `SearchRemote`) | `internal/cache/semantic.go` | Threshold clamped to [0.85, 0.99], default 0.92; `HashEmbedder` is DEV-ONLY (never benchmark with it) |
| Per-model/per-agent TTL (`agent > model > default`), `FromEnv()`, `Validate()` | `internal/cache/config.go` | Bypass header `X-AgentLedger-No-Cache` honored fail-open |
| `DeleteKey` + `Purge{,ByAgent,ByTeam,ByModel,All}` across BOTH layers | `internal/cache/invalidate.go` | Semantic vectors keyed by exact key — a delete can never resurrect |
| Unique-context skip heuristic | `internal/cache/guard.go` | Skips on UUID/email/secret/6+-digit/account markers; first-person FAQ phrasing alone ("how do I reset my password") stays cacheable |
| `Hook.Middleware` + `CacheHook(next)` (matches `proxy.Middleware` shape), write-through capture, verbatim SSE replay | `internal/cache/hook.go` | Miss path is transparent (status/headers/bytes untouched); store failures never fail requests |
| Dashboard panel (hit %, $ saved, size, top queries — props only) | `dashboard/components/cache-panel.tsx` | No fetcher, no other dashboard files touched |
| Mirror's 5-line patch (`CacheStub` → `hook.Middleware`) | `internal/cache/WIRING.md` | Chain order preserved; headers additive-only |

Tests: `go vet ./internal/cache/... && go test ./internal/cache/...` green,
package coverage **>80%** (7 `_test.go` files, one per module).

### Hit-rate benchmark method (1000-query plan, acceptance: >30%)

1. **Corpus**: 1000 diverse customer-support queries — 60% near-duplicates
   (each base question rephrased 3–5 ways, e.g. "reset password" × 5 forms),
   30% exact repeats (retry storms, multi-agent re-asks), 10% unique
   (guard-bait: order ids, emails, account numbers → must MISS + never store).
2. **Harness** (to build): replay corpus through the proxy with the pricing
   adapter on, MiniLM sidecar + Qdrant live, threshold 0.92; record per-query
   layer (exact/semantic/miss), similarity, lookup ms, provider ms.
3. **Bar**: hit rate >30%, exact precision 100% (key equality audit),
   semantic precision >90% (human-grade 200-sample of semantic hits),
   exact lookup <1ms p99, semantic 5–20ms, hits 2–4x faster end-to-end
   (5–20ms lookup vs 1–5s LLM call), savings within 10% of actual
   (Σ avoided provider cost from Postgres log vs `Stats.SavedUSD`).
4. **Cross-agent test** (CrewAI): researcher + support agents share one
   team id and ask overlapping questions → assert cross-agent semantic hits
   (`agent_id` differs, `team_id` equal, layer=semantic).

### Deps needed (NOT added — `go.mod` untouched per scope)

- `github.com/redis/go-redis/v9` — production exact store (`cache.Cache` impl).
- Qdrant client — EITHER `github.com/qdrant/go-client` OR keep stdlib
  `net/http` stubs in `semantic.go` (they already speak REST; decision: try
  stdlib first, add client only if filtering/payload needs outgrow it).
- Embedding runtime — `all-MiniLM-L6-v2` sidecar (384-dim) behind
  `cache.Embedder`; e.g. Python `sentence-transformers` microservice or ONNX
  `fastembed` container. `EMBED_MODEL` env selects it.

### Ship-track: dashboard end-to-end (2026-09-20, cache track builder)

Go: no gaps — `gofmt -l` clean, `go vet` green, `go test` green at
**93.3%** coverage. No `internal/cache/*` changes; proxy still on
`CacheStub` (Mirror's 5-line patch pending), so live saver stats await
chain wiring.

Dashboard (all live, zero-state safe via `queryOrNull`/fail-open proxy client):

| Piece | File | Notes |
|---|---|---|
| `GET /api/cache/stats` | `apps/dashboard/app/api/cache/stats/route.ts` | Tries `GET /v1/cache/stats` (1.5s); falls back to PG 7d context + zeroed cache fields (`source:"stub"`, `connected:false`) — never fabricated |
| `GET/PUT /api/cache/config` | `apps/dashboard/app/api/cache/config/route.ts` | Validates threshold [0.80,0.99], ttlSeconds int [60,2592000]; upserts self-created `cache_config` row; mirrors `PUT /v1/cache/config` best-effort (`proxySynced`) |
| `POST /api/cache/flush` | `apps/dashboard/app/api/cache/flush/route.ts` | Validates scope all\|agent\|team\|model (+value); maps to `DELETE /v1/cache[…]`; 200 + `proxySynced:false` until Mirror mounts it — never touches `request_logs` |
| `useCache` extended (fetchers inline) | `apps/dashboard/lib/hooks/use-cache.ts` | stats/config/saveConfig( PUT )/flush( POST )/loading/saving/flushing/error/refresh |
| Cache page rewritten (client) | `apps/dashboard/app/(app)/cache/page.tsx` | `use-cache` + `use-realtime`, skeletons, empty states, saver-stub banner, config save + toast, flush confirm dialog (scope/value, Esc), toasts `role=status` |

Verify: `npx tsc --noEmit` clean; curls all 200 with shaped JSON
(stats stub w/ live `requests7d:8`; config GET defaults → PUT persist →
GET stored; PUT 400 on threshold 0.5; flush 200 `proxySynced:false`;
flush 400 on missing value / bad scope). REQUIRED_ENV: none new
(`PROXY_MGMT_BASE`, `DATABASE_URL` already set). Wiring: dashboard
contracts proposed in `internal/cache/WIRING.md` (GET stats / PUT config /
DELETE flush) for Mirror. Next step: Mirror applies chain patch +
`GET /v1/cache/stats` → dashboard flips to `connected:true` with no code change.
