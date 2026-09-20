# AgentLedger — Spec Index

> Full shipping plan: observe → optimize → enforce → attribute. Start here.
> **AgentLedger is an open-source TokenOps control plane.** One env var. Nothing else changes.

## Master Prompt (canonical, see 01)
> Observe every token dollar by agent/team/project. Cache semantically. Route intelligently. Enforce hard budgets, policies, runaway kill. Gateways, routers, observability, endpoint optimizers — nobody owns all four. We do — Go, sub-ms overhead. TokenOps is FinOps for tokens. We don't show the bill, we cut it.

## Map

| # | File | Title | Phase |
|---|------|-------|-------|
| 01 | [01-vision-market-reality](./01-vision-market-reality.md) | Vision & Market Reality + Master Prompt + TokenOps | Why NOW, thesis, North Star |
| 02 | [02-architecture-tech-stack](./02-architecture-tech-stack.md) | Architecture & Tech Stack | Detailed diagram + Next.js 15 stack |
| 03 | [03-phase-0-foundation](./03-phase-0-foundation.md) | Phase 0: Foundation | Week 0, Day 1-3 (prequel) |
| 04 | [04-phase-1-mirror](./04-phase-1-mirror.md) | Phase 1: The Mirror (Observe) | Week 1-2 — See it all — SHIP → HN |
| 05 | [05-phase-2-saver](./05-phase-2-saver.md) | Phase 2: The Saver (Cache) | Week 3-5 — Stop paying twice — SHIP → Blog |
| 06 | [06-phase-3-router](./06-phase-3-router.md) | Phase 3: The Router (Optimize) | Week 6-9 — Right model, right price — SHIP → PH |
| 07 | [07-phase-4-enforcer](./07-phase-4-enforcer.md) | Phase 4: The Enforcer (Budgets) | Week 10-13 — Never blow budget — Enterprise outreach |
| 08 | [08-phase-5-brain-moat](./08-phase-5-brain-moat.md) | Phase 5: The Brain (Moat) | Week 14-18 — See the swarm — Case study |
| 09 | [09-phase-6-business-enterprise](./09-phase-6-business-enterprise.md) | Phase 6: The Business (Enterprise) | Week 19-24 — Cloud launch (sequel) |
| 10 | [10-pricing-model](./10-pricing-model.md) | Pricing Model | OSS / $49 / $199 / Custom |
| 11 | [11-gtm-timeline](./11-gtm-timeline.md) | GTM + Timeline + Through Line | 18-week journey + 24-week with 0/6 |
| 12 | [12-competitive-positioning](./12-competitive-positioning.md) | Competitive Positioning | 4-lane gap, moats, yield rate |
| 13 | [13-metrics-risks-next-actions](./13-metrics-risks-next-actions.md) | Metrics, Risks & Next Actions | Targets + Monday list |
| 14 | [14-dashboard-frontend](./14-dashboard-frontend.md) | Dashboard Frontend (Next.js App Router) | CNA scaffold, panels, run |

## Full Product Journey
```
PHASE 1          PHASE 2          PHASE 3          PHASE 4          PHASE 5
"The Mirror"  →  "The Saver"   →  "The Router"  →  "The Enforcer" → "The Brain"
Week 1–2         Week 3–5         Week 6–9         Week 10–13       Week 14–18
See it all.      Stop paying      Right model,     Never blow       See the swarm,
                 twice.           right price.     budget again.    not the request.
```
Phase 0 = prequel (bones). Phase 6 = sequel (enterprise/cloud). Core journey = 1-5.

## Reading Order
`01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 13 → 14`

## Database
**PostgreSQL 16** (Compose service `postgres`, DB `agentledger`). All persistence lives here: `request_logs` (spec 04 + migration 001 views), budgets/policies/`audit_log` (migration 002), `workflow_graphs`/`step_stats`/`roi_signals` (migration 003). Redis = exact cache, Qdrant = semantic vectors (both cache-only, no system-of-record data).

## Naming Convention
`NN-kebab-case.md` — zero-padded sequence, kebab-case slug. Index is `00-index.md` (this file).
