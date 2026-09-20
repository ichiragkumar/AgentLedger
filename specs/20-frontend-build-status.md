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
1. ~~**Proxy management plane**~~ DONE
2. ~~**Dashboard fetchers → live plane**~~ DONE
3. ~~**Phase pages → live hooks (5 parallel ship tracks)**~~ DONE (this block — 5 new agents in `.opencode/agents/ledger-ship-*.md`, all verified):
   - **Cache** (`ledger-ship-cache`): `/api/cache/{stats,config,flush}` + page live on `use-cache`+SSE; stub banner until Mirror mounts `GET /v1/cache/stats`, `PUT /v1/cache/config`, `DELETE /v1/cache[…]` (shapes in `internal/cache/WIRING.md`). Note: API accepts 0.80–0.99 but Go clamps 0.85–0.99 (PUT notes it).
   - **Routing** (`ledger-ship-routing`): `/api/routing/{tiers,rules,rules/[id],fallback,distribution}` on new PG tables + `use-routing.ts` + page live (tier cards, YAML rules, drag-reorder fallback, savings headline). New root `WIRING.md` for proxy consumption. Known divergence (human): Go `tiers.go` prices vs spec-17 card prices.
   - **Budgets+Policies** (`ledger-ship-budgets`): both pages live + `/api/policies` (PG-first + Go mirror) + full E2E proof green (90% downgrade → 100% hard_stop → alert-1 → raise → resume; test rows purged). Known gaps (not fixed): derived alerts read `spent_usd` (always 0) not `request_logs`; writes don't append PG `audit_log`; `budgets.reset_at` defaults skew forecast.
   - **Growth** (`ledger-ship-growth`): agents(+detail)/requests/keys/onboarding live; keys once-only reveal dialog; onboarding 3-step UI vs live APIs; settings replay link. Needs a manual authed browser pass (curl was anon).
   - **Topology+Finish** (`ledger-ship-topology`): SVG decision (no reactflow), `/api/topology/*` (graphs + request_logs fallback) + hook + page live w/ Coming banner; waitlist adopted (PG, rate-limited, verified 200→purged); 11 `loading.tsx` added; token-sweep REPORT delivered (no edits).
   - Integrator fixes: `pg` explicit in `apps/web`, `apps/web/.env.local` (DATABASE_URL, gitignored). Verified: tsc clean both apps, both builds green, Go 8/8, 19 API routes 200, all app pages 307→login (anon-correct).
2. **GitHub OAuth** DONE (local): `GITHUB_ID/SECRET` in gitignored `.env.local`, provider live. Production: register callback (below) in the GitHub App.
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
- Auth redirects (fundamental fixed): `/`, `/login`, `/signup` are session-aware — logged-in users never see signin again (`/` → `/overview`, `/login|/signup` → `/overview`). Auth guard (`proxy.ts`) sends anon users to `/login?callbackUrl=…` (was the ugly built-in `/api/auth/signin` page listing stub providers); login honors callbackUrl for both dev-login and GitHub. `pages.signIn: /login` set so Auth.js never renders its built-in page from app flows.
- Login/signup buttons use the existing indigo primary (green-700 removed — no new colors; token-adoption sweep stays pending per below).
- Login root-causes fixed: Auth.js v5 requires `AUTH_GITHUB_ID/SECRET` (not v4 `GITHUB_*` — both set now); GitHub signin must be POST (my GET probe gave a false `Configuration` alarm — real flow 302s to github.com with correct `redirect_uri`); full `next dev` parent restart required for env pickup (child-only kill keeps stale env).
- No-emoji pass: 6 files swapped to lucide-react (`Sun/Moon/Menu/X/Check`; pricing table uses "Yes"); `lucide-react` added to both apps; glyph scan = 0. Theme/fonts consistent: spec-18 tokens in both apps, Inter+JetBrains Mono (web) / Geist (dashboard) via `next/font`, `.mono` money, class-based dark toggle.
- Console-error fixes: theme init uses `next/Script beforeInteractive` (raw `<script>` in layout is illegal); topology `<title>` single-expression (multiline JSX text hydrated differently); `suppressHydrationWarning` retained for extension-injected attrs (Grammarly) — applied to BOTH apps' root layouts (dashboard + web).
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
