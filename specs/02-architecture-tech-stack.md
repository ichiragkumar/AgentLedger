# 02 — Architecture & Tech Stack

> Prev: [01-vision-market-reality](./01-vision-market-reality.md) | Parent: [00-index](./00-index.md) | Next: [03-phase-0-foundation](./03-phase-0-foundation.md)

## Architecture (One Diagram to Rule Them All)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        YOUR AGENTS                                  │
│  (CrewAI / LangGraph / AutoGen / Custom / n8n / Nasiko)            │
│         │                                                           │
│         │  OPENAI_BASE_URL=http://agentledger:8787/v1              │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    AGENTLEDGER PROXY                         │   │
│  │                                                             │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │   │
│  │  │ LAYER 1  │→ │ LAYER 2  │→ │ LAYER 3  │→ │ LAYER 4   │  │   │
│  │  │ OBSERVE  │  │ CACHE    │  │ OPTIMIZE │  │ ENFORCE   │  │   │
│  │  │          │  │          │  │          │  │           │  │   │
│  │  │• Count   │  │• Semantic│  │• Route   │  │• Budgets  │  │   │
│  │  │• Tag     │  │• Exact   │  │• Compress│  │• Policies │  │   │
│  │  │• Log     │  │• TTL     │  │• Downgrde│  │• Alerts   │  │   │
│  │  │• Trace   │  │          │  │          │  │• Kill     │  │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └───────────┘  │   │
│  │         │                                                   │   │
│  │         ▼                                                   │   │
│  │  ┌──────────────────────────────────┐                      │   │
│  │  │         KEY VAULT                 │                      │   │
│  │  │  Agents never see real API keys   │                      │   │
│  │  └──────────────────────────────────┘                      │   │
│  └────────────────────┬────────────────────────────────────────┘   │
│                       │                                             │
│                       ▼                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ OpenAI   │  │Anthropic │  │ Google   │  │ DeepSeek │  ...      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘          │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
  ┌──────────────────────────────┐
  │      DASHBOARD (Web UI)      │
  │  Cost / Agent / Team / ROI   │
  └──────────────────────────────┘
```

## Request Flow
1. Agent sends OpenAI-compatible request to `http://agentledger:8787/v1` with `AgentLedger-Key: vk_xxx` + attribution headers (`X-Agent-Id`, `X-Team-Id`, `X-Project-Id`, `X-Request-Chain-Id`, `X-Parent-Agent-Id`).
2. Proxy: Enforce (budgets/policies pre-check) → Cache (exact → semantic) → Optimize (route/classify) → Forward via Key Vault to upstream.
3. Response: extract `usage.prompt_tokens` / `usage.completion_tokens`, compute cost via price registry, log to Postgres, export metrics/traces, stream back SSE if needed.
4. Dashboard reads Postgres for Cost / Agent / Team / ROI views.

## Tech Stack Decision

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Language** | **Go** | 11μs latency overhead (Bifrost reference), 5000 rps. Python proxies add 50x more latency. |
| **API compatibility** | OpenAI-compatible `/v1/chat/completions` | Drop-in replacement — any framework works |
| **Cache backend** | Redis (exact-match) + Qdrant/Weaviate (semantic) | Semantic caching returns cached response when new prompt means same thing, even if wording differs |
| **Dashboard** | React + TailwindCSS (or SvelteKit for speed) | Simple, fast, shippable in days |
| **Database** | PostgreSQL (metadata, budgets, policies) | Reliable, free, battle-tested |
| **Deployment** | Docker → Helm chart → 1-click cloud | Self-hosted first (trust), cloud later (revenue) |
| **License** | Apache 2.0 (core) + BSL (enterprise features) | Open-source adoption + monetizable |

## Key Design Constraints
- OpenAI-compatible: must work with `OPENAI_BASE_URL` swap, including `stream: true` SSE.
- Attribution via headers, no SDK required for v1.
- Virtual keys (`vk_xxx`) resolved server-side; agents never see real keys.
- Prometheus `/metrics` + `/health` from day one.
- Policy evaluation <1ms, cache exact <1ms, semantic 5-20ms, proxy p99 overhead <15ms (streaming), <20ms (cloud multi-tenant).
- Audit log append-only, hash-chained (Phase 4+).
- OTel export for Datadog/Grafana interop (Phase 6).

## Local Dev Stack (Phase 0 target)
`docker compose up` → proxy + Redis + Postgres + Qdrant. See [03-phase-0-foundation](./03-phase-0-foundation.md).
