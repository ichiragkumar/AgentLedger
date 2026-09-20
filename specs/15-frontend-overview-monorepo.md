# 15 — Frontend Overview: Monorepo, Journey & Integrations

> Prev: [14-dashboard-frontend](./14-dashboard-frontend.md) | Parent: [00-index](./00-index.md) | Next: [16-frontend-landing](./16-frontend-landing.md)

Note: requested as `01-product-overview.md`; indexed here as `15` because `01` is taken by the vision spec. This file is the entry point of the frontend plan (specs 15–18).

## Product Overview
AgentLedger ships TWO Next.js surfaces plus one Go proxy:
1. **`apps/web`** — marketing site (Vercel): landing, pricing, docs (MDX), blog, changelog, waitlist.
2. **`apps/dashboard`** — product dashboard (Docker, self-hosted): auth → onboarding → overview/agents/cache/routing/budgets/policies/keys/requests/topology/settings.
3. **Proxy (`cmd/proxy`, Go)** — data plane both surfaces read through (dashboard) or pitch (web live demo).

`apps/web` is public and ungated. `apps/dashboard` is authenticated (NextAuth v5) and reads Postgres directly via Route Handlers.

## Target Monorepo Tree

```
agentledger/
├── apps/
│   ├── web/                          ← Marketing site (Vercel)
│   │   ├── app/
│   │   │   ├── layout.tsx            ← Root layout + ThemeProvider
│   │   │   ├── page.tsx              ← Landing page
│   │   │   ├── pricing/page.tsx
│   │   │   ├── docs/layout.tsx + [[...slug]]/page.tsx   ← MDX docs
│   │   │   ├── blog/page.tsx + [slug]/page.tsx
│   │   │   ├── changelog/page.tsx
│   │   │   └── waitlist/page.tsx
│   │   ├── components/
│   │   │   ├── landing/              ← navbar, hero, social-proof-bar, problem,
│   │   │   │                           how-it-works, features-bento, live-demo,
│   │   │   │                           product-journey, numbers, pricing,
│   │   │   │                           open-source, faq, cta, footer
│   │   │   ├── ui/                   ← shadcn components (raw, never modify)
│   │   │   └── shared/               ← theme-toggle, logo, typewriter
│   │   └── lib/                      ← fonts.ts, utils.ts, metadata.ts
│   └── dashboard/                    ← Product dashboard (Docker)
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── (auth)/login + /signup
│       │   └── (app)/                ← Authenticated shell (sidebar + topbar)
│       │       ├── overview, agents (+[id]), cache, routing, budgets,
│       │       │   policies, topology, keys, requests, settings
│       ├── components/
│       │   ├── layout/ (sidebar, topbar, breadcrumb)
│       │   ├── charts/ (cost-over-time, spend-by-model/agent, cache-hit-rate,
│       │   │           budget-burndown, model-distribution, topology-graph)
│       │   ├── tables/ (request-log, agents-table, budget-table)
│       │   ├── cards/ (stat-card, agent-card, alert-card)
│       │   └── ui/                   ← shadcn components
│       └── lib/
│           ├── api.ts                ← Typed API client
│           ├── hooks/ (use-overview, use-agents, use-cache, use-budgets, use-realtime SSE)
│           └── stores/ (filter.store, dashboard.store)
├── packages/
│   ├── ui/                           ← Shared UI primitives
│   ├── types/src/ (agent.ts, cost.ts, budget.ts, cache.ts, api.ts)
│   └── config/ (tailwind, eslint, typescript)
├── turbo.json
├── package.json
└── docker-compose.yml
```

Migration note: today's `dashboard/` (spec 14, live on :3000) becomes `apps/dashboard/` during the monorepo migration. Until then it is the pre-monorepo home — see AGENTS.md.

## Full-Stack Data Flow
```
Browser → apps/dashboard Route Handlers → Postgres 16 (system of record)
        → Go proxy :8787 (management actions: keys, budgets, purge, rules reload)
        → SSE stream (alerts, live request feed)
apps/web → GitHub API (stars, ISR 60s) · /api/stats (aggregate, cached) · seeded mock data (live demo)
```

## Product Journey (marketing ↔ builds)
| # | Name | Status | Tagline |
|---|------|--------|---------|
| 01 | The Mirror | ✅ LIVE | "See every dollar" |
| 02 | The Saver | ✅ LIVE | "Stop paying twice" |
| 03 | The Router | 🔵 BETA | "Right model, right price" |
| 04 | The Enforcer | 🟡 Building | "Never blow budget again" |
| 05 | The Brain | ⚪ Planned (Q4 2026) | "See the swarm, not the request" |
| 06 | The Business | ⚪ Planned (2027) | "Enterprise ready" |

Journey rules (spec 16 §08): interactive timeline, click-to-expand cards, auto-cycle 5s until interaction, keyboard arrows, "Coming" phases show dates not TBD.

## Integrations
| Integration | Surface | Notes |
|---|---|---|
| GitHub API (stars) | web navbar, hero, open-source, topology page | ISR, 60s revalidate, cached |
| Postgres 16 | dashboard Route Handlers | `lib/db.ts` pattern (pool + idempotent schema) |
| Go proxy management plane | dashboard (keys, budgets, purge, rules) | typed client in `lib/api.ts` |
| SSE realtime | dashboard alerts + request feed | `use-realtime` hook, 60s bound |
| NextAuth v5 | dashboard auth | GitHub OAuth → email → SSO (Phase 6) |
| MDX docs/blog | web docs + blog + changelog | `[[...slug]]` + `[slug]` routes |
| Calendly/email | web enterprise CTA | link-out, no custom form |
| Analytics (deferred) | web numbers section | `/api/stats` public endpoint, cached |

## Pricing (single source of truth — web + docs must match)
Free $0 (OSS, 1 team, 500K logs, community) · Pro $49/mo (unlimited teams, routing, enforcement, 5M logs, email) · Enterprise Custom (SSO+SOC2, self-hosted, SLA, white-label). Annual −20%.

## Frontend Agent Roster (specs 15–18 owners)
| Agent | Owns |
|---|---|
| `ledger-web-landing` | `apps/web` landing sections + live demo (spec 16) |
| `ledger-web-dashboard` | `apps/dashboard` pages + sidebar/topbar (spec 17) |
| `ledger-web-system` | design tokens, shadcn `ui/primitives/blocks`, `packages/ui|types|config` (spec 18) |
| `ledger-web-backend` | Route Handlers, auth/onboarding, keys API, SSE, DB wiring (specs 14, 17) |
| `ledger-web-journey` | journey timeline, docs/blog/changelog/waitlist, pricing sync, GitHub/stats integrations (specs 15, 16) |

Monorepo migration (turbo + workspaces + move) is the FIRST build step and belongs to no single agent — coordinator runs it before fanning out.
