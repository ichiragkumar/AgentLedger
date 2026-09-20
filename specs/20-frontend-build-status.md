# 20 — Build Status: What We Did, How, What's Left & Pending

> Prev: [19-frontend-build-plan](./19-frontend-build-plan.md) | Parent: [00-index](./00-index.md)

Living status — updated after every build block. Sections: snapshot, what we
did (+ how), what's left (build work), what's pending (needs a human or is
deferred, incl. production setup — explicitly LATER, not now).

## Where We Are (snapshot)
Monorepo LANDED (`apps/dashboard`, `apps/web`, `packages/*`, turbo, single
lockfile). Backend proxy + management plane live on `:8787` (PG-backed).
Dashboard `:3000` + web `:3001` both `tsc` clean, both `npm run build` green,
all 19+ dashboard API routes 200, Go 8/8 packages green (87–93% cov).
GitHub OAuth confirmed working locally. Production setup explicitly deferred.

## What We Did
- **F0 migration:** `dashboard/` → `apps/dashboard/`; `apps/web` via CNA
  (Next 16; removed nested `.git` that broke turbopack); root workspaces +
  `turbo.json` + `typecheck`; `packages/{types,ui,config}` stubs; single
  lockfile; generalized `.gitignore`. *How: coordinator-run (touches
  everyone's paths, so no phase agent was allowed near it).*
- **Backend phases 0–5:** Go proxy (forwarding, tokens, pricing, vault,
  SSE, metrics) + cache/router/enforce/brain packages, all tested. *How: 5
  `ledger-*` subagents in parallel under AGENTS.md ownership, integrator
  fixed 11 cross-track failures (router parens, enforcer dispatcher/mini-match,
  classifier floor).*
- **Management plane + dashboard wiring:** `internal/auth/vault.go`
  (sha256-only, PG-or-memory, grace rotate) + `MountMgmt` (budgets/alerts/
  audit/policies/keys on `/v1/*`); dashboard `proxy-mgmt.ts` (admin actor,
  optional bearer, fail-open 2.5s); keys proxy-first/PG-fallback, budgets
  PG-first + Go mirror (`proxySynced` flag), alerts POST with actor headers.
  *How: coordinator-built, proven live (issue→use→rotate→revoke,
  create→$50→$100→delete, alert-1), test rows purged.*
- **5 web roles → full landing + shell:** 14 landing sections, dashboard
  shell + 11 pages, design tokens, 12+ Route Handlers, journey/content
  routes. *How: 5 `ledger-web-*` role prompts run on `general` workers
  (Task tool has no web types), then 5 `ledger-ship-*` agents took every
  phase page live (cache/routing/budgets+policies/agents+requests+keys+
  onboarding/topology), each verified (tsc/build/curl/E2E).*
- **Auth fixed fundamentally:** session-aware `/`, `/login`, `/signup`
  (logged-in users never see signin); guard routes anon → `/login?callbackUrl`;
  `pages.signIn: /login` hides the stub-listing built-in page; dev-login
  prefilled + verified; `AUTH_GITHUB_ID/SECRET` (v5 names) + full-restart
  lesson recorded. Profile menu (avatar top-right: email, workspace, theme,
  settings, sign-out); skeletons + live Overview (spend/alerts/SSE).
  *How: coordinator, verified via session-cookie curls (307→login anon,
  200 authed).*
- **Hygiene:** no-emoji pass (lucide, glyph scan 0), hydration fixes
  (`next/Script`, single-expression SVG `<title>`, `suppressHydrationWarning`
  both apps), green-700 removed (indigo primary only — no new colors).

## What's Left (build work, local)
1. ~~**Chain patches**~~ DONE (5 finish agents, all verified):
   - **Chain** (`ledger-finish-chain`): stubs → live pipeline (`ChainDeps` +
     `NewMuxWithChain`; cache.Hook + router.Decide + enforce PreCheck/Observe,
     all env-gated fail-open). Live proof: duplicate prompt → R2 HIT/exact,
     byte-identical, upstream ×1; budget 90% → downgrade header + rewritten
     model; 100%+ → 429 JSON + Retry-After; semantic HITs ~0.94 observed.
     Proxy coverage 81.1%. Go 8/8 green.
   - **Demo-UI** (`ledger-finish-demo-ui`, NEW files only): `/api/demo/summary`
     (BEFORE modeled at frontier rates, labeled; AFTER metered) +
     `/api/demo/agents/[id]` + `/demo` + `/demo/[agent]` (toggle, cards,
     skeletons, empty state). Cache annotation honestly `unknown`.
   - **Sweep** (`ledger-finish-sweep`): 9 files → spec-18 tokens (6-token
     chart palette, savings/warning/overspend, `bg-primary`, `.mono`);
     build green; hydration fix intact.
   - **Browser** (`ledger-finish-browser`, read-only, 10/10 incl. 768px, 0
     console errors): filed B1 (overview caption), B2 (keys grace), B3
     (onboarding unscoped), B4 (float input) — ALL FIXED this turn (caption
     range-aware; text inputs; keyPrefix scoping; Go KeyInfo gains
     grace_expires_at/rotated_from + memory-path grace + dashboard mapping).
   - **Proof** (`ledger-finish-proof`): F4 request→SSE 2554ms PASS; breach→
     429 proven but toast path FAILED (audit never persisted) — FIXED this
     turn (`/api/alerts` merges live Go `/v1/audit`; toast on alert events;
     offline banner on SSE drop); F5 Lighthouse login 84/100/96/100,
     landing 61 (dev artifacts); 404/500/robots/sitemap/OG shipped.
   - **Integrator (this turn):** cache mgmt plane (`MountCacheMgmt`: stats/
     config/flush, shapes match dashboard) → dashboard cache flips
     `source:live`; demo nav link; demo re-run (14/14, 2nd cycle 7/7 HITs,
     50%, saved $0.0044 end-to-end to dashboard); purged after; proxy
     restored without mock env.
   - Known remaining gap (not fixed): cache HITs skip `request_logs`
     (Observe is MISS-only by design) — hits are counted in `/v1/cache/stats`
     but invisible per-agent. Needs a hook change (follow-up).
2. **Manual authed browser pass** over agents/requests/keys/onboarding click
   paths (curl was anon).
3. **Token-adoption sweep** (report ready): hardcoded `indigo-*`/`zinc-*`/hex
   chart colors → spec-18 tokens + `.mono`, both apps, one pass.
4. **F4 proof:** request→dashboard ≤5s, breach toast ≤60s, offline banner.
5. **Known minor gaps (recorded, unfixed):** derived alerts read `spent_usd`
   (always 0); writes don't append PG `audit_log`; `budgets.reset_at`
   default skews forecast; Go `tiers.go` prices vs spec-17 cards; API
   threshold 0.80–0.99 vs Go clamp 0.85–0.99.
6. **F5 polish:** SEO/OG, branded 404/500, MDX docs, v0.1.0 changelog,
   WCAG 2.1 AA, Lighthouse CI.

## What's Pending (needs a human, or deferred)
- **You:** rotate the GitHub client secret pasted in chat (it lives in
  gitignored `.env.local`, but chat history is not a safe store).
- **Decisions:** spec 10 vs 15 pricing (holding spec 15); enterprise
  Calendly URL/email placeholders; `drizzle-orm` vs `pg` (kept `pg`).
- **Creds for live traffic:** provider API keys, `QDRANT_API_KEY`, alert
  webhook, `VIRTUAL_KEYS` map.
- **Production setup — LATER (explicitly deferred):** Vercel prod + domain/
  SSL, `NEXT_PUBLIC_WEB_URL` / `NEXT_PUBLIC_DASHBOARD_URL` / `NEXTAUTH_URL` /
  GitHub callback URLs, Docker prod env, Plausible, docs indexing. Nothing in
  this file depends on it.

## Next Plan
Mirror applies the queued chain patches (cache hook + route decide +
PreCheck), replays duplicate-prompt + 90%/100% budget traffic, confirms
stub banners flip and E2E stays green. Awaiting **go** — no code changes
until then.

## Decisions Log
- Web roles ran on `general` workers (no `ledger-web-*` Task types exist); ownership enforced via prompts + AGENTS.md.
- Nested `apps/web/.git` removed (broke turbopack); nested `apps/dashboard/package-lock.json` removed (single lockfile).
- `proxy.ts` over `middleware.ts` (Next 16 deprecation, per vendored docs).
- Plain fetch/EventSource over react-query (fewer deps, same contract).
- Test PG rows purged; smoke/demo traffic retained.
- Dev login: `dev-login` Credentials provider (ALLOW_DEV_LOGIN-gated, env defaults) + prefilled `/login`; verified accept + reject + authed `/overview`.
- Auth redirects: `/`, `/login`, `/signup` session-aware; guard → `/login?callbackUrl`; login honors callbackUrl (dev-login + GitHub); `pages.signIn: /login`.
- Login root-causes: Auth.js v5 needs `AUTH_GITHUB_ID/SECRET` (not v4 names); GitHub signin must be POST (GET probe gave false alarm); full `next dev` parent restart required for env pickup.
- No-emoji pass: lucide-react in 6 files; glyph scan 0; Inter/JetBrains Mono (web) + Geist (dashboard); class-based dark toggle.
- Console-error fixes: `next/Script beforeInteractive`; single-expression SVG `<title>`; `suppressHydrationWarning` both apps (Grammarly attrs).
- GitHub slug: `ichiragkumar/AgentLedger`. OAuth confirmed working locally.
- SVG decision: no reactflow (TopologyPanel <1s at 20 nodes, zero deps).
- `pg` explicit in `apps/web`; `apps/web/.env.local` holds DATABASE_URL (gitignored).

## Two-App Journey (how :3001 + :3000 fit)
```
:3001 (web, public)                          :3000 (dashboard, authed)
Landing → live demo (mock) → pricing/docs    /login (dev prefilled) → onboarding
  → Get Started (/signup→/login) →               3 steps → /overview (live PG data)
  "Open app →" ─────────────────────────────→ /overview
  ← "Back to site" ───────────────────────── logout/docs links
```
- Cross-links are env-driven: `NEXT_PUBLIC_DASHBOARD_URL` (default `http://localhost:3000/overview`), `NEXT_PUBLIC_WEB_URL` (default `http://localhost:3001/`). Set production URLs at production time (deferred).
- Rule: web NEVER touches Postgres or proxy keys (mock/seeded only, except the adopted waitlist route); dashboard NEVER serves public marketing. Shared look via `@agentledger` tokens.
