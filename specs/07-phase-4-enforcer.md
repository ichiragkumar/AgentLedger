# 07 — Phase 4: "The Enforcer" (Week 10-13)

> Prev: [06-phase-3-router](./06-phase-3-router.md) | Parent: [00-index](./00-index.md) | Next: [08-phase-5-brain-moat](./08-phase-5-brain-moat.md)

### *Pitch: "Hard budgets. Real enforcement. No $800 Friday night surprises."*
### *Old pitch preserved: "The CFO's dashboard for AI spend. Hard budgets. Auto-enforcement."*
### *Pitch line: "The CFO's dashboard. The CTO's guardrail. One proxy."*

## The Problem You're Solving
An unconstrained agent solving a software engineering task can cost $5–8 per task in API fees alone. At scale, this becomes business-critical. Effective management requires tagging every LLM API call with metadata to move from "black box" spending to unit economics.

Preserved story: FinOps lead at Series B asked "How many tokens will support copilot use in May, within budget?" No answer. Three providers, four virtual keys, only linear extrapolation off last month's invoice, blown 38% past plan.

## What You Ship
Budget management, policy enforcement, alerting, cost attribution hierarchy.

```
✓ Budget hierarchy         →  Org → Team → Project → Agent
✓ Soft alerts              →  Slack/email at 50%, 75%, 90%
✓ Auto-downgrade           →  at 90%, route to cheaper models
✓ Hard stop                →  at 100%, HTTP 429 with clear error
✓ Policy engine            →  YAML rules: model access, PII, max tokens
✓ Runaway loop detection   →  kill chain if depth/tokens/time exceeded
✓ Cost forecasting         →  "at this rate you'll spend $X by month end"
✓ Budget burndown chart    →  CFO-ready, real-time
✓ Immutable audit log      →  every enforcement action, tamper-evident
```

## User Story
> *As a VP of Engineering, I want to set a $5,000/month budget for the AI team, with sub-budgets per project, and get alerted at 75% / auto-downgrade at 90% / hard-stop at 100%, so we never blow our AI budget again.*

## Tasks

| # | Task | Output | Time |
|---|------|--------|------|
| 4.1 | **Budget hierarchy** — Org → Team → Project → Agent, each with monthly/weekly/daily token & dollar limits | Budget tree | 3 days |
| 4.2 | **Soft alerts** — webhook/email/Slack at 50%, 75%, 90% | Early warning | 2 days |
| 4.3 | **Auto-downgrade** — at 90%, auto-route to cheaper models (configurable) | Graceful degradation | 1.5 days |
| 4.4 | **Hard stop** — at 100%, reject with 429 + clear JSON | Cost ceiling | 1 day |
| 4.5 | **Policy engine** — YAML rules: `deny if model == "gpt-5.5-pro" AND team != "research"`, `redact PII`, `max_tokens_per_request < 4096 for team:marketing`, no PII to external models | Governance | 3 days |
| 4.6 | **Runaway loop detection** — track chains via `X-Request-Chain-Id`, kill if depth > N or tokens > threshold in window (depth + token budget + time window) | Safety net | 2 days |
| 4.7 | **Cost forecasting** — linear + seasonal projection, "at this rate, you'll spend $X by month end" | Predictability | 2 days |
| 4.8 | **Budget dashboard v2 (Next.js + Recharts)** — burndown per team, utilization %, forecast vs budget, overage log | CFO-ready | 2 days |
| 4.9 | **Audit log** — immutable log of budget/policy/enforcement changes | Compliance | 1 day |
| 4.10 | **Budget management API** — CRUD for budgets, policies, alerts | Automation | 1.5 days |

## Acceptance Criteria
```
□ Hierarchy: Org → Team → Project → Agent all enforced independently
□ Alerts fire within 60 seconds of threshold breach
□ Auto-downgrade happens within same request (no dropped calls)
□ Hard stop returns HTTP 429 with reset_at timestamp
□ Loop detection kills within 5 seconds of breach
□ Policy engine evaluates <1ms per request
□ Audit log append-only, hash-chained
```
- [ ] Hard stop JSON: `{"error": "budget_exceeded", "budget_id": "...", "utilization": "100%", "reset_at": "..."}`
- [ ] Forecast within 15% accuracy over 2-week test vs actual
- [ ] Budget API RBAC — only admins modify Org budgets
- [ ] Burndown real-time

## Definition of Done
- [ ] E2E scenario: 90% → auto-downgrade → 100% → hard stop → alert → admin raises budget via API → traffic resumes
- [ ] Policy test suite: 50+ rules (model access, PII redaction, token limits, time-of-day)
- [ ] Compliance docs: what is logged, retention, purge procedure

