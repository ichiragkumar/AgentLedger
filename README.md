# AgentLedger — the FinOps proxy for AI agents

**Observe every token dollar by agent, team, and project. One env var. Nothing else changes.**

```bash
OPENAI_BASE_URL=http://localhost:8787/v1
```

AgentLedger sits between your agents (CrewAI, LangGraph, AutoGen, custom) and
LLM providers as an OpenAI-compatible proxy. Phase 1 (**The Mirror**) counts
tokens, prices every request, and logs it with attribution tags — so you can
finally see where your AI money goes. Later phases cut the bill automatically
(semantic cache → intelligent routing → hard budgets).

Architecture: see [`specs/02-architecture-tech-stack.md`](specs/02-architecture-tech-stack.md)
(full diagram) and [`api/openapi.yaml`](api/openapi.yaml).

## Quickstart (3 commands)

```bash
docker compose up --build -d
export OPENAI_BASE_URL=http://localhost:8787/v1 AGENTLEDGER_KEY=vk_test
python examples/smoke_langgraph.py   # or: bash examples/smoke.sh
```

Then open the proxy: `curl localhost:8787/health`, `curl localhost:8787/metrics`.
Every `POST /v1/chat/completions` is logged with model, tokens in/out, cost,
latency, and `X-Agent-Id` / `X-Team-Id` / `X-Project-Id` tags (see `db/schema.sql`
for the dashboard queries).

## How it works (Phase 1)

```
Agent --(OPENAI_BASE_URL=:8787, AgentLedger-Key: vk_xxx)--> Proxy --(real key)--> OpenAI / Anthropic / Google / DeepSeek
                                                              |
                                              tokens + cost + tags --> Postgres (stdout fallback) --> Dashboard
```

- `POST /v1/chat/completions` forwards by `model` prefix (`gpt-*`→OpenAI,
  `claude-*`→Anthropic, `gemini-*`→Google, `deepseek-*`→DeepSeek), SSE
  `stream:true` supported, tokens counted on completion.
- Token counts come verbatim from provider `usage` (within 1%); cost comes
  from `data/prices.json` (reloadable; goal: invoice ±5%).
- Virtual keys (`vk_xxx`) resolve server-side; real keys never touch agent
  code or logs (only `vk_t***` prefixes are logged).
- Middleware chain `enforce-stub → cache-stub → route-stub → upstream` lives
  in `internal/proxy/` — clean extension points for Saver/Router/Enforcer.
- `GET /health`, `GET /metrics` (Prometheus). p99 overhead target <15ms
  streaming (see `X-AgentLedger-Latency-Ms`).

## Repo layout

```
cmd/proxy/          HTTP server :8787
internal/proxy/     reverse proxy, provider routing, middleware chain, metrics
internal/pricing/   JSON price registry + cost calc (reused by Router)
internal/logger/    Postgres logger (stdout fallback, no DB required)
internal/auth/      vk_xxx virtual-key resolver stub
pkg/models/         shared request/log types
api/openapi.yaml    proxy API contract
data/prices.json    per-model $/1M tokens
db/schema.sql       request_logs table + dashboard queries
examples/           LangGraph + curl smoke tests
```

## Dev

```bash
make build && make test && make run   # local proxy on :8787
make smoke                            # mock-upstream e2e (no keys needed)
docker compose up --build -d          # full stack: proxy + postgres + redis + qdrant
```

## Status

- [x] Phase 0: Go module, Docker Compose, CI, Makefile
- [x] Phase 1 Mirror: proxy, multi-provider, token/cost log, virtual keys, SSE, health/metrics
- [ ] Dashboard v0.1 (Next.js 15 + shadcn) — queries ready in `db/schema.sql`
- [ ] Phase 2 Saver (cache) / Phase 3 Router / Phase 4 Enforcer / Phase 5 Brain — stubs + interfaces ready
