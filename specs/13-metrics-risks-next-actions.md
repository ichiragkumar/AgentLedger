# 13 — Success Metrics, Risks & Next Actions

> Prev: [12-competitive-positioning](./12-competitive-positioning.md) | Parent: [00-index](./00-index.md)

## THE THROUGH LINE
```
Phase 1  →  "I can finally see where my AI money goes"
Phase 2  →  "I stopped paying for duplicate calls"
Phase 3  →  "I cut my bill in half without touching my agents"
Phase 4  →  "I set a budget and it actually enforced itself"
Phase 5  →  "AgentLedger knows my workflow better than I do"
```
**One proxy. Five stages. Ship the first two weeks. Sell the vision from day one.**

We are not an observability tool that shows you the bill. We are the layer that cuts it — automatically, continuously, without touching your agent code.

## Success Metrics Per Phase

| Phase | Metric | Target |
|-------|--------|--------|
| Phase 1 | GitHub stars | 500+ |
| Phase 1 | Docker pulls | 100+ |
| Phase 1 | Weekly active proxy users | 50+ |
| Phase 2 | Average cache hit rate across users | >30% |
| Phase 2 | Total $ saved for users (aggregate) | $10K+ |
| Phase 3 | Average cost reduction per user | >40% |
| Phase 3 | Paid Pro subscribers | 20+ |
| Phase 4 | Enterprise pilots | 3-5 |
| Phase 4 | MRR | $2K+ |
| Phase 5 | Users with topology-aware routing active | 50+ |
| Phase 6 | MRR | $15K+ |
| Phase 6 | Cloud tenants | 100+ |

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **Portkey ships similar features** | High | High | Ship topology-aware routing first. They're focused on breadth (1600 models), we focus on depth (cost intelligence). Gateway 2.0 pre-release — do not plan as stable. Palo Alto acquisition adds uncertainty for their users = our opening. |
| **Bifrost/Maxim adds FinOps** | Medium | Medium | They're gateway-first. FinOps/TokenOps is our core. Speed advantage. |
| **LLM prices drop so much nobody cares** | Low | High | Prices falling ~10x/year while bills explode is defining paradox of 2026. Volume outpaces drops. $5–8/task at scale is business-critical regardless of unit price. |
| **Adoption is slow** | Medium | Medium | Open-source + Helicone/Portkey migration path. Community-first. |
| **Enterprise sales cycle too long** | High | Medium | Self-serve Pro ($49) funds ops while enterprise closes. |

## What To Do Monday Morning
1. **Create GitHub repo** — `agentledger/agentledger`
2. **Set up Go module** — `go mod init github.com/agentledger/agentledger`
3. **Write README** — name, one-liner, architecture diagram, "coming soon" + master prompt from [01](./01-vision-market-reality.md)
4. **Build Phase 0** — Docker Compose, CI, project structure (Day 1-3)
5. **Start Phase 1.1** — HTTP reverse proxy (Day 4)
6. **Join communities TODAY:** CrewAI Discord, LangChain Discord, r/LocalLLaMA, AI Engineer Slack
7. **Register domains:** `agentledger.io`, `agentledger.dev`

> Ship Phase 1 in 2 weeks. Everything else builds on top.

## Open Question
Go boilerplate for Phase 1, or Next.js dashboard scaffold next? (Next.js 15 + shadcn/ui + NextAuth v5 + Recharts per [02](./02-architecture-tech-stack.md).)
