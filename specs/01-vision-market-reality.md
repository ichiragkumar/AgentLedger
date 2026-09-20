# 01 — Vision & Market Reality

> Parent: [00-index](./00-index.md) | Next: [02-architecture-tech-stack](./02-architecture-tech-stack.md)

## Product Name: **AgentLedger**
### *"The FinOps proxy for AI agents — observe, optimize, enforce, attribute."*

## TL;DR
Token prices fell 80% between 2025 and 2026, but enterprise AI bills went up. That gap is not a pricing problem — it is a governance problem. AgentLedger sits in the request path between every agent and every LLM provider as the toll booth where all money flows through: observe → cache → route → enforce → attribute → correlate ROI.

## Why NOW

- Average inference spend now represents **85% of enterprise AI budgets**, and **60% of AI projects exceed original cost estimates by 30-50%**.
- Enterprise LLM API spend passed **$8.4B in 2025** and is on track to double again.
- **Cost optimization is about the unit; token budgeting is about the envelope.** A team can have perfect cost optimization and still blow the monthly budget because volume tripled. A team can have a textbook budget hierarchy and still pay too much per token because routing is naive.
- **Helicone vacuum:** Helicone — the tool 16,000+ organizations used — is now in maintenance mode after the Mintlify acquisition (March 3, 2026). Massive vacuum right now for active observability + FinOps development.
- **640x price spread:** Across seven major providers, flagship-tier output tokens span **$0.28 per million (DeepSeek V4-Flash) to $180 per million (OpenAI's gpt-5.5-pro)** — roughly 640-fold. Routing to the right model for the right task is not an optimization — it's existential.
- **Core paradox of 2026:** Prices falling while bills explode. Volume outpaces price drops. Problem gets bigger, not smaller.

## Core Thesis
> The proxy is the Trojan horse. Once you're in the request path between every agent and every LLM provider, you own the most valuable position in the AI stack.

## Product Layers (summary)
1. **LAYER 1 — OBSERVE (Phase 1: The Mirror):** Count, Tag, Log, Trace
2. **LAYER 2 — CACHE (Phase 2: The Saver):** Semantic, Exact, TTL
3. **LAYER 3 — OPTIMIZE (Phase 3: The Router + Phase 5: The Brain):** Route, Compress, Downgrade, Topology-aware
4. **LAYER 4 — ENFORCE (Phase 4: The Enforcer):** Budgets, Policies, Alerts, Kill
5. **Cross-cutting:** Key Vault (agents never see real API keys), Dashboard (Cost / Agent / Team / ROI)

## Target Users (evolution)
- Phase 1: Indie hackers spending $200–2000/mo, CrewAI/LangGraph/AutoGen users
- Phase 2-3: Startups / small teams, platform teams
- Phase 4-6: Series B+, VP Eng / FinOps lead / CFO, banks, healthcare, Fortune 500

## Success Definition
See [13-metrics-risks-next-actions](./13-metrics-risks-next-actions.md) for per-phase metrics. North star: aggregate $ saved, % cost reduction (>40%), MRR ($15K+ by Phase 6).
