# 06 — Phase 3: "The Router" (Week 6-9)

> Prev: [05-phase-2-saver](./05-phase-2-saver.md) | Parent: [00-index](./00-index.md) | Next: [07-phase-4-enforcer](./07-phase-4-enforcer.md)

### *Pitch: "Why pay frontier prices for tasks that don't need a frontier model?"*
### *Old pitch preserved: "Why send a $10/M-token request to GPT-5.5 when Gemini Flash does it for $0.75?"*
### *Pitch line: "Simple task, cheap model. Complex task, frontier model. Automatic."*

## The Problem You're Solving
Per-token inference cost has fallen roughly 10x per year for three years, and bills keep going up anyway because volume outruns price curve. Spread between cheapest and most expensive is enormous — model tiering that routes simple queries to cheaper models can save up to ~85%, and broader FinOps-for-LLM typically delivers 38–68% cost reduction.

Price reality preserved: bill $4.80 → $0.20, 24x spread on identical work before batching. Batch-eligible overnight queue: Gemini 2.5 Flash at 33 cents. For summarization inside margin of error, worth thousands/mo at scale.

## What You Ship
Intelligent model routing that picks the cheapest model that meets quality requirements.

```
✓ Task classifier          →  simple / moderate / complex / frontier
✓ Model tier map           →  configurable: task type → model
✓ Quality guard            →  auto-escalate if quality drops below threshold
✓ A/B routing              →  split traffic, compare cost-per-quality
✓ Fallback chain           →  if model A fails → model B → model C
✓ Batch routing            →  non-urgent jobs → batch API (50% discount)
✓ Live price feed          →  auto-updated registry, all providers
✓ Routing analytics        →  model distribution, cost saved, escalation rate
```

## User Story
> *As a platform team, I want AgentLedger to automatically route simple classification tasks to cheap models and complex reasoning tasks to frontier models, so I get same quality at 40-70% lower cost.*

## Tasks

| # | Task | Output | Time |
|---|------|--------|------|
| 3.1 | **Task classifier** — lightweight classifier (rules-based v1, then ML v2) categorizing complexity: simple / moderate / complex / frontier | Routing brain | 3 days |
| 3.2 | **Model tier mapping** — configurable tiers: `simple → Gemini Flash ($0.75/M)`, `moderate → Claude Haiku ($0.80/M)`, `complex → Claude Sonnet ($3/M)`, `frontier → frontier` | Cost tiers | 1 day |
| 3.3 | **Quality-aware routing / guard** — after routing to cheaper model, compare output quality (lightweight eval) vs baseline; auto-escalate if below threshold | Quality guarantee | 3 days |
| 3.4 | **Routing rules engine** — YAML/JSON config: `if agent_id == "support_bot" AND task_type == "faq" → route to cheapest` | Team control | 2 days |
| 3.5 | **A/B routing** — split traffic X% to A, Y% to B, compare cost-per-quality | Data-driven | 2 days |
| 3.6 | **Fallback chain** — if primary fails/timeout, cascade (e.g. `Claude Sonnet → GPT-5.6 Terra → Gemini Pro`) | Reliability | 1 day |
| 3.7 | **Routing analytics** — model distribution pie, cost saved, quality score per model, escalation rate | Proof | 2 days |
| 3.8 | **Batch API routing** — detect non-urgent requests (configurable tag), queue for batch processing (50% discount, hours not seconds) | Batch discount | 2 days |
| 3.9 | **Live price feed** — auto-update pricing from provider APIs or curated registry | Always-current | 1 day |

## Acceptance Criteria
```
□ Classifier: >85% accuracy on 500-prompt test suite
□ Routing reduces cost >40% vs. always-frontier baseline
□ Quality score drops <5% (LLM-as-judge)
□ Escalation rate <10% (cheap → expensive retries)
□ Fallback triggers within 2 seconds of primary failure
□ Rules hot-reloadable — no proxy restart needed
```
- [ ] A/B statistically significant within 1000 requests
- [ ] Batch queues eligible, delivers via webhook/polling
- [ ] Dashboard: "You would have spent $X. You spent $Y. Saved $Z (N%)."

## Definition of Done
- [ ] Benchmark: 10,000 mixed requests, measured savings + quality retention
- [ ] 3 routing strategies documented: cost-first, quality-first, balanced
- [ ] Blog: "How intelligent routing cut our LLM bill by 60% without losing quality" / "Routing cut our bill by 60% with no quality drop"

## Pitch (investor slide)
6. **The 640x Spread:** Output tokens $0.28/M to $180/M — ~640-fold spread.
7. **Your Routing:** "We exploit that spread automatically. Same quality. 40-70% less cost."

## Who You Tell
- Teams with mixed workloads (classification + reasoning + summarization)
- Product Hunt launch — routing decisions live demo
- Integrations: LangChain callback, CrewAI plugin, Nasiko plugin. See [11-gtm-timeline](./11-gtm-timeline.md).

## Through Line
> Phase 3 → "I cut my bill in half without touching my agents"

## Implementation Status
- Backend NEW: internal/router/ (classifier rules-v1 + ML stub, tiers DefaultTierMap + cost/balanced/quality strategies + Savings math, HeuristicJudge + Guard with <10% escalation budget, YAML/JSON rules engine with hot-reload + <1ms eval, A/B z-test split, fallback chain <2s, batch queue + webhook dispatcher) + internal/pricing/feed.go (atomic-swap live feed, polling).
- Fixes by integrator: composite-literal-if parens (2 test files), task_type proof/research/theorem/frontier + frontier-keyword floor at complex, catch-all fixture priority 99→1 (matches file convention; priority-first semantics kept).
- Results: full package green, classifier 98.0% on 500 suite (490/500; 10 misses are the documented adversarial short-hard taskType="" prompts), hint test passes, mixed-workload savings test passes.
- Frontend: dashboard/components/routing-panel.tsx (zero-dep conic pie, X/Y/Z savings, quality, escalation vs 10%).
- Wiring: replace RouteStub — skip on cache HIT, InputFromRequest → Decide → rewrite model + X-AgentLedger-Route/Tier/Complexity headers.
- Needed deps (listed, not installed): none for v1 (stdlib). 10k benchmark plan documented in spec.
