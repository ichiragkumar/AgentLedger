# Ecosystem Verification — platform-shaped traffic meters end-to-end

**Date:** 2026-09-20 (UTC timestamps below)
**Role:** ledger-int-verify (ecosystem verifier)
**Live stack:** proxy `:8787` · dashboard `:3000` · Postgres · mock upstream `:9999`
**Scope:** prove traffic shaped like DronaHQ / Anakin / Nasiko agents would send is
metered, attributed and budgeted — without their accounts.
**Key hygiene:** full key material existed only in the issuance HTTP responses and a
`0600` temp file, used in-process, then overwritten (`rm -P`) and unlinked. This
report records **prefix/last4 only — never full material**.

## Result: PASS

3/3 platform-shaped requests → `200`, one `request_logs` row per agent id, spend
visible on `/api/spend`, all three keys' `last_used_at` touched, team budget
`ecosystem` moved `$0 → $0.0001117`. Bogus key → `401` before any upstream call.
All test rows/keys/budget purged; zero residue verified.

## Transcript (UTC)

| T (UTC) | Step | Evidence |
|---|---|---|
| 11:07:17 | T0 baseline | `request_logs`=0, `virtual_keys`=0, `budgets`=0 for test scope; global `spend24h=$0.00023755` (9 reqs, siblings' traffic, untouched) |
| 11:08:53 | Provision keys | `POST /api/keys` ×3 → `201`, source proxy (Go vault, PG-backed) |
| 11:08:56 | Create budget | `POST /api/budgets` team/`ecosystem`/monthly `$0.50` → `201`, `spentUsd=0`, `util=0%`, `state=ok` |
| 11:09:33 | Live traffic | 3× `POST :8787/v1/chat/completions` → `200` (DB `last_used_at` 16:39:33 IST corroborates) |
| 11:09:35 | Negative control | bogus key → `401 {"error":"invalid virtual key"}` (auth rejects pre-upstream) |
| 11:09:35 | Metering confirmed | 3 rows in `request_logs`; `/api/spend` byAgent shows all three; budget `spentUsd=$0.0001117` |
| 11:10:09 | Revoke + budget delete | `DELETE /api/keys?id=` ×3 → `revoked`; `DELETE /api/budgets?id=` → `deleted` |
| 11:10:13 | Hard purge + verify | `DELETE FROM request_logs/virtual_keys` (3 rows each); `budgets` already gone via API; `logs=0 keys=0 budgets=0 audit=0`; temp key material overwritten + unlinked |

## Keys (prefix/last4 ONLY)

| Name | ID | Prefix | Last4 | agent_scope | team_scope |
|---|---|---|---|---|---|
| `vk_int_dronahq` | `e600b109f12c5a7a` | `vk_20ef` | `ee10` | `dronahq` | `ecosystem` |
| `vk_int_anakin` | `754fe3ecef0baa57` | `vk_606f` | `0eb9` | `anakin` | `ecosystem` |
| `vk_int_nasiko` | `11dc6374ad5615cf` | `vk_324f` | `d7e7` | `nasiko` | `ecosystem` |

## Request shapes (keys redacted)

```bash
# Provision (per platform; agentScope = platform id)
curl -X POST http://localhost:3000/api/keys -H 'Content-Type: application/json' \
  -d '{"name":"vk_int_dronahq","agentScope":"dronahq","teamScope":"ecosystem"}'
# → 201 { key: {id, prefix:"vk_20ef", last4:"ee10", status:"active"}, fullKey: "<shown-once>" }

# Budget BEFORE traffic
curl -X POST http://localhost:3000/api/budgets -H 'Content-Type: application/json' \
  -d '{"level":"team","key":"ecosystem","window":"monthly","tokenLimit":1000000,"dollarLimit":0.50,"ownerTeam":"ecosystem"}'
# → 201 { budget: {id:"b_78822ad8057f", spentUsd:0, utilizationPct:0, state:"ok"} }

# DronaHQ — Tool-Builder-style JSON task envelope
curl -X POST http://localhost:8787/v1/chat/completions \
  -H 'Content-Type: application/json' -H 'AgentLedger-Key: vk_****ee10' \
  -H 'X-Agent-Id: dronahq-tool-builder' -H 'X-Team-Id: ecosystem' -H 'X-Project-Id: dronahq-verify' \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"{\"task\":\"summarize_ticket\",\"app\":\"support-desk\",\"inputs\":{\"ticket_id\":\"T-1042\",\"text\":\"Customer cannot reset password, reset email never arrives.\"},\"output\":\"one-line summary\"}"}]}'
# → 200, usage {prompt_tokens:19, completion_tokens:70}

# Anakin — generic agent task
curl -X POST http://localhost:8787/v1/chat/completions \
  -H 'Content-Type: application/json' -H 'AgentLedger-Key: vk_****0eb9' \
  -H 'X-Agent-Id: anakin-agent' -H 'X-Team-Id: ecosystem' -H 'X-Project-Id: anakin-verify' \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Agent task: draft a 2-sentence status update for a nightly data sync job that completed with 3 warnings."}]}'
# → 200, usage {prompt_tokens:31, completion_tokens:74}

# Nasiko — CrewAI-style (role/backstory/goal system + goal user message)
curl -X POST http://localhost:8787/v1/chat/completions \
  -H 'Content-Type: application/json' -H 'AgentLedger-Key: vk_****d7e7' \
  -H 'X-Agent-Id: nasiko-crew' -H 'X-Team-Id: ecosystem' -H 'X-Project-Id: nasiko-verify' \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"system","content":"You are a CrewAI researcher crew member. Role: market analyst. Backstory: ten years covering devtools. Goal: brief founders fast."},{"role":"user","content":"Goal: in two sentences, state what TokenOps means for an AI startup burn rate."}]}'
# → 200, usage {prompt_tokens:51, completion_tokens:110}

# Negative control — bogus key dies at auth, never reaches upstream
curl -X POST http://localhost:8787/v1/chat/completions \
  -H 'AgentLedger-Key: vk_****0000' -H 'X-Agent-Id: intruder' -d '{"model":"gpt-4o-mini","messages":[]}'
# → 401 {"error":"invalid virtual key"}

# Purge
curl -X DELETE 'http://localhost:3000/api/keys?id=<id>'            # ×3 → {"revoked":…}
curl -X DELETE 'http://localhost:3000/api/budgets?id=b_78822ad8057f' # → {"deleted":…}
-- sql: DELETE FROM request_logs WHERE agent_id IN (…3 ids…);      -- 3 rows
-- sql: DELETE FROM virtual_keys WHERE name IN (…3 names…);         -- 3 rows (revoke leaves rows)
```

## Metered figures (all from live `request_logs` + `/api/spend` + `/api/budgets`)

| Agent (platform shape) | Tokens in/out | Cost USD | Rows |
|---|---|---|---|
| `dronahq-tool-builder` (DronaHQ JSON task) | 19 / 70 | $0.0000299 | 1 × `200` |
| `anakin-agent` (Anakin generic task) | 31 / 74 | $0.0000327 | 1 × `200` |
| `nasiko-crew` (Nasiko CrewAI messages) | 51 / 110 | $0.0000491 | 1 × `200` |
| **Total** | **101 / 254 (355)** | **$0.0001117** | **3** |

- `/api/spend` `byAgent` lists all three agents with matching spend/requests (sums to `$0.0001117` exactly).
- Budget `team:ecosystem` (`b_78822ad8057f`): `spentUsd` `$0 → $0.0001117`
  (`0.0223%` of `$0.50`; view rounds to `0%`), `spentTokens=355`, `state=ok`,
  `forecastUsd=$4.83` (linear monthly projection off a 3-request sample — expected artifact, not a bug).
- `last_used_at` touched on all three keys (`t` in PG; revoke responses echo `lastUsedAt=16:39:33 IST` = traffic time).

## Upstream note (honest)

- Mock `:9999` (`demo/mock_upstream.py`) **is in the proxy path**: sub-50 ms
  latencies (46/3/3 ms) and usage tokens match its `words×1.33+8` formula
  **exactly** (19/31/51). Mock text; **all metering real**; `$0` real spend.
  (Repo `.env` shows empty `*_BASE_URL` — the running proxy was started with an
  override pointing at the mock. Flagging for ledger-mirror; no config touched.)
- Live observation: requested `gpt-4o-mini`, served/logged **`gemini-2.0-flash`**
  — the Phase-3 Router downgraded to the cheapest tier live, and cost math
  follows the served model (`19×$0.10 + 70×$0.40 per 1M = $0.0000299` ✓).

## Purge proof

```
logs=0  keys=0  budgets=0  audit=0        -- scoped PG counts post-purge
vk_int_* remaining: 0 (source: proxy)     -- GET /api/keys
ecosystem present: False (4 sibling budgets untouched) -- GET /api/budgets
/tmp key material: overwritten (rm -P) + unlinked, verified absent
```

## NEEDS — what only a real account can prove

1. **Real partner credentials/flows** — DronaHQ/Anakin/Nasiko API keys, OAuth, and
   webhook shapes. This run proves proxy-side compatibility with platform-shaped
   payloads, not partner integration.
2. **Real-vendor token/cost parity** — mock usage is word-count-derived; real
   tokenizers and vendor pricing drift will change the figures (math path is identical).
3. **Real failure modes** — mock always `200` in ~1 ms; vendor `429/5xx` retries,
   latency tails, and partial-usage metering are unproven live.
4. **Budget hard-stop under live spend** — `$0.50` budget sat at `0.02%`; the
   `100%` trip + `budget_exceeded` denial was not exercised with real traffic.
5. **Cache-hit spend behavior** on repeated platform traffic patterns (all three
   calls here were unique-prompt misses by design).

## Next step

Partner-sandbox replay: re-run this exact transcript (same agent ids, same three
payload shapes) against real DronaHQ / Anakin / Nasiko sandbox credentials when
available, then extend with a low-budget hard-stop trip to close NEEDS #4.
No code changes required — verification-only script, kep
...[truncated 76 chars]