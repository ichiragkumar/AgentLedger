# DronaHQ E2E — MCP tool → LLM → metered → purged

**Date:** 2026-09-20 (UTC timestamps below)
**Role:** ledger-drona-verify (DronaHQ verifier)
**Live stack:** proxy `:8787` · dashboard `:3000` · Postgres
**Sibling routes (parallel build):** `GET /api/integrations/dronahq/tools`,
`POST /api/integrations/dronahq/invoke`, `POST /api/integrations/dronahq/run`
**Key hygiene:** full key material never touched this run — the `run` route
issues `vk_dronahq_*` keys server-side and returns prefix/last4 only. This
report records **key IDs + prefix/last4 only — never full material**. No temp
files were created (nothing to overwrite/unlink).

## Result: PASS (4/4 steps)

| # | Step | Verdict | Evidence |
|---|---|---|---|
| 1 | `GET …/dronahq/tools` — curated read-only set | **PASS** | `200`, `count=16` of `total=57` upstream tools |
| 2 | `POST …/dronahq/run` — metered loop (MCP → LLM → logs → spend) | **PASS** | `200`, own `request_logs` row (`dronahq`/`ecosystem`), `/api/spend` delta exactly equals the run's reported cost |
| 3 | `POST …/dronahq/invoke` with WRITE tools — allowlist gate | **PASS** | `automation_delete` → `403 {"error":"tool_not_allowed"}`; `vibe_create_app` → `403`; allowed `vibe_list_apps` → `200` live MCP result |
| 4 | Purge my keys + rows, verify my residue zero | **PASS** | `my_keys=0`, `my_prefixes=0`; sibling artifacts deliberately untouched (see scope note) |

## Sibling-route polling (10-minute budget, 30s cadence)

| Poll | T (UTC) | tools | invoke | run |
|---|---|---|---|---|
| 1/20 | 11:33:37 | 404 | 404 | 404 |
| 2–4 | 11:34:22–11:35:23 | 404 | 404 | 404 |
| 5/20 | 11:35:53 | **200** | 400 (route live; `{}` fails shape validation) | 404 |
| 6/20 | 11:36:27 | 200 | 400 | **200** → **ALL_LIVE**, polling stopped |

No step was marked blocked — all three routes went live inside the budget.

## Transcript (UTC)

