# 19 — Frontend Build Plan: Onboarding, Motion, State, Perf, Phases

> Prev: [18-frontend-design-system](./18-frontend-design-system.md) | Parent: [00-index](./00-index.md)

Companion to spec 17 (dashboard pages) — this file owns the build HOW: onboarding flow, animation system, state management, performance targets, F0–F5 timeline, and ship checklists.

## Onboarding Flow (3 steps, no skippable context, no 10-min setup)

Step 1 — Workspace: "Welcome to AgentLedger" + progress dots (1 of 3). Workspace name (required) + team invites (optional, +Add another). [Continue →].

Step 2 — Connect agent (2 of 3): virtual key shown in FULL once with Copy ✓ checkmark. Code block pre-filled with THEIR key:
```
OPENAI_BASE_URL="https://proxy.agentledger.io/v1"
OPENAI_API_KEY="vk_prod_a1b2c3d4e5f6g7h8i9"
```
[← Back] [Test Connection →].

Step 3 — Connection test (3 of 3): pulsing "Listening on your proxy URL…" → `✅ Request received! gpt-4o · 412 tokens · $0.002` (actual model/tokens/cost via SSE, 60s window). "Skip for now" after 30s. [Go to Dashboard →].

AC: □ name required, invites optional □ key full + copy checkmark □ code block has actual key □ SSE first-request ≤60s with real model/tokens/cost □ skip after 30s □ back preserves input □ dots reflect progress □ mobile stacked.

## Animation System (framer-motion)
Rules: (1) animate once, never on re-scroll; (2) purpose only, never decoration; (3) honor `prefers-reduced-motion` (fades kept); (4) ≤500ms (except typewriter); (5) ease-out enter, ease-in exit.

```ts
// lib/animations.ts
export const FADE_UP = { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, ease: "easeOut" } };
export const FADE_IN = { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.3 } };
export const STAGGER_CONTAINER = { animate: { transition: { staggerChildren: 0.1 } } };
export const STAGGER_ITEM = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, ease: "easeOut" } };
export const SLIDE_IN_LEFT = { initial: { opacity: 0, x: -30 }, animate: { opacity: 1, x: 0 }, transition: { duration: 0.4, ease: "easeOut" } };
export const SLIDE_IN_RIGHT = { initial: { opacity: 0, x: 30 }, animate: { opacity: 1, x: 0 }, transition: { duration: 0.4, ease: "easeOut" } };
export const withReducedMotion = (variant: object) => ({ ...variant, initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } });
```

## State Management (zustand + tanstack/react-query)
```ts
// lib/stores/filter.store.ts — global filters: range, agent, team
import { create } from "zustand";
type DateRange = "24h" | "7d" | "30d" | "custom";
interface FilterStore { dateRange: DateRange; selectedAgentId: string | null; selectedTeamId: string | null;
  setDateRange: (r: DateRange) => void; setAgent: (id: string | null) => void; setTeam: (id: string | null) => void; }
export const useFilterStore = create<FilterStore>((set) => ({
  dateRange: "7d", selectedAgentId: null, selectedTeamId: null,
  setDateRange: (range) => set({ dateRange: range }),
  setAgent: (id) => set({ selectedAgentId: id }), setTeam: (id) => set({ selectedTeamId: id }),
}));
```
```ts
// lib/hooks/use-realtime.ts — SSE: request → invalidate overview+agents; alert → toast + invalidate budgets
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
export function useRealtime() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("request", () => {
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    });
    es.addEventListener("alert", (e) => {
      const alert = JSON.parse(e.data);
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    });
    return () => es.close();
  }, [queryClient]);
}
```
Deps to install: `framer-motion next-themes @tanstack/react-query zustand lucide-react react-hook-form zod` (+ `drizzle-orm` TBD — current dashboard uses `pg` directly per spec 14; backend agent decides, no dual ORM). Fonts: Inter + JetBrains Mono via `next/font` (replaces CNA Geist when apps/ are scaffolded).

## Performance Targets
| Metric | Target | How |
|---|---|---|
| FCP (landing) | <1.2s | Static RSC, no client JS in hero |
| LCP (landing) | <2.0s | No hero image, text-only above fold |
| CLS | 0 | Fonts preloaded, skeletons |
| TTI (landing) | <2.5s | Minimal client JS, deferred animation |
| Dashboard load | <2.0s | Skeleton → data, parallel queries |
| Chart render | <100ms | Recharts, pre-aggregated data |
| Bundle | <180KB gzipped | Tree-shaking, RSC, no heavy deps |
| Lighthouse | >90 all | CI on every PR |

## Build Phases F0–F5
- **F0 Setup (Day 1):** CNA + shadcn init + deps above + fonts + tokens + ThemeProvider/Toggle + Turborepo + CI (lint/type/build) + Vercel + README. AC: dev clean, toggle works, CI green.
- **F1 Landing (Day 2–6):** 2: navbar+hero · 3: proof+problem · 4: how+bento · 5: journey+numbers · 6: pricing+OSS+FAQ+CTA+footer. Global AC: dark+light clean, 320→1440px, Lighthouse >90, zero CLS, reduced-motion respected, CTAs linked, Vercel preview per commit.
- **F2 Shell (Day 7–11):** 7: auth+NextAuth · 8: onboarding+key creation · 9: sidebar/topbar/breadcrumb · 10: overview mock · 11: agents+detail. AC: GitHub OAuth e2e, onboarding <5min, shell behaviors, charts+tables (sort/filter/paginate/empty/skeleton), dark=light quality.
- **F3 Pages (Day 12–15):** 12: cache+routing · 13: budgets tree+burndown · 14: keys+policies · 15: topology mock+Coming. AC: cache save immediate, rules highlight+hot-reload toast, tree Org→Agent, key-once, topology compelling.
- **F4 Integration (Day 16–19):** 16: all pages → Go API · 17: SSE + toasts · 18: onboarding live test · 19: errors/retry/offline. AC: request→dashboard ≤5s, breach toast ≤60s, human errors, offline banner, real data everywhere.
- **F5 Polish (Day 20–22):** 20: SEO/OG/sitemap + 404/500 · 21: MDX docs + changelog · 22: QA (browsers, mobile, a11y). AC: OG renders, branded 404, zero-to-proxy via docs alone, v0.1.0 changelog, WCAG 2.1 AA, no regressions.

