# 20 — Frontend Build Status (F0 + parallel web build)

> Prev: [19-frontend-build-plan](./19-frontend-build-plan.md) | Parent: [00-index](./00-index.md)

Living status: where we are, what we did, what's left. Updated after every build block.

## Where We Are
Monorepo migration LANDED (`apps/dashboard` moved, `apps/web` scaffolded, `packages/*`, turbo, single lockfile). All 5 web roles built in parallel (run as `general` workers — the Task tool has no `ledger-web-*` types; role prompts live in `.opencode/agents/ledger-web-*.md`).
Live: proxy `:8787` (PG-backed) · dashboard `:3000` (200, real data) · web `:3001` (200, full landing). Both apps `tsc` clean AND `npm run build` green (12 web routes, 27 dashboard routes). Go: 8/8 packages green.

## What We Did (this block)
- **F0 migration (coordinator):** `dashboard/` → `apps/dashboard/`; `apps/web` via CNA (Next 16, removed nested `.git` that broke turbopack resolution); root `package.json` workspaces + `turbo.json` + `typecheck` scripts; `packages/{types,ui,config}` stubs (`@agentledger/types` ships agent/cost/budget/cache/api shapes); single root lockfile (deleted stale nested one); `.gitignore` generalized.
- **web-landing:** 11 sections + shared (theme-toggle/logo/typewriter) + composed `page.tsx`; static/seeded, no env needed. tsc 0.
- **web-dashboard:** shell (sidebar/topbar/breadcrumb) + 11 pages (overview, agents+[id], cache, routing, budgets, policies, keys, topology mock, requests, settings), mock data matching `lib/api` types, `TODO(API)` markers, existing panels reused. tsc 0. Needs: `reactflow` (optional), `(auth)` login/signup UI + loading skeletons (offered next).
- **web-system:** spec-18 tokens in both apps, Inter/JetBrains Mono on web, shadcn `ui/*` (both apps) + `primitives/*`, `@agentledger/ui` format/tokens/charts, additive `@agentledger/types` extensions. tsc 0 both apps, both pages 200.
- **web-backend:** 12 Route Handlers (agents, budgets, alerts, keys once-only, stats cached, SSE events, onboarding ×3, NextAuth), `lib/api-ext.ts`, 5 hooks (plain fetch/EventSource — no react-query needed), zustand stores, `proxy.ts` (Next 16; NOT deprecated `middleware.ts`), onboarding APIs. All routes curled 200 with live PG data; keys stored hashed (0 `vk_` rows); alerts POST fail-closed 503 stub. REQUIRED_ENV: `AUTH_SECRET` (set locally), `GITHUB_ID/SECRET`, `PROXY_MGMT_BASE`.
- **web-journey:** journey/numbers/pricing components, pricing/docs/blog/changelog/waitlist routes, GitHub stars helper (repo `ichiragkumar/AgentLedger`), metadata. `npm run build` green. Pricing follows spec 15; waitlist POST is in-memory stub for backend to adopt.
- **Integrator fixes:** `lib/db.ts` schema paths → `../../db/`; purged backend test rows; `apps/dashboard/.env.local` (AUTH_SECRET generated, gitignored); fixed web `LayoutProps` + budget-panel Tooltip types.

## What's Left
1. **Proxy management plane** (Go, blocks backend stubs): `GET/POST /v1/budgets`, `PUT/DELETE /v1/budgets/{id}`, `GET/POST /v1/alerts`, `GET /v1/audit`, key-vault API (issue/list-prefix/revoke/rotate), cache stats/config — backend verified `/v1/*` → 404 today.
2. **Dashboard:** ~~`(auth)` login/signup UI~~ DONE (dev-login + GitHub button, prefilled); loading skeletons still open (dashboard worker offered); wire `use-overview/use-realtime` into Overview; adopt tokens/`@agentledger/ui` (hardcoded `#22c55e` etc.); reactflow decision; `app/api/waitlist` adoption (journey's stub, same-segment rule).
3. **Decisions for human:** spec 10 vs 15 pricing tiers (4-tier+Business $199 vs 3-tier Pro 5M — journey holds spec 15); enterprise Calendly URL/email placeholders; `drizzle-orm` vs `pg` (backend kept `pg`); GitHub repo slug confirmed `ichiragkumar/AgentLedger`.
4. **Proof:** F4 realtime e2e (request→dashboard ≤5s live, breach toast ≤60s), F5 SEO/OG + WCAG audit + Lighthouse CI.
5. **Creds still needed:** provider API keys, `GITHUB_ID/SECRET`, `QDRANT_API_KEY`, alert webhook, `VIRTUAL_KEYS`.

## Decisions Log- Web roles ran on `general` workers (no `ledger-web-*` Task types exist); ownership enforced via prompts + AGENTS.md.
- Nested `apps/web/.git` removed (broke turbopack); nested `apps/dashboard/package-lock.json` removed (single lockfile).
- `proxy.ts` over `middleware.ts` (Next 16 deprecation, per vendored docs).
- Plain fetch/EventSource over react-query (fewer deps, same contract).
- Test PG rows purged; smoke/demo traffic retained.
- Dev login: `dev-login` Credentials provider (ALLOW_DEV_LOGIN-gated, env defaults) + prefilled `/login`; verified accept + reject + authed `/overview`.
- Console-error fixes: theme init uses `next/Script beforeInteractive` (raw `<script>` in layout is illegal); topology `<title>` single-expression (multiline JSX text hydrated differently); `suppressHydrationWarning` retained for extension-injected attrs (Grammarly).
- GitHub slug corrected to `ichiragkumar/AgentLedger` (was `anomalyco/*`, copied from tool docs).

## Two-App Journey (how :3001 + :3000 fit)
```
:3001 (web, public)                          :3000 (dashboard, authed)
Landing → live demo (mock) → pricing/docs    /login (dev prefilled) → onboarding
  → Get Started (/signup→/login) →               3 steps → /overview (live PG data)
  "Open app →" ─────────────────────────────→ /overview
  ← "Back to site" ───────────────────────── logout/docs links
```
- Cross-links are env-driven: `NEXT_PUBLIC_DASHBOARD_URL` (web navbar, default `http://localhost:3000/overview`), `NEXT_PUBLIC_WEB_URL` (dashboard login, default `http://localhost:3001/`). Set production URLs in Vercel + Docker env.
- Rule: web NEVER touches Postgres or proxy keys (mock/seeded only); dashboard NEVER serves public marketing. Shared look via `@agentledger` tokens.