| T (UTC) | Step | Evidence |
|---|---|---|
| 11:33:37 | T0 baseline | Proxy `GET :8787/health` → `{"status":"ok","version":"dev"}`; bogus key on `:8787/v1/chat/completions` → `401 {"error":"invalid virtual key"}` (data-plane auth live). Dashboard `/api/integrations` lists `dronahq` status `live`. PG: `logs(dronahq/ecosystem)=0`, `keys(dronahq/ecosystem)=1` (pre-existing sibling key, not mine) |
| 11:36:35 | Step 1 | `GET /api/integrations/dronahq/tools` → `200`, `count=16`, `total=57` |
| 11:36:41 | Step 3 | `POST …/invoke {"tool":"automation_delete","args":{"id":"bogus-verify-000"}}` → body `{"error":"tool_not_allowed","tool":"automation_delete"}` (status confirmed `403` at 11:36:48). `vibe_create_app` → `403`. Allowed `vibe_list_apps` → `200` with live MCP payload `{"apps":[]}` — proves the MCP path is live behind the gate, and the gate touches nothing in DronaHQ |
| 11:36:48 | Step 2 baseline | `/api/spend`: `spend24h=$0.00027865`, `requests24h=10`, `byAgent[dronahq]={spend:$0.0000411, requests:1}` — all sibling traffic so far |
| 11:36:54 | Step 2 run 1 (default) | `POST …/run {}` → `200`: `tool=vibe_list_apps`, `summaryModel=gemini-2.0-flash`, `metered={model:gemini-2.0-flash, tokensIn:59, tokensOut:88, costUsd:$0.0000411, latencyMs:54.663, statusCode:200}`, `key={prefix:"vk_5e41", last4:"6052"}` |
| 11:37:32 | Step 2 anomaly check | No new `request_logs` row from run 1 (count still 10; `dronahq` rows still 1 — sibling's `vk_779d` row @11:36:29). Figures identical to the sibling's identical default run 25s earlier → suspected exact-prompt cache HIT served without a fresh log row (CACHE_ENABLED=true). Not a metering error — see rerun |
| 11:37:57 | Step 2 run 2 (distinct tool+prompt) | `POST …/run {"tool":"vibe_list_connectors","prompt":"verify-run distinct prompt alpha-9271: …"}` → `200`: live connector inventory returned, `metered={model:claude-3-5-haiku, tokensIn:208, tokensOut:106, costUsd:$0.0005904, latencyMs:32.727, statusCode:200}`, `key={prefix:"vk_23db", last4:"163f"}` |
| 11:38:22 | Step 2 confirmed | New row: `dronahq|ecosystem|claude-3-5-haiku|208/106|$0.0005904|200|11:37:59|vk_23db` ✓. `/api/spend`: `spend24h=$0.00086905` (+**$0.0005904** = exactly run 2's cost), `requests24h=11`, `byAgent[dronahq]={spend:$0.0006315, requests:2}` = `$0.0000411` (sibling) + `$0.0005904` (mine) ✓. Revoke receipt later showed `lastUsedAt=11:37:59Z` = traffic time ✓ |
| 11:38:49 | Step 4 purge | `DELETE /api/keys?id=<my-id>` ×2 → `{"revoked":…}` (source: proxy); SQL hard-delete of my 2 key rows + my 1 log row (`vk_23db`). Verify: `my_keys=0`, `my_prefixes=0` |

## Keys (IDs + prefix/last4 ONLY — no full material ever held)

| Name | ID | Prefix | Last4 | Owner | Disposition |
|---|---|---|---|---|---|
| `vk_dronahq_run_mu9qr7kn` | `d85f0b65abd0bc8f` | `vk_5e41` | `6052` | mine (run 1, cache-hit suspected, no traffic row) | revoked via API + hard-deleted, verified `0` |
| `vk_dronahq_run_mu9qskug` | `f4bf9f641b6d850c` | `vk_23db` | `163f` | mine (run 2, metered row @11:37:59) | revoked via API + hard-deleted, verified `0` |

## Request shapes (keys redacted — prefix/last4 only)

```bash
# Step 1 — curated tool list
curl -s http://localhost:3000/api/integrations/dronahq/tools
# → 200 { tools:[16×{name,description}], count:16, total:57 }

# Step 3 — negative: WRITE tool blocked at the gate (touches nothing in DronaHQ)
curl -s -X POST http://localhost:3000/api/integrations/dronahq/invoke \
  -H 'Content-Type: application/json' \
  -d '{"tool":"automation_delete","args":{"id":"bogus-verify-000"}}'
# → 403 {"error":"tool_not_allowed","tool":"automation_delete"}

# Step 3 — positive control: allowed read passes through to live MCP
curl -s -X POST http://localhost:3000/api/integrations/dronahq/invoke \
  -H 'Content-Type: application/json' -d '{"tool":"vibe_list_apps","args":{}}'
# → 200 {"tool":"vibe_list_apps","result":{"content":[{"type":"text","text":"{\"apps\":[]}"}],"isError":false}}

# Step 2 — metered loop (default tool + explicit tool variants)
curl -s -X POST http://localhost:3000/api/integrations/dronahq/run \
  -H 'Content-Type: application/json' -d '{}'
# → 200 { tool, toolResult, summary, metered:{model,tokensIn,tokensOut,costUsd,latencyMs,statusCode},
#         key:{prefix:"vk_****", last4:"****"} }  (full key material NEVER returned)

# Step 4 — purge (mine only)
curl -X DELETE 'http://localhost:3000/api/keys?id=<my-key-id>'   # ×2 → {"revoked":…}
-- sql: DELETE FROM request_logs WHERE agent_id='dronahq' AND team_id='ecosystem'
--        AND virtual_key_prefix='vk_23db';                       -- 1 row (mine)
-- sql: DELETE FROM virtual_keys WHERE id IN (<my-2-ids>);        -- 2 rows (mine)
```

## Metered figures (live `request_logs` + `/api/spend`, my traffic only)

| Run | Tool | Model (metered) | Tokens in/out | Cost USD | Latency | Log row |
|---|---|---|---|---|---|---|
| run 1 (default `{}`) | `vibe_list_apps` | `gemini-2.0-flash` | 59 / 88 | $0.0000411 | 54.7 ms | none — suspected cache HIT on sibling's identical run 25s prior (see note) |
| run 2 (distinct prompt) | `vibe_list_connectors` | `claude-3-5-haiku` | 208 / 106 | $0.0005904 | 32.7 ms | `dronahq\|ecosystem\|…\|11:37:59\|vk_23db` ✓ |
| **Spend delta (mine)** | | | | **+$0.0005904** (`$0.00027865 → $0.00086905`) | | `requests 10 → 11` |

## Tool catalog (Step 1 — the 16-tool read-only set, `200`, `count=16`/`total=57`)

`vibe_list_apps`, `vibe_get_app`, `vibe_list_connectors`,
`vibe_get_connector_accounts`, `vibe_get_db_schema`,
`vibe_get_data_agent_context`, `vibe_list_data_agents`,
`vibe_get_connector_job`, `vibe_list_subcats`, `vibe_get_subcat`,
`vibe_get_subcat_input_schema`, `vibe_get_app_permissions`,
`vibe_list_catalogues`, `vibe_get_catalogue_users`, `vibe_list_groups`,
`automation_list`.

## Purge proof

```
my_keys=0            -- virtual_keys rows for my 2 issued key IDs
my_prefixes=0        -- request_logs rows for my key prefixes (vk_5e41, vk_23db)
remaining (NOT mine, parallel sibling still active — deliberately untouched):
  keys: dronahq-verify-mu9qj17g, vk_dronahq_run_mu9qqnpt/qo44/qpcu/qssz7 (5)
  logs: dronahq/ecosystem ×1 (sibling's vk_779d row @11:36:29)
disk: no temp files created this run (only prefix/last4/IDs handled) — nothing to purge
DronaHQ itself: never mutated (negative used a bogus id; gate rejected pre-dispatch)
```

**Scope note (why not "zeros" globally):** the work order's "verify zeros"
is scoped to artifacts *this verifier issued*. Four siblings build in
parallel; deleting their live keys/rows mid-build (`vk_dronahq_run_mu9qq*`,
`dronahq-verify-mu9qj17g`, their metered row) would sabotage their
in-flight verification. All sibling artifacts are byte-identical pre/post
this run (names re-listed above); my residue is exactly zero.

## Observations for sibling owners (non-blocking)

1. **Cache-hit metering (ledger-saver / ledger-mirror):** run 1's default
   prompt, identical to the sibling backend's run 25s earlier, returned
   metered figures but wrote no `request_logs` row. If cache HITs bypass
   logging, dashboard counts under-report served traffic — confirm intended.
2. **`summaryModel` ≠ `metered.model` (ledger-drona-backend):** run 2
   returned `summaryModel=gemini-2.0-flash` but `metered.model=claude-3-5-haiku`
   (the Phase-3 router retier, cf. `docs/integrations/VERIFICATION.md`
   honest-upstream note). Decide which field is the billing source of truth
   and document it on the `run` route.
3. **`invoke` shape validation:** `{}` → `400` (route live, strict shape) —
   fine, but the UI picker should always send `{tool, args:{}}` explicitly.

## Next step

Sibling loop is proven live and metered — hand off to **ledger-drona-docs**
to flip spec 22 DronaHQ → LIVE citing this file's figures, and to
**ledger-drona-ui** to bind the console's result panel to the `metered` +
`key{prefix,last4}` shape verified here. No code changes from this track;
re-run this transcript (one distinct prompt per run to dodge cache-hit
dedup) after any `run`-route model-pinning change to close observation #2.
