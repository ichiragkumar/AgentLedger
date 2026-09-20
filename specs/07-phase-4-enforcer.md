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
