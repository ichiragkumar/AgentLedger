# Integrations — point any OpenAI-compatible agent at AgentLedger

Every integration in this directory is the same three-part pattern. Learn it
once, apply it to any platform.

## The universal pattern

```http
POST {LEDGER_BASE_URL}/v1/chat/completions
Content-Type: application/json
AgentLedger-Key: vk_<platform>_<agent>     # virtual key, provisioned via POST /api/keys (cf. demo/seed.py)
X-Agent-Id: <agent>                        # per-agent cost breakdown
X-Team-Id: <team>                          # team rollups / team budgets
X-Project-Id: <project>                    # project rollups
```

Request body: standard OpenAI chat-completions shape (`model`, `messages`,
optional `stream: true` SSE) — the exact shape `demo/runner.py` sends.
Optional chaining headers: `X-Request-Chain-Id`, `X-Parent-Agent-Id`
(lights up the topology view for multi-step agents).

What you get without touching agent logic: per-agent/team/project metering,
live cost via the price feed, exact + semantic caching, intelligent routing,
budget enforcement and runaway-kill, all visible on the dashboard
(cf. `specs/02-architecture-tech-stack.md` § Request Flow).

Three rules:

1. **Base URL swap only.** `https://api.openai.com/v1` →
   `http(s)://<ledger-host>:8787/v1`. Self-host default: `http://localhost:8787`
   (cloud-executed agents need a publicly reachable URL — `localhost` won't do).
2. **Virtual keys, never real keys.** Agents carry `vk_*`; real provider keys
   live in AgentLedger's Key Vault, never in agent code, logs, or third-party
   dashboards.
3. **Attribute everything.** At minimum `X-Agent-Id`; add team/project (and
   chain headers for multi-step flows) so the dashboard can slice cost the way
   `demo/runner.py`'s five Acme agents do.

## Per-platform guides

| Platform | Guide | Seam | Key format | Status |
|---|---|---|---|---|
| Anakin (anakin.ai builder) | [`anakin.md`](./anakin.md) | Workflow / Auto Agent HTTP or custom-code node → AgentLedger URL + headers | `vk_anakin_*` | Steps NEEDS-ACCOUNT (docs JS-gated); pattern VERIFIED-BY-DOCS |
| Nasiko (OSS, Docker Compose) | [`nasiko.md`](./nasiko.md) | One env var: `OPENAI_BASE_URL=http://agentledger:8787/v1` (templates already honor it; CrewAI via env fallback) | `vk_nasiko_*` | Seam VERIFIED-BY-CODE (`llm-router/src/inject.rs`, agent templates); E2E NEEDS-RUN |

## Provisioning cheat-sheet (mirrors `demo/seed.py`)

```bash
# 1. Mint a virtual key scoped to the platform's agent/team
curl -s localhost:3000/api/keys -H 'Content-Type: application/json' \
  -d '{"name":"vk_anakin_main","agentScope":"anakin-main","teamScope":"growth"}'

# 2. (Optional) cap spend so burn is visible early
curl -s localhost:3000/api/budgets -H 'Content-Type: application/json' \
  -d '{"level":"team","key":"growth","window":"monthly","tokenLimit":2000000,"dollarLimit":5}'

# 3. Point the platform at http://<ledger>:8787/v1 with the key, send one
#    test prompt, and confirm it on the dashboard (request counts must match).
```

## Adding a new platform guide

New file per platform under this directory (`<platform>.md`), plus one row in
the table above. Each guide must state per-step provenance
(`VERIFIED-BY-DOCS` / `VERIFIED-BY-CODE` / `NEEDS-ACCOUNT` / `NEEDS-RUN`),
cite exact doc URLs or file/line seams, and end with a dashboard-verification
step. Never commit `.env` material or real keys — virtual-key names only.