## Ship Checklists
LANDING: □ <8-word headline □ 5s value prop □ typewriter+copy □ real-UI preview □ problem real/no-jargon □ 3-step visuals □ 6-card bento □ ungated 4-tab demo □ journey clickable/auto-cycle □ numbers animated+real □ pricing + toggle □ FAQ accordion □ one-button CTA □ working footer □ dark+light contrast □ 375px clean □ LH perf >90 / a11y >95 □ zero AI slop.
DASHBOARD: □ OAuth □ 3-step <5min □ key-once □ live connection test □ overview 4-cards/3-charts/alerts □ ranges sync □ agents table □ scoped detail □ cache live-save □ routing hot-reload+reorder □ budgets tree/forecast □ keys CRUD □ topology mock □ SSE ≤5s □ breach toast ≤60s □ empty/skeleton/error states □ dark parity □ 768px sidebar.
DEPLOY: □ Vercel preview per PR □ prod on main □ domain+SSL □ OG correct □ docs indexed □ Plausible pageviews.

## Implementation Status
Proof run 2026-09-20 (owner: ledger-finish-proof). Ship-plumbing files
(all NEW): `apps/dashboard/app/not-found.tsx`, `apps/dashboard/app/error.tsx`,
`apps/web/app/not-found.tsx`, `apps/web/app/error.tsx`,
`apps/web/app/robots.ts`, `apps/web/app/sitemap.ts`,
`apps/web/app/opengraph-image.tsx`. Verify: `npx tsc --noEmit` clean in both
apps; `npm run build` green in both (web routes: `/robots.txt`,
`/sitemap.xml`, `/opengraph-image`). Test rows purged (20 request_logs rows +
1 micro-budget; DB back to 8 rows / 4 seed budgets / 0 audit rows).

F4 results (live stack: proxy :8787, dashboard :3000, web :3001, PG docker):

| Check | Target | Actual | Verdict |
|---|---|---|---|
| request→dashboard-visible (proxy 200 → SSE `request` event) | ≤5s | 2554ms (proxy rtt 14ms) | PASS |
| demo `--once` (7 calls, all agents) | all ok | 7 ok, 0 failed | PASS |
| budget-breach→toast | ≤60s | ∞ — see gaps B1+B2 | FAIL |
| offline banner (proxy down → dashboard cue) | banner | none — dashboard serves stale 200s silently | FAIL |

F5 results (Lighthouse 13.5.0; NOTE: both app servers run `next dev`, so
perf scores are dev-mode lower bounds, not prod):

| Page | Perf | A11y | Best-practices | SEO |
|---|---|---|---|---|
| :3001 landing `/` | 61 | 97 | 96 | 100 |
| :3000 `/login` | 84 | 100 | 96 | 100 |

Landing LCP 7.6s / CLS 0.119 / unused-JS 370KiB are dominated by dev
artifacts (`next-devtools`, unminified dev chunks). Real issue: 1
`color-contrast` failure cluster (`text-zinc-500` on light surfaces;
see gap B4). Keyboard pass (inspection): interactive elements are native
`<button>`/`<a>`; `role=status`/`role=alert` present on waitlist; no
skip-link. Reduced-motion: zero handling anywhere (gap B5).

Known gaps for follow-ups (file/line, no fixes):
- B1: proxy never persists audit/budget-spend to PG (`audit_log` 0 rows,
  `budgets.spent_usd` always 0) → `apps/dashboard/app/api/alerts/route.ts`
  returns `[]`, SSE `alert` events never fire. Enforcer itself works
  (live 429 `budget_exceeded team:f4-breach:monthly`, 135%).
- B2: no toast infra — `useRealtime` alert events have no consumer UI;
  `apps/dashboard/app/(app)/overview/page.tsx:45` refreshes silently.
  Follow-up: add toast lib + `status` banner (covers offline too).
- B3: `demo/runner.py:39-42` sends `AgentLedger-Key` only; live proxy
  path required `Authorization: Bearer` for upstream success in this run
  (mock 400s otherwise). Runner/upstream wiring needs one owner.
- B4: `apps/web/components/landing/hero.tsx` (+ journey/numbers):
  `text-zinc-500` contrast failures per Lighthouse `color-contrast`.
- B5: no `prefers-reduced-motion` guard anywhere (framer-motion in
  `apps/web/components/landing/product-journey.tsx:15,194`, CSS
  `animate-[ticker…]` in `social-proof-bar.tsx:15`,
  `animate-[fadeUp…]` in `hero.tsx`, typewriter) — spec-19 §Animation
  requires it.
- B6 (stack note): live proxy was bounced mid-run by persons unknown;
  pre-bounce build ran `enforce-stub` (no metering persistence path at
  all), post-bounce `enforce-precheck, cache-hook, route-balanced`.
  Upstream stub returns fixed 10/20 tokens (`chatcmpl-liveproof`), so
  cost math is not yet realistic.
