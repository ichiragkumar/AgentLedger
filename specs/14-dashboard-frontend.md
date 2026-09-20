# 14 — Dashboard Frontend (Next.js App Router)

> Prev: [13-metrics-risks-next-actions](./13-metrics-risks-next-actions.md) | Parent: [00-index](./00-index.md)

## Stack (strict)
- Scaffolded with `npx create-next-app@latest` (TypeScript, Tailwind v4, ESLint, App Router, no src-dir, `@/*` alias). Next 16, React 19.
- Charts: Recharts v2. Auth (planned): NextAuth v5 (`next-auth@5.0.0-beta.x`, Auth.js) — GitHub → email → SSO.
- Server Components for data fetching (`app/page.tsx` is `async`, `force-dynamic`); panels are `"use client"` presentational components receiving props.

## Layout
```
dashboard/
  app/
    layout.tsx      # CNA root layout (Geist fonts, globals.css) — title: AgentLedger
    page.tsx        # async Home: spend summary + 4 phase panels (tailwind cards)
    globals.css     # Tailwind v4 (@import "tailwindcss", dark-mode vars)
  lib/api.ts        # fetch helpers vs proxy/API (NEXT_PUBLIC_API_URL, no-store)
  components/
    cache-panel.tsx     # Phase 2: hit %, $ saved, top queries (props-only)
    routing-panel.tsx   # Phase 3: conic distribution pie, X/Y/Z savings, escalation
    budget-panel.tsx    # Phase 4: Recharts burndown + utilization + forecast
    topology-panel.tsx  # Phase 5: pure-SVG agent graph, per-step cost/quality
  package.json / tsconfig.json / next.config.ts / postcss.config.mjs / eslint.config.mjs
  .env.local.example    # NEXT_PUBLIC_API_URL, NEXTAUTH_URL, NEXTAUTH_SECRET
```

## Conventions (all agents must follow)
- App Router only. No `pages/` directory, no plain-CRA patterns.
- New UI = new file under `components/` or `app/`; never rewrite another phase's panel.
- Panels stay props-only (no fetchers inside) so `tsc --noEmit` and tests stay hermetic.
- Path alias `@/*` for imports (`@/components/...`, `@/lib/api`).

## Run
```
cd dashboard && npm install && npm run dev   # http://localhost:3000
npm run build                                 # production check
```
Proxy must be up first (`NEXT_PUBLIC_API_URL`, default http://localhost:8787).

## Data plane (shipped)
- `lib/db.ts` — pg `Pool` + idempotent schema ensure (schema.sql + migrations 001-003). `queryOrNull` degrades to zero-state when PG is down.
- `app/api/spend/route.ts` — 24h/7d/30d sums, by model/agent/team top-10, 14-day daily trend (all from `request_logs`).
- `app/api/requests/route.ts` — top-10 costliest requests.
- `lib/api.ts` — Server Components fetch same-origin `/api/*`; proxy `/health` stays absolute.
- Home page per spec 04 v0.1: 4 stat cards, 14-day AreaChart, by model/agent/team tables (attribution tags visible), top-10 request log, then Cache/Routing/Budget/Topology phase panels.
- Dark/light: class-based toggle (`@custom-variant dark`, localStorage + `prefers-color-scheme` init, no FOUC).
- Hydration: `suppressHydrationWarning` on `<html>`/`<body>` — browser extensions (e.g. Grammarly's `data-gr-ext-installed`) mutate DOM pre-hydration; not an app bug.
- Backend: real Postgres logger (`internal/logger/postgres.go`, pgx/v5 pool, 3s insert timeout, stdout fallback, `PostgresLoggerLiveInsert` integration test). Proven: mock-upstream traffic → rows → `/api/spend` shows spend by model/agent/team + trend.

## Acceptance
- [ ] `npx tsc --noEmit` clean
- [ ] `/` renders 200 with proxy health badge (healthy/unreachable states)
- [ ] Dark/light via `prefers-color-scheme` (globals.css vars)
- [ ] Panels render zero-state (all zeros) without errors before API lands

## Remaining
- `app/api/*` route handlers (spend summary, budgets, audit) backed by Postgres
- NextAuth wiring (GitHub provider first, then email, then SSO per Phase 6)
- Polling/refresh for real-time (<5s) panels
