# 08 — Phase 5: "The Brain" (Week 14-18) — THE MOAT

> Prev: [07-phase-4-enforcer](./07-phase-4-enforcer.md) | Parent: [00-index](./00-index.md) | Next: [09-phase-6-business-enterprise](./09-phase-6-business-enterprise.md)

### *Pitch: "Every other proxy sees requests. We see your agent swarm."*
### *Pitch line: "We don't optimize your requests. We optimize your workflows."*

## The Problem You're Solving
A single user request can trigger planning, tool selection, execution, verification, and response generation, easily consuming 5x the token budget of a direct chat completion. Current routers optimize individual calls. Nobody optimizes the full workflow. If the planner agent uses a cheap model and fails, every downstream agent's tokens are wasted. That's the problem.

Preserved research: agentic coding tasks consume far more tokens than code chat/reasoning, large variation between runs. Harder than traditional cloud budgeting.

**AgentLedger learns the agent graph and optimizes total workflow cost, not individual call cost.**

## What You Ship
Agent-topology-aware routing — the feature nobody else has.

```
✓ Agent graph discovery    →  auto-build from X-Request-Chain-Id headers
✓ Step criticality score   →  ML model: how expensive is failure here?
✓ Topology-aware routing   →  high-stakes step = better model
✓                             low-stakes step = cheapest model
✓ Workflow cost optimizer  →  minimize total workflow cost, not per-call
✓ Learning loop            →  routing improves from actual outcomes
✓ ROI correlation          →  token cost vs. business outcome
✓ Agent graph dashboard    →  visual topology, per-step cost live
```

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

## The Moat
Unlike cloud compute, token optimization requires constant quality validation to ensure cost-cutting doesn't degrade output. **Token yield rate is the validation metric: if yield stays constant while cost drops, the optimization is working.** We track this at the workflow level, not the request level. Nobody else does.

## Acceptance Criteria
```
□ Agent graph correct with >95% accuracy from headers
□ Topology routing reduces total workflow cost >25% vs. uniform assignment
□ Workflow optimizer within 10% of theoretical optimal (small graphs)
□ Learning loop improves decisions >5% within 7 days
□ ROI correlation: cost per workflow tied to business outcome signal
□ Graph renders in <1s for up to 20-agent topologies
```
- [ ] Criticality "if this fails, downstream cost $X" within 20% accuracy
- [ ] ROI: "this workflow cost $2.30 and generated $45"

## Definition of Done
- [ ] Case study: real multi-agent workflow, measured cost before/after
- [ ] Paper/blog: "Why per-request routing is broken for agent swarms — and what to do about it"
- [ ] Document algorithm for topology-aware cost optimization (patent-worthy?)

## Pitch (differentiator)
10. **"Every other proxy sees individual requests. We see the forest."**
11. Demo: Agent graph visualization with live cost optimization real-time

## Through Line
> Phase 5 → "AgentLedger knows my workflow better than I do"

## Implementation Status

> Built by ledger-brain. Serving path is pure Go (`internal/brain`); ML
> offline allowed as weight pushes via `SetWeights`. Router extended, never
> forked (string model names, no import cycles). Enforcer budgets are hard
> caps in `OptimizeWithBudget`. Input is Postgres logger rows + attribution
> headers — no new headers, no proxy changes.

Files: `internal/brain/graph.go` (discovery), `criticality.go` (scoring),
`optimizer.go` (assignment), `learner.go` (EWMA loop), `roi.go`
(cost↔value), `yield.go` (moat metric), `graph_test.go`,
`optimizer_test.go`, `brain_test.go` (>80% on graph+optimizer, brute-force
comparison), `db/migrations/003_brain.sql`
(`workflow_graphs`, `step_stats`, `roi_signals`),
`dashboard/components/topology-panel.tsx` (pure SVG, <1s at 20 nodes).

Verification: `go vet ./internal/brain/...` clean; `go test
./internal/brain/...` green (incl. 50-trial randomized optimizer fuzz vs
brute force, 25.7% fixture savings vs uniform-frontier).

### Why per-request routing is broken (algorithm doc stub)

A per-call router minimizes each request's cost × quality in isolation. A
7-agent pipeline is not 7 independent requests — it is one bet where an
early failure discards every downstream dollar. Formally, Brain minimizes
`E_total = Σ c_i + Σ p_i·(c_i + downstream(i))` while per-call routing
minimizes each `c_i` alone, i.e. it prices `p_i·downstream(i)` at zero.
Consequence: a cheap planner that passes the quality floor (q 0.85 ≥ 0.80)
gets picked, fails 70% of the time, and re-burns $1.52 downstream — total
$2.82 vs $2.07 for frontier-plan + cheap-leaf. Per-request routing is
provably blind to exactly the term that dominates workflow spend. Fix:
score criticality (position + downstream waste + failure rate), assign
frontier only where failure is expensive, cheapest where it is not.

### Case-study plan (real multi-agent pipeline, before/after)

1. Instrument a 7-agent pipeline (planner → researcher → writer → reviewer
   → formatter → QA → publisher) with `X-Request-Chain-Id` /
   `X-Parent-Agent-Id`; run 1 week uniform-frontier (baseline $/workflow).
2. Enable Brain optimization; run 1 week; measure $/workflow, yield rate,
   waste-prediction error (<20%), learning delta (+5% target).
3. Publish: cost before/after, per-step model map, yield-flat proof,
   "cost $2.30 → $45 value" ROI anecdote. Blog: "Why per-request routing
   is broken for agent swarms — and what to do about it."
