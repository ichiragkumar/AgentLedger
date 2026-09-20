# 06 — Phase 3: "The Router" (Week 6-9)

> Prev: [05-phase-2-saver](./05-phase-2-saver.md) | Parent: [00-index](./00-index.md) | Next: [07-phase-4-enforcer](./07-phase-4-enforcer.md)

### *Pitch: "Why send a $10/M-token request to GPT-5.5 when Gemini Flash does it for $0.75?"*

## What You Ship
Intelligent model routing that picks the cheapest model that meets quality requirements.

## The Price Reality
Bill ranged from $4.80 to $0.20, a 24x spread on identical work, before batching. Once batch-eligible providers moved to overnight queue, Gemini 2.5 Flash landed at 33 cents. For summarization, where quality difference was inside margin of error, that decision is worth thousands per month at scale.

## User Story
> *As a platform team, I want AgentLedger to automatically route simple classification tasks to cheap models and complex reasoning tasks to frontier models, so I get same quality at 40-70% lower cost.*

## Tasks

| # | Task | Output | Time |
|---|------|--------|------|
| 3.1 | **Task classifier** — lightweight classifier (rules-based v1, then ML v2) categorizing complexity: simple / moderate / complex / frontier | Routing brain | 3 days |
| 3.2 | **Model tier mapping** — configurable tiers: `simple → Gemini Flash ($0.75/M)`, `moderate → Claude Haiku ($0.80/M)`, `complex → Claude Sonnet ($2/M)`, `frontier → GPT-5.6 Sol ($5/M)` | Cost tiers | 1 day |
| 3.3 | **Quality-aware routing** — after routing to cheaper model, compare output quality (lightweight eval) vs baseline; auto-escalate if below threshold | Quality guarantee | 3 days |
| 3.4 | **Routing rules engine** — YAML/JSON config: `if agent_id == "support_bot" AND task_type == "faq" → route to cheapest` | Team control | 2 days |
| 3.5 | **A/B routing** — split traffic X% to A, Y% to B, compare cost-per-quality | Data-driven | 2 days |
| 3.6 | **Fallback chain** — if primary fails/timeout, cascade (e.g. `Claude Sonnet → GPT-5.6 Terra → Gemini Pro`) | Reliability | 1 day |
| 3.7 | **Routing analytics** — model distribution pie, cost saved, quality score per model, escalation rate | Proof | 2 days |
| 3.8 | **Batch API routing** — detect non-urgent requests (configurable tag), queue for batch processing | Batch discount | 2 days |
| 3.9 | **Live price feed** — auto-update pricing from provider APIs or curated registry | Always-current | 1 day |

> Batch APIs often come with 50% discount. Trade-off: wait hours not seconds. For high-volume workflows, most effective way to cut bill.

## Acceptance Criteria
- [ ] Classifier >85% accuracy on 500 prompts across 4 complexity levels
- [ ] Routing reduces total cost >40% on mixed workload vs always-frontier
- [ ] Quality score (LLM-as-judge) drops ≤5% vs always-frontier baseline
- [ ] Escalation rate (cheap → expensive retry) <10%
- [ ] Fallback triggers within 2s of primary failure
- [ ] Routing rules hot-reloadable — no proxy restart
- [ ] A/B routing statistically significant within 1000 requests
- [ ] Batch routing queues eligible requests, delivers via webhook/polling
- [ ] Dashboard shows: "You would have spent $X. You spent $Y. Saved $Z (N%)."

## Definition of Done
- [ ] Benchmark: 10,000 mixed requests, measured savings + quality retention
- [ ] 3 routing strategies documented: cost-first, quality-first, balanced
- [ ] Blog: "How intelligent routing cut our LLM bill by 60% without losing quality"

## Pitch (investor slide)
6. **The 640x Spread:** Output tokens $0.28/M to $180/M — ~640-fold spread.
7. **Your Routing:** "We exploit that spread automatically. Same quality. 40-70% less cost."

## GTM
Product Hunt launch with routing demo. Integrations: LangChain callback, CrewAI plugin, Nasiko plugin. See [11-gtm-timeline](./11-gtm-timeline.md).
