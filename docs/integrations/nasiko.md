# Nasiko × AgentLedger

Nasiko agents are already wired through a single environment variable.
Point that variable at AgentLedger instead of Nasiko's own LLM router (or
chain them: Nasiko router → AgentLedger → upstream) and every token is
metered, cached, routed, and budget-enforced. No code changes, no redeploy
of agent logic — one env var.

## What Nasiko is (verified from source)

- **OSS, Apache-2.0** (`LICENSE` at repo root) — `github.com/Nasiko-Labs/nasiko`.
- **Docker Compose stack**: Postgres · Redis · RustFS (S3) · OTel Collector ·
  Tempo · Loki · `nasiko-server` (`docker-compose.yml`).
- **Bring-your-own-LLM**: the server never bakes provider keys into agents.
  Agents receive `OPENAI_BASE_URL` + a short-lived identity JWT instead of a
  real key (`llm-router/README.md`: "Agents get an `OPENAI_BASE_URL` + a
  short-lived identity token instead of a real key. The router resolves
  provider/model/key server-side.").
- **CrewAI templates**: `agents/crewai/` (CrewAI `LLM`/`Agent`/`Crew` sample),
  scaffolded via `nasiko new` (`cli/src/commands/scaffold.rs`).
- Clone evidence: shallow clone to `/tmp/nasiko` (NOT the repo),
  HEAD `58cfe60` ("Merge pull request #392 … openrouter-llm-provider").

## The seam (code-inspected, not run)

Nasiko's LLM router **injects** the base URL into every deployed agent:

```rust
// llm-router/src/inject.rs  (~line 79, function inject_llm_env)
env_vars.insert("OPENAI_BASE_URL".into(), format!("{base}/v1"));
env_vars.insert("OPENAI_API_KEY".into(), token);   // short-lived identity JWT, not a real key
```

And every Python agent template **honors** `OPENAI_BASE_URL` via the OpenAI
SDK's `base_url` parameter:

```python
# agents/translator/src/agent_executor.py  (lines 93-94)
api_key=os.getenv("OPENAI_API_KEY"),
base_url=os.getenv("OPENAI_BASE_URL") or None,

# agents/summarizer/src/agent_executor.py  (lines 27-28) — identical pattern
api_key=os.getenv("OPENAI_API_KEY"),
base_url=os.getenv("OPENAI_BASE_URL") or None,

# agents/openai/src/agent.py  (lines 64-65)
api_key=os.getenv("OPENAI_API_KEY"),
base_url=os.getenv("OPENAI_BASE_URL"),
```

The CrewAI template does **not** pass `base_url` explicitly —

```python
# agents/crewai/src/agent.py  (ImageGenerationAgent.__init__)
self.model = LLM(
    model="openai/gpt-4o",
    api_key=os.getenv("OPENAI_API_KEY"),
)
```

— but CrewAI resolves the endpoint from the environment when `base_url` is
omitted: `OPENAI_API_BASE` ("Using Environment Variables",
`docs.crewai.com/.../llm-connections`) and `OPENAI_BASE_URL` ("Supported
Environment Variables", `docs.crewai.com/.../concepts/llms`) are both honored
for OpenAI-provider models. **VERIFIED-BY-DOCS** (CrewAI docs, fetched
2026-09-20). One caveat: Nasiko injects `OPENAI_BASE_URL`, while the older
CrewAI env-var doc leads with `OPENAI_API_BASE` — current CrewAI docs list
`OPENAI_BASE_URL` as supported, so the injected variable is picked up. If you
hit an older CrewAI version that only reads `OPENAI_API_BASE`, export both
pointing at the same AgentLedger URL (see wiring option B).

Platform side, `OPENAI_BASE_URL` defaults to the public endpoint and is
overridable for exactly this purpose:

```ini
# .env.example  (lines 62-68)
OPENAI_API_KEY=sk-your-openai-api-key
# Override the API base URL (Azure OpenAI, a local proxy, a gateway, etc.)
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

```rust
// config/src/lib.rs  (line 274)
openai_base_url: std::env::var("OPENAI_BASE_URL").ok(),
```

## Wiring (one env var)

AgentLedger speaks `POST /v1/chat/completions` with the same OpenAI shape
Nasiko agents already send (cf. `demo/runner.py`), authenticating via the
`AgentLedger-Key` header plus `X-Agent-Id` / `X-Team-Id` / `X-Project-Id`
attribution headers (cf. `specs/02-architecture-tech-stack.md` § Request Flow).

**Option A — direct (recommended for metering):** bypass Nasiko's router and
point agents straight at AgentLedger. In Nasiko's `.env` (or the deployed
agent's environment):

```bash
OPENAI_BASE_URL=http://agentledger:8787/v1   # was https://api.openai.com/v1
OPENAI_API_KEY=<vk_nasiko_key>               # AgentLedger virtual key (cf. demo/seed.py POST /api/keys)
OPENAI_MODEL=<model-name>                    # unchanged
```

The OpenAI SDK puts the key in `Authorization: Bearer`, which AgentLedger
also accepts as the virtual-key transport alongside the `AgentLedger-Key`
header — but attribution headers (`X-Agent-Id`, …) can only be set in code,
so for per-agent cost breakdowns prefer patching the template client
construction (one line, same files cited above) or fronting with a tiny
header-injecting shim.

**Option B — chained (Nasiko router stays authoritative):** keep Nasiko's
`OPENAI_BASE_URL` injection untouched and instead set the *router's*
upstream to AgentLedger, i.e. configure Nasiko's provider key/URL settings
(`PLATFORM_OPENAI_API_KEY`, `{OPENAI,ANTHROPIC,GEMINI}_API_BASE` test
overrides — see `llm-router/README.md` § Configuration) to terminate at
AgentLedger. Nasiko keeps resolving provider/model/key; AgentLedger meters
everything downstream. **[NEEDS-RUN — override-var plumbing not exercised;
confirm against a live Nasiko stack.]**

### CrewAI-template note
`agents/crewai/src/agent.py` needs no edit for option A on current CrewAI
(env fallback covers `OPENAI_BASE_URL`). For maximal explicitness you may
still pass it through:

```python
self.model = LLM(
    model="openai/gpt-4o",
    api_key=os.getenv("OPENAI_API_KEY"),
    base_url=os.getenv("OPENAI_BASE_URL"),  # one-line addition; None → CrewAI default
)
```

## Verify

1. `docker compose up -d` the Nasiko stack (source: `/tmp/nasiko`, never in
   this repo), scaffold an agent (`nasiko new openai my-agent`), apply
   option A.
2. Send one chat (`nasiko chat "Hello there"` needs a space in the message).
3. Check the AgentLedger dashboard: the request lands under your
   `X-Agent-Id` with token counts and cost — same cross-check as
   `demo/runner.py`'s run-id digest. **[NEEDS-RUN — full stack deliberately
   not run here (too heavy); seam verified by code inspection only.]**

## References (inspected 2026-09-20, clone HEAD `58cfe60`)

- `llm-router/src/inject.rs` (~L79 + `injects_openai_base_url_and_key` test)
- `llm-router/README.md` (egress-proxy design, `{OPENAI_BASE_URL}/chat/completions`)
- `agents/translator/src/agent_executor.py` (L93-94), `agents/summarizer/src/agent_executor.py` (L27-28), `agents/openai/src/agent.py` (L64-65)
- `agents/crewai/src/agent.py` (`LLM(model="openai/gpt-4o", api_key=…)`, no `base_url`)
- `.env.example` (L62-68), `config/src/lib.rs` (L32, L274, `openai_base_url_without_v1` L449)
- `https://docs.crewai.com/.../llm-connections` (`OPENAI_API_BASE` env var)
- `https://docs.crewai.com/.../concepts/llms` (`OPENAI_BASE_URL` supported env var)
- `https://github.com/Nasiko-Labs/nasiko` (Apache-2.0, Compose stack)
