# 02 — Architecture & Tech Stack

> Prev: [01-vision-market-reality](./01-vision-market-reality.md) | Parent: [00-index](./00-index.md) | Next: [03-phase-0-foundation](./03-phase-0-foundation.md)

## Architecture — Detailed (v2, canonical)

```
╔══════════════════════════════════════════════════════════════════╗
║                      YOUR AGENT LAYER                           ║
║                                                                  ║
║   CrewAI · LangGraph · AutoGen · Custom · n8n · Nasiko           ║
║                          │                                       ║
║    OPENAI_BASE_URL=http://agentledger:8787/v1   ← one change     ║
╚══════════════════════════════════════════════════════════════════╝
                           │
                           ▼
╔══════════════════════════════════════════════════════════════════╗
║                    AGENTLEDGER PROXY (Go)                        ║
║                   < 1ms overhead · 5000 RPS                      ║
║                                                                  ║
║  ┌─────────────────────────────────────────────────────────────┐ ║
║  │  LAYER 1 — OBSERVE                                          │ ║
║  │  Count tokens · Tag by agent/team/project · Log to Postgres │ ║
║  │  Trace request chain · Cost per request (live price feed)   │ ║
║  └─────────────────────────┬───────────────────────────────────┘ ║
║                            │                                     ║
║  ┌─────────────────────────▼───────────────────────────────────┐ ║
║  │  LAYER 2 — CACHE                                            │ ║
║  │  Exact match (SHA-256 · Redis · <1ms)                       │ ║
║  │  Semantic match (embeddings · Qdrant · <25ms)               │ ║
║  │  Saves 30–60% of API calls before they happen               │ ║
║  └─────────────────────────┬───────────────────────────────────┘ ║
║                            │                                     ║
║  ┌─────────────────────────▼───────────────────────────────────┐ ║
║  │  LAYER 3 — ROUTE                                            │ ║
║  │  Task classifier → model tier selection                     │ ║
║  │  Simple → Gemini Flash ($0.75/M)                            │ ║
║  │  Complex → Claude Sonnet ($3/M)                             │ ║
║  │  Critical → Frontier model                                  │ ║
║  │  Topology-aware: knows your agent graph, routes per step    │ ║
║  └─────────────────────────┬───────────────────────────────────┘ ║
║                            │                                     ║
║  ┌─────────────────────────▼───────────────────────────────────┐ ║
║  │  LAYER 4 — ENFORCE                                          │ ║
║  │  Budget hierarchy: Org → Team → Project → Agent             │ ║
║  │  Alert at 75% · Downgrade model at 90% · Hard stop at 100%  │ ║
║  │  Policy engine (no PII to external models, etc.)            │ ║
║  │  Runaway loop kill (depth + token budget + time window)     │ ║
║  └─────────────────────────┬───────────────────────────────────┘ ║
║                            │                                     ║
║  ┌─────────────────────────▼───────────────────────────────────┐ ║
║  │  KEY VAULT                                                  │ ║
║  │  Agents send vk_xxx virtual keys                            │ ║
║  │  Real API keys never in logs, never in agent code           │ ║
║  └─────────────────────────────────────────────────────────────┘ ║
╚══════════════════════════════════════════════════════════════════╝
                           │
          ┌────────────────┼─────────────────┐
          ▼                ▼                 ▼
     OpenAI          Anthropic         Google · DeepSeek
                                       Mistral · any provider
                           │
                           ▼
╔══════════════════════════════════════════════════════════════════╗
║                      DASHBOARD (Next.js)                         ║
║                                                                  ║
║  Cost by agent · Cost by team · Cache hit rate · Budget burndown ║
║  Model distribution · Request log · Agent topology graph         ║
║  Real-time · Dark/light · Self-hosted or cloud                   ║
╚══════════════════════════════════════════════════════════════════╝
```