## Pitch
8. **The $10K Surprise Bill:** "One runaway loop Friday night. $10K by Monday. AgentLedger would have killed it in 5s."
9. **Budget Demo:** Live burndown with auto-downgrade triggering real-time

## Who You Tell
- Series A–C engineering leads (budget accountability)
- Direct outreach: "Do you know which agent is eating your AI budget?"
- Enterprise pilots: banks, healthcare, SaaS multi-team. Target 3-5 paid pilots. See [11-gtm-timeline](./11-gtm-timeline.md).

## Through Line
> Phase 4 → "I set a budget and it actually enforced itself"

## Implementation Status
- Backend NEW: internal/enforce/ (budget hierarchy + Store, webhook/Slack/email dispatcher with per-window dedupe, string-tier downgrader, 429 hard-stop JSON, YAML policy engine <1ms with PII redact + fail-closed, chain tracker depth/tokens/window, linear+seasonal forecast + burndown, hash-chained audit, RBAC CRUD API, PreCheck middleware + Observe hook).
- Fixes by integrator: NewDispatcher now stores senders (was dropping all alerts), hasMiniToken token-split (geMINI false-positive fixed; o3-mini still simple per test), marketing o1/O1 expectations corrected to deny (exact case-insensitive; dated/prefixed still allow), inverted fail-closed assertion, AddTokens creates depth-0 state for Observe-only flow with kill deferred to tracked chains.
- Results: full package green (was 6 failures), 53-case policy suite passes.
- DB: db/migrations/002_budgets.sql (budgets/policies/append-only audit_log). Frontend: dashboard/components/budget-panel.tsx (Recharts burndown + utilization + forecast).
- Wiring: PreCheck replaces EnforceStub + Observe() post-response call. E2E scenario (90%→downgrade→100%→429→raise→resume) covered by tests.

## Implementation Status (ship-track: budgets+policies pages live + E2E proof, 2026-09-20)
- Pages LIVE: `app/(app)/budgets/page.tsx` rewritten (client, `use-budgets?history=1`, skeletons, Org→Team→Project→Agent forest, inspect→`BudgetPanel` burndown from `history14d`, forecast headline, 14-day history bars, alerts log from `/api/alerts`, create/raise-via-API/delete with RBAC-friendly errors, `.mono` money). `app/(app)/policies/page.tsx` rewritten (client, live list, create/edit form → YAML via `buildPolicyYAML`, hot-apply toast, fail-closed PII banner when zero rules, engine reachability banner).
- NEW: `app/api/policies/route.ts` (PG-first + Go `/v1/policies` mirror, `proxySynced:false` on mirror miss, `(name,team)` Go-ID matching so no schema change; kind/summary derived server-side), `lib/hooks/use-policies.ts` (self-contained fetch — `lib/api-ext.ts` untouched per ownership).
- E2E proof (live, transcript below; test rows purged, both planes empty after): create `team:e2e-proof` $10 → Go mirror OK → $9 spend = 90% `downgrade`, thresholds [50,75,90] → $10.50 = 105% `hard_stop`, thresholds [50,75,90,100] → alert routing `alert-1` registered on Go → PUT raise $10→$100 (Go mirror DollarLimit=100) → state `ok` 10.5% resume → policy `e2e-deny-frontier` created, engine-accepted (`proxyId pol-1`) → all purged (PG budgets/policies/request_logs 0 rows; Go budgets/policies/alerts `[]`).
- 429/downgrade wire proof: `TestPreCheckHardStop429Shape` + `TestPreCheckDowngradeRewritesModel` PASS live; 429 body `{"error":"budget_exceeded","budget_id":"...","utilization":"100%","reset_at":"..."}` matches DoD. Caveat: live data plane is still `EnforceStub` (mirror-owned `cmd/proxy/main.go`), so downgrade-rewrite/429 fire only under real `PreCheck` wiring — dashboard-observed states are the live signal until that lands.
- Wiring notes for owners (not fixed — out of my files): (1) `/api/alerts` derived warnings read `budgets.spent_usd` (persisted counters, 0 in dashboard flow) not `request_logs`, so no derived alert fired during the proof and the log stayed empty; consider deriving from `request_logs` like `/api/budgets`. (2) Nothing appends dashboard budget/policy writes to PG `audit_log` (Go in-memory chain only). (3) PG `budgets.reset_at` defaults to `now()` (= window start) while Go computes real window bounds — forecast reads odd until aligned.
- Verify: `npx tsc --noEmit` clean; `GET /api/budgets|policies|alerts` 200; Go plane `budgets/policies/alerts` all `[]` post-purge.
