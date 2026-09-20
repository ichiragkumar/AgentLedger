# AgentLedger — Product Overview
## Prompt. Architecture. Problem. Market.

---

## THE MASTER PROMPT

> AgentLedger is an open-source TokenOps control plane.
>
> It sits as an OpenAI-compatible proxy between your AI agents
> and LLM providers. You change one environment variable.
> Nothing else changes.
>
> From that position it does four things no single tool does today:
> **Observe** every token dollar by agent, team, and project.
> **Cache** semantically — same meaning, one API call.
> **Route** intelligently — right model for the right task, automatically.
> **Enforce** hard budgets, policies, and runaway loop detection.
>
> The market splits into four lanes: gateways, routers,
> observability tools, and endpoint optimizers.
> Nobody owns all four. We do — in one proxy,
> written in Go, with sub-millisecond overhead.
>
> TokenOps is the operational discipline of applying FinOps
> principles — visibility, allocation, optimization, and governance
> — to LLM token consumption.
> AgentLedger is the infrastructure layer that makes TokenOps real.
>
> We are not an observability tool that shows you the bill.
> We are the layer that cuts it — automatically, continuously,
> without touching your agent code.

---

## 5-LINE SUMMARY

AgentLedger is an open-source proxy that sits between
your AI agents and LLM providers.
You change one environment variable and it starts tracking
every token, every cost, every agent.
Most teams are spending thousands monthly on LLM APIs with
no idea which agent, team, or workflow is burning the money.
We fix that — and then cut the bill 40–70% automatically
through caching, smart model routing, and hard budget enforcement.
No code changes. No vendor lock-in. Just a proxy that pays for itself.

---

## THE 10 PROBLEMS IN THE CURRENT MARKET

**1. Bills go up, prices go down — nobody knows why.**
The per-token cost of intelligence has dropped 98% since early 2024,
yet enterprise AI bills are still rising. The driver is volume —
specifically the shift to agentic workflows that trigger
10 to 20 LLM calls per user task.

**2. Agentic AI costs are non-linear and nobody planned for it.**
Agentic workflows consume 5–30x more tokens per task than standard
chat interactions, with multi-agent architectures compounding costs
3–10x beyond initial projections. The first production deployment
is typically a cost shock.

**3. Nobody owns the AI bill.**
In 2025, 60% of AI projects exceeded original cost estimates
by 30–50%. Who owns your AI bill? If the answer is "nobody
specifically," that's why costs are unmanaged.

**4. Finance has no tools built for this.**
Finance leaders are attempting to govern a dynamic,
consumption-based cost model with tools built for static,
license-based procurement. When API access replaced subscriptions
and agents replaced chatbots, the logic broke.

**5. Token spend is invisible by design.**
Visibility into token consumption remains low, with 85% of costs
often obscured by system operations and document retrievals.
AI cost data is scattered across model-provider invoices,
cloud services, SaaS subscriptions, and employee-built agents.

**6. Runaway loops are a real, expensive problem.**
Autonomous agents reason, dispatch sub-agents, search databases,
call external tools, verify results, and retry failed tasks.
Each step consumes tokens. A single misdirected agent can compound
them quickly — looping, re-querying, and chasing dead ends.

**7. Most teams are not using caching.**
Caching is the highest single-lever ROI available today:
90% off cached input tokens on Anthropic, 50% on OpenAI.
Most teams are not using it optimally.

**8. Companies are burning their entire annual AI budget in months.**
By April 2026, companies were describing existential crises:
"We are 3x over our entire 2026 token budget and it's only April."
The conversation has shifted from "go fast" to "we need guardrails."

**9. There is no ROI visibility — just spend.**
Despite AI expenditures shooting up 320% between 2024 and 2026,
less than 20% of enterprise token spending translates to
tangible financial results.

**10. Agentic AI projects are getting killed because of cost, not quality.**
Gartner says 40% of agentic AI projects get canceled by 2027.
None of those is a model problem. They're visibility problems.

---

## ARCHITECTURE