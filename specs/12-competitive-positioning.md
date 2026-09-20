# 12 — Competitive Positioning

> Prev: [11-gtm-timeline](./11-gtm-timeline.md) | Parent: [00-index](./00-index.md) | Next: [13-metrics-risks-next-actions](./13-metrics-risks-next-actions.md)

## THE COMPETITIVE GAP (One Table)
The token optimization market in 2026 is less "which is the best tool" and more "which surface of your AI spend are you trying to optimize." Nobody owns all four surfaces. We do.

| Capability | Portkey | LiteLLM | Langfuse | Bifrost | **AgentLedger** |
|-----------|---------|---------|----------|---------|-----------------|
| Observe + attribute | ✅ | 🟡 | ✅ | ✅ | ✅ |
| Semantic caching | ✅ | 🟡 | ❌ | ✅ | ✅ |
| Intelligent routing | 🟡 | ❌ | ❌ | ✅ | ✅ |
| Budget enforcement | 🟡 | ✅ | ❌ | 🟡 | ✅ |
| Topology-aware routing | ❌ | ❌ | ❌ | ❌ | ✅ **ONLY US** |
| Workflow cost optimizer | ❌ | ❌ | ❌ | ❌ | ✅ **ONLY US** |
| ROI correlation | ❌ | ❌ | ❌ | ❌ | ✅ **ONLY US** |
| Written in Go | ❌ | ❌ | ❌ | ✅ | ✅ |
| Open source | ✅ | ✅ | ✅ | ✅ | ✅ |

Market splits into four lanes: gateways, routers, observability tools, endpoint optimizers. Nobody owns all four. We do — in one proxy.

## Extended Matrix (preserved, with Tokonomics)

| Feature | AgentLedger | Portkey | Bifrost | LiteLLM | Langfuse | Tokonomics |
|---------|-------------|---------|---------|---------|----------|------------|
| OpenAI-compatible proxy | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Cost attribution (agent/team/project) | ✅ Deep | ✅ Basic | 🟡 | 🟡 | ✅ | ✅ |
| Semantic caching | ✅ | ✅ | ✅ | 🟡 | ❌ | ❌ |
| Intelligent model routing | ✅ | 🟡 | ✅ | ❌ | ❌ | ❌ |
| Budget enforcement (hard stop) | ✅ | 🟡 | 🟡 | ✅ | ❌ | ✅ |
| **Topology-aware routing** | ✅ **UNIQUE** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Workflow cost optimization** | ✅ **UNIQUE** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **ROI correlation** | ✅ **UNIQUE** | ❌ | ❌ | ❌ | ❌ | ❌ |
| Runaway loop detection | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Open source | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Self-hosted | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Enterprise (SSO/SOC2) | Phase 6 | ✅ | Enterprise | ❌ | ❌ | ❌ |
| **Written in Go (perf)** | ✅ | ❌ (Node) | ✅ | ❌ (Python) | ❌ | ❌ |

### Unique Moats
1. **Topology-aware routing** — nobody has this
2. **Full-loop FinOps / TokenOps** (observe → cache → route → enforce → attribute → correlate ROI) — everyone else does 1-2
3. **Helicone replacement timing** — 16K orgs need new home RIGHT NOW + Portkey uncertainty post-Palo Alto acquisition
4. **Token yield rate at workflow level** — if yield stays constant while cost drops, optimization works. Tracked at workflow, not request. Nobody else does.

### Risk Notes
- Portkey core enterprise gateway merging into open-source as Gateway 2.0 — pre-release at time of writing. Do not plan around it as shipped/stable.
- Portkey AI Gateway acquired by Palo Alto Networks (May 2026), creating uncertainty for users.
- Helicone in maintenance mode post-Mintlify (March 3, 2026).
