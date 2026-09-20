# 07 — Phase 4: "The Enforcer" (Week 10-13)

> Prev: [06-phase-3-router](./06-phase-3-router.md) | Parent: [00-index](./00-index.md) | Next: [08-phase-5-brain-moat](./08-phase-5-brain-moat.md)

### *Pitch: "The CFO's dashboard for AI spend. Hard budgets. Auto-enforcement."*

## What You Ship
Budget management, policy enforcement, alerting, cost attribution hierarchy.

A FinOps lead at a Series B SaaS company opened a ticket: "How many tokens will the support copilot use in May, and is that within budget?" She didn't get an answer. Three providers, four virtual keys, only forecast was linear extrapolation off last month's invoice, which had blown past plan by 38%.

## User Story
> *As a VP of Engineering, I want to set a $5,000/month budget for the AI team, with sub-budgets per project, and get alerted at 75% / auto-downgrade at 90% / hard-stop at 100%, so we never blow our AI budget again.*

## Tasks

| # | Task | Output | Time |
|---|------|--------|------|
| 4.1 | **Budget hierarchy** — Org → Team → Project → Agent, each with monthly/weekly/daily token & dollar limits | Budget tree | 3 days |
| 4.2 | **Soft alerts** — webhook/email/Slack at 50%, 75%, 90% | Early warning | 2 days |
| 4.3 | **Auto-downgrade** — at 90%, auto-route to cheaper models (configurable) | Graceful degradation | 1.5 days |
| 4.4 | **Hard stop** — at 100%, reject with 429 + clear JSON | Cost ceiling | 1 day |
| 4.5 | **Policy engine** — YAML rules: `deny if model == "gpt-5.5-pro" AND team != "research"`, `redact PII`, `max_tokens_per_request < 4096 for team:marketing` | Governance | 3 days |
| 4.6 | **Runaway loop detection** — track chains via `X-Request-Chain-Id`, kill if depth > N or tokens > threshold in window | Safety net | 2 days |
| 4.7 | **Cost forecasting** — linear + seasonal projection, "at this rate, you'll spend $X by month end" | Predictability | 2 days |
| 4.8 | **Budget dashboard v2** — burndown per team, utilization %, forecast vs budget, overage log | CFO-ready | 2 days |
| 4.9 | **Audit log** — immutable log of budget/policy/enforcement changes | Compliance | 1 day |
| 4.10 | **Budget management API** — CRUD for budgets, policies, alerts | Automation | 1.5 days |

## Acceptance Criteria
- [ ] Hierarchy supports 3+ nesting levels (Org → Team → Project → Agent)
- [ ] Alerts fire within 60s of threshold breach
- [ ] Auto-downgrade switches model within same request (no failed request)
- [ ] Hard stop returns HTTP 429: `{"error": "budget_exceeded", "budget_id": "...", "utilization": "100%", "reset_at": "..."}`
- [ ] Runaway detection kills chain within 5s of breach
- [ ] Policy engine evaluates in <1ms per request
- [ ] Forecast within 15% accuracy over 2-week test vs actual
- [ ] Audit log append-only, tamper-evident (hash chain)
- [ ] Budget API supports RBAC — only admins modify Org budgets
- [ ] Burndown chart updates in real-time

## Definition of Done
- [ ] E2E scenario: 90% → auto-downgrade → 100% → hard stop → alert → admin raises budget via API → traffic resumes
- [ ] Policy test suite: 50+ rules (model access, PII redaction, token limits, time-of-day)
- [ ] Compliance docs: what is logged, retention, purge procedure

## Pitch
8. **The $10K Surprise Bill:** "One runaway loop Friday night. $10K by Monday. AgentLedger would have killed it in 5s."
9. **Budget Demo:** Live burndown with auto-downgrade triggering real-time

## GTM
Enterprise outreach to Series B+ with enforcement demo. Target 3-5 paid pilots. See [11-gtm-timeline](./11-gtm-timeline.md).
