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
