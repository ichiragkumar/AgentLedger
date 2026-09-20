# 01 — Vision & Market Reality

> Parent: [00-index](./00-index.md) | Next: [02-architecture-tech-stack](./02-architecture-tech-stack.md)

## Product Name: **AgentLedger**
### *"The FinOps proxy for AI agents — observe, optimize, enforce, attribute."*

## THE MASTER PROMPT
*Use this when talking to engineers, investors, designers, or AI tools*

> **AgentLedger is an open-source TokenOps control plane.**
>
> It sits as an OpenAI-compatible proxy between your AI agents and LLM providers. You change one environment variable. Nothing else changes.
>
> From that position it does four things no single tool does today:
> **Observe** every token dollar by agent, team, and project.
> **Cache** semantically — same meaning, one API call.
> **Route** intelligently — right model for the right task, automatically.
> **Enforce** hard budgets, policies, and runaway loop detection.
>
> The market splits into four lanes: gateways, routers, observability tools, and endpoint optimizers. Nobody owns all four. We do — in one proxy, written in Go, with sub-millisecond overhead.
>
> The problem is real and getting worse. Weekly token processing volume on OpenRouter skyrocketed from 0.4 trillion in December 2024 to 27.0 trillion by March 2026 — a nearly 68-fold increase in just 15 months. Token prices dropped approximately 80% between early 2025 and early 2026, yet the relative cost of wasteful token usage remains constant. Bills go up. Nobody knows why.
>
> TokenOps is the operational discipline of applying FinOps principles — visibility, allocation, optimization, and governance — to LLM token consumption. It is FinOps for tokens. AgentLedger is the infrastructure layer that makes TokenOps real.
>
> We are not an observability tool that shows you the bill. We are the layer that cuts it — automatically, continuously, without touching your agent code.

## TL;DR
Token prices fell ~80% between 2025 and 2026, but enterprise AI bills went up. That gap is not a pricing problem — it is a governance problem. AgentLedger sits in the request path between every agent and every LLM provider as the toll booth where all money flows through: observe → cache → route → enforce → attribute → correlate ROI.

## TokenOps Definition
**TokenOps is FinOps for tokens.** Visibility, allocation, optimization, and governance applied to LLM token consumption. AgentLedger is the infrastructure layer that makes TokenOps real — not a dashboard that shows the bill, but the layer that cuts it automatically, continuously, without touching agent code.

## Why NOW

- **Volume explosion:** Weekly token processing on OpenRouter 0.4T (Dec 2024) → 27.0T (Mar 2026) — ~68x in 15 months.
- **Price paradox:** Token prices dropped ~80% early 2025 → early 2026, yet relative cost of waste stays constant. Per-token cost fallen roughly 10x per year for three years, bills keep going up because volume outruns price curve.
- **Spend scale:** Model API spend doubled $3.5B → $8.4B late 2024 → mid-2025; enterprise LLM API spend passed $8.4B in 2025, on track to double. Average inference now **85% of enterprise AI budgets**, **60% of projects exceed estimates by 30-50%**.
- **Cost optimization vs budgeting:** Optimization is about the unit; budgeting is about the envelope. Perfect optimization still blows budget if volume triples. Perfect hierarchy still overpays if routing is naive.
- **Agent multiplier:** Agents make 3–10x more LLM calls than chatbots — planning, tool selection, execution, verification, response generation per user request. Single request easily 5x chat budget. Unconstrained agent: $5–8 per task in API fees alone.
- **Helicone vacuum:** Helicone (16,000+ orgs) in maintenance mode after Mintlify acquisition (March 3, 2026). No active feature dev.
- **Router uncertainty:** Portkey AI Gateway acquired by Palo Alto Networks (May 2026), creating uncertainty. Helicone + Portkey users need a stable home.
- **640x price spread:** Flagship output tokens $0.28/M (DeepSeek V4-Flash) → $180/M (OpenAI gpt-5.5-pro) — ~640-fold. Routing is existential.
- **Core paradox of 2026:** Prices falling while bills explode. Volume outpaces drops.

## North Star
> As AI agents move from prototypes to production workloads, token cost has emerged as a primary engineering constraint. Agents make 3–10x more LLM calls than simple chatbots. **AgentLedger is what you install the day this becomes your problem.**

## Core Thesis
> The proxy is the Trojan horse. Once you're in the request path between every agent and every LLM provider, you own the most valuable position in the AI stack.

## Product Layers (summary)
1. **LAYER 1 — OBSERVE (Phase 1: The Mirror):** Count, Tag, Log, Trace
2. **LAYER 2 — CACHE (Phase 2: The Saver):** Semantic, Exact, TTL — saves 30-60% calls before they happen
3. **LAYER 3 — OPTIMIZE (Phase 3: The Router + Phase 5: The Brain):** Route, Compress, Downgrade, Topology-aware
4. **LAYER 4 — ENFORCE (Phase 4: The Enforcer):** Budgets, Policies, Alerts, Kill
5. **Cross-cutting:** Key Vault (agents never see real API keys), Dashboard (Cost / Agent / Team / ROI)

## Target Users (evolution)
- Phase 1: Indie hackers spending $200–2000/mo ($500+/mo sweet spot), CrewAI/LangGraph/AutoGen users
- Phase 2-3: Startups / small teams, platform teams, support-agent teams
- Phase 4-6: Series B+, VP Eng / FinOps lead / CFO, banks, healthcare, Fortune 500

## Success Definition
See [13-metrics-risks-next-actions](./13-metrics-risks-next-actions.md) for per-phase metrics. North star: aggregate $ saved, % cost reduction (>40%), MRR ($15K+ by Phase 6).
