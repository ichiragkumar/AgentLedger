# 12 — Competitive Positioning

> Prev: [11-gtm-timeline](./11-gtm-timeline.md) | Parent: [00-index](./00-index.md) | Next: [13-metrics-risks-next-actions](./13-metrics-risks-next-actions.md)

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
2. **Full-loop FinOps** (observe → cache → route → enforce → attribute → correlate ROI) — everyone else does 1-2
3. **Helicone replacement timing** — 16K orgs need new home RIGHT NOW

### Risk Note on Portkey
Portkey has stated core enterprise gateway is merging into open-source as Gateway 2.0. That release is pre-release at time of writing. Do not plan around Gateway 2.0 capabilities as shipped and stable.
