# 17 — Frontend Dashboard (`apps/dashboard`)

> Prev: [16-frontend-landing](./16-frontend-landing.md) | Parent: [00-index](./00-index.md) | Next: [18-frontend-design-system](./18-frontend-design-system.md)

Owners: pages/shell `ledger-web-dashboard`; Route Handlers/auth/SSE `ledger-web-backend`. Design tokens: spec 18. Live MVP (single-page, pre-monorepo): spec 14.

## Auth Flow
Landing CTA → `/signup` (GitHub OAuth OR email+password) → 3-step onboarding (1. workspace name, 2. first virtual key — shown ONCE + copy, 3. proxy URL + live connection test with green tick on first request) → `/overview`.
AC: □ ≤3 steps □ skip on all □ 1/3 progress □ return from settings □ key shown once.

## Sidebar (authenticated shell: sidebar + topbar)
Sections MONITOR (Overview, Agents, Requests) · OPTIMIZE (Cache, Routing) · CONTROL (Budgets, Policies, Keys) · ADVANCED (Topology [Phase 5 badge]) · bottom: Settings, Docs, Changelog, avatar, theme toggle. Workspace dropdown on top. Collapsible icon-only; active = primary left border; Phase 5 pages navigable (roadmap screen, not blank); mobile overlay + outside-click close; Tab/Enter keyboard nav; collapse <1024px.

## Overview ("How much, where?")
Greeting + range dropdown (24h/7d/30d/custom). 4 stat cards (Total Spend, Tokens Used, Cache Hit Rate, Saved This Week — each with vs-previous-period trend). Cost-over-time AreaChart stacked by model (≥7 points). Spend-by-agent horizontal bars (top 5 + view-all). Model distribution donut (click slice = filter). Recent alerts (SSE realtime, max 5 + view-all).
AC: □ trends on cards □ stacked area □ top-5 + links □ donut filter □ SSE alerts □ range changes update all □ mount animations □ skeletons □ empty → onboarding guide.

## Agents (+ `[id]` detail)
Table (Name/Spend/Tokens/Requests/Cache/Model): sortable, searchable, paginated 20, empty state guide. Row → detail: scoped cards, 7d timeline, model breakdown, top-10 expandable requests (full prompt/response, PII-redacted when policy active), per-agent cache, budget status, virtual key, Edit/View-Requests/Manage-Budget. Back preserves list state.

## Cache
Cards: Hit Rate (ring) / Saved$ (ROI headline) / Hits / Avg latency. Line chart exact-vs-semantic 7d. Top cached queries (text truncated, agent, hits, savings). Config: threshold slider 0.80–0.99 + TTL input → API save, immediate apply, toast. Flush = confirmation dialog.

## Routing
Status banner ("ACTIVE — saving avg 44%"). Tier config cards (simple→gemini-flash $0.075/M · moderate→haiku $0.80/M · complex→sonnet-3.5 $3.00/M · frontier→gpt-4o $5.00/M) with model dropdown + live price. Distribution stacked bar 7d (hover counts). Custom rules (IF agent AND task THEN model; YAML editor + highlight; Edit/Delete; hot-reload toast). Fallback chain (drag reorder). "Saved $X this week" headline.

## Budgets
Tree Org→Team→Project→Agent (collapsible): progress bar, $spent/$limit, % — green <75 / amber 75–90 / red >90, inline enforcement state (downgrade active, hard stop). Click = edit + thresholds. Forecast ("at this rate $X by month end"), 3-month history bars, alerts log (timestamp/trigger/action).

## Policies (from Phase 4 engine; list from `policies` table / policy YAML)
Rule list (name, team scope, kind: model-access/PII/max-tokens/time-window, updated). Create/edit (name, team, allow/deny models with `*`, max tokens, deny hours, PII redact/block toggles). Save → hot-applied, toast. Fail-closed PII banner when no internal list.

## Keys (Virtual Key Vault)
Warning banner (real keys encrypted, agents never see them). Table: name, agent scope, created, last used, status; full key shown ONCE at creation; after: last-4 only. Revoke (instant + confirm), Rotate (new key + configurable grace). Provider keys section (masked `sk-••••1234`, Rotate/Delete). Empty state guides first key.

## Topology (Phase 5 — visible now, mock graph)
Workflow card (e.g. Content Pipeline: Planner→Researcher→Writer→Reviewer with $/tier per node; Total vs Optimized −30%). Hover = model/cost/tokens/failure; click = step requests. "Coming Q4 2026" banner + GitHub star CTA. Implementation: React Flow, draggable nodes. (Live data: spec 08 brain API.)

## Requests (full log)
Filterable (agent/team/model/status/date), sortable, paginated table + expandable rows (headers, cost math, cache/route/enforce annotations). Export CSV (deferred).

## Settings
Workspace (name, members deferred), replay onboarding, theme, default TTL/threshold, danger zone (purge cache, reset demo data). Links: docs, changelog.

## Data layer (owner: `ledger-web-backend`)
- Route Handlers per page on Postgres (`lib/db.ts` pool pattern from spec 14; `queryOrNull` zero-state).
- Typed client `lib/api.ts`; hooks `use-overview|agents|cache|budgets` + `use-realtime` (SSE: alerts + request feed, 60s bound).
- Stores: `filter.store` (global date-range/agent filter), `dashboard.store` (workspace, theme).
- Auth: NextAuth v5 (GitHub first; email second; SSO Phase 6). Middleware protects `(app)/`.