## Architecture — Compact (v1 reference)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        YOUR AGENTS                                  │
│  (CrewAI / LangGraph / AutoGen / Custom / n8n / Nasiko)            │
│         │                                                           │
│         │  OPENAI_BASE_URL=http://agentledger:8787/v1              │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    AGENTLEDGER PROXY                         │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │   │
│  │  │ LAYER 1  │→ │ LAYER 2  │→ │ LAYER 3  │→ │ LAYER 4   │  │   │
│  │  │ OBSERVE  │  │ CACHE    │  │ OPTIMIZE │  │ ENFORCE   │  │   │
│  │  │• Count   │  │• Semantic│  │• Route   │  │• Budgets  │  │   │
│  │  │• Tag     │  │• Exact   │  │• Compress│  │• Policies │  │   │
│  │  │• Log     │  │• TTL     │  │• Downgrde│  │• Alerts   │  │   │
│  │  │• Trace   │  │          │  │          │  │• Kill     │  │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └───────────┘  │   │
│  │  ┌──────────────────────────────────┐                      │   │
│  │  │         KEY VAULT                 │                      │   │
│  │  └──────────────────────────────────┘                      │   │
│  └────────────────────┬────────────────────────────────────────┘   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ OpenAI   │  │Anthropic │  │ Google   │  │ DeepSeek │  ...      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘          │
└─────────────────────────────────────────────────────────────────────┘
```

## Request Flow
1. Agent sends OpenAI-compatible request to `http://agentledger:8787/v1` with `AgentLedger-Key: vk_xxx` + attribution headers (`X-Agent-Id`, `X-Team-Id`, `X-Project-Id`, `X-Request-Chain-Id`, `X-Parent-Agent-Id`).
2. Proxy: Enforce (budgets/policies pre-check) → Cache (exact → semantic) → Optimize (route/classify) → Forward via Key Vault to upstream.
3. Response: extract `usage.prompt_tokens` / `usage.completion_tokens`, compute cost via live price feed, log to Postgres, export metrics/traces, stream back SSE if needed.
4. Dashboard (Next.js) reads Postgres for cost / cache / routing / budget / topology views, real-time.

## Tech Stack Decision

| What | Choice | Why |
|------|--------|-----|
| **Proxy** | Go | Bifrost is a high-performance, open-source AI gateway built in Go that delivers LLM cost tracking as core infrastructure, not observability add-on. Same approach. Sub-ms overhead, 5000 RPS. Python proxies add 50x latency. |
| **API compatibility** | OpenAI-compatible `/v1/chat/completions` | Drop-in replacement — any framework works |
| **Exact cache** | Redis | Microsecond lookups. Industry standard. SHA-256, <1ms. |
| **Semantic cache** | Qdrant | Vector similarity search for same-meaning queries, <25ms |
| **Database** | PostgreSQL | Request logs, budgets, policies, audit trail |
| **Dashboard** | Next.js 15 + shadcn/ui | App Router, RSC, dark/light, fast |
| **Auth** | NextAuth.js v5 | GitHub → email → SSO |
| **Charts** | Recharts via shadcn | Cost timelines, burndown, model distribution |
| **Deploy** | Docker Compose → Helm | Self-hosted first. Cloud second. |
| **License** | Apache 2.0 core / BSL enterprise | Open adoption + revenue |

## Key Design Constraints
- OpenAI-compatible: must work with `OPENAI_BASE_URL` swap, including `stream: true` SSE.
- Attribution via headers, no SDK required for v1.
- Virtual keys (`vk_xxx`) resolved server-side; agents never see real keys; never in logs.
- Prometheus `/metrics` + `/health` from day one.
- Policy evaluation <1ms, cache exact <1ms, semantic 5-20ms, proxy p99 overhead <15ms (streaming), <20ms (cloud multi-tenant). Design target <1ms proxy overhead.
- Audit log append-only, hash-chained (Phase 4+).
- OTel export for Datadog/Grafana interop (Phase 6).
- Dashboard: cost by agent/team, cache hit rate, budget burndown, model distribution, request log, topology graph. Real-time, dark/light, self-hosted or cloud.

## Local Dev Stack (Phase 0 target)
`docker compose up` → proxy + Redis + Postgres + Qdrant. See [03-phase-0-foundation](./03-phase-0-foundation.md).
