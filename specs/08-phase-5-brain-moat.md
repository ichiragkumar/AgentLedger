# 08 — Phase 5: "The Brain" (Week 14-18) — THE MOAT

> Prev: [07-phase-4-enforcer](./07-phase-4-enforcer.md) | Parent: [00-index](./00-index.md) | Next: [09-phase-6-business-enterprise](./09-phase-6-business-enterprise.md)

### *Pitch: "The only proxy that understands your agent swarm topology."*

## What You Ship
Agent-topology-aware routing — the feature nobody else has.

## The Insight
Current routers make per-request decisions in isolation. But in multi-agent systems:

A single user request can now trigger several model calls across planning, tool use, validation, response generation. Research on agentic coding tasks found agents can consume far more tokens than code chat/reasoning, with large variation between runs. This makes cost management harder than traditional cloud budgeting.

**AgentLedger learns the agent graph and optimizes total workflow cost, not individual call cost.**

## User Story
> *As a team running a 7-agent pipeline (planner → researcher → writer → reviewer → formatter → QA → publisher), I want AgentLedger to know that if the planner uses a cheap model and fails, ALL downstream tokens are wasted — so planner gets frontier, formatter gets cheapest.*

## Tasks

| # | Task | Output | Time |
|---|------|--------|------|
| 5.1 | **Agent graph discovery** — auto-detect chains from `X-Request-Chain-Id` + `X-Parent-Agent-Id`, build directed graph | Topology map | 3 days |
| 5.2 | **Step criticality scoring** — ML scoring each step: position in chain, downstream cost if fails, historical failure rate | Intelligence | 5 days |
| 5.3 | **Topology-aware routing** — high-criticality → frontier, low-criticality → cheap, based on graph position | Smart routing | 3 days |
| 5.4 | **Workflow cost optimizer** — given graph + quality constraints, compute optimal per-step model assignment minimizing total expected cost (incl. retry) | Optimizer | 5 days |
| 5.5 | **Workflow dashboard** — visual graph with per-step cost, model, quality, failure rate | Visualization | 3 days |
| 5.6 | **Learning loop** — continuously update criticality based on actual outcomes | Gets smarter | 3 days |
| 5.7 | **ROI attribution** — correlate workflow token cost vs business outcome (webhook, status code, custom metric) | Business value | 3 days |

## Acceptance Criteria
- [ ] Graph auto-discovered with >95% accuracy (correct parent-child)
- [ ] Criticality scoring identifies "if this fails, downstream cost $X" within 20% accuracy
- [ ] Topology-aware routing reduces total workflow cost >25% vs uniform assignment
- [ ] Optimizer within 10% of theoretical optimal (brute-force on small graphs)
- [ ] Dashboard renders graph <1s for up to 20 agents
- [ ] Learning loop improves routing measurably (>5% reduction) within 7 days prod data
- [ ] ROI attribution shows "this workflow cost $2.30 and generated $45" for configured metrics

## Definition of Done
- [ ] Case study: real multi-agent workflow, measured cost before/after
- [ ] Paper/blog: "Why per-request routing is broken for agent swarms — and what to do about it"
- [ ] Document algorithm for topology-aware cost optimization (patent-worthy?)

## Pitch (differentiator)
10. **"Every other proxy sees individual requests. We see the forest."**
11. Demo: Agent graph visualization with live cost optimization real-time
