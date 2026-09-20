# 16 — Frontend Landing (`apps/web`)

> Prev: [15-frontend-overview-monorepo](./15-frontend-overview-monorepo.md) | Parent: [00-index](./00-index.md) | Next: [17-frontend-dashboard](./17-frontend-dashboard.md)

Owner: `ledger-web-landing` (journey/integrations: `ledger-web-journey`). Design tokens: spec 18.

## Scroll Story
Navbar → Hero → Social proof → Problem → How it works → Features bento → Live demo → Product journey → Numbers → Pricing → Open source → FAQ → CTA → Footer.

## 01 — Navbar
Fixed; transparent on load, blurs + border after 20px scroll. Links: Features Docs Pricing Blog Changelog. Right: theme toggle (sun/moon rotate, persists), GitHub button (live stars, ISR 60s), Get Started → `/signup`. Mobile: hamburger → full-screen overlay.
AC: □ all pages □ active link highlighted □ 320px mobile □ theme persists □ stars update 60s ISR □ CTA → /signup.

## 02 — Hero (most important section)
Badge `v0.1 — Open Source · Apache 2.0`. H1 ≤ 7 words: "Your AI agents are bleeding money." Sub: "One proxy. Full visibility. 40–70% less spend." CTAs: Get Started Free → /signup, ★ View on GitHub. Terminal (typewriter <3s, copy button copies real command): `$ export OPENAI_BASE_URL=agentledger:8787/v1` / `# Done. Your agents are being tracked.` Mini dashboard preview = actual UI, not screenshot. Providers as text: OpenAI Anthropic Google DeepSeek Mistral.
Animations: badge .1s → H1 word-by-word .2s → sub .3s → CTAs .4s → terminal types .6s → preview slides .8s → logos 1.0s.
AC: □ ≤7 words □ typewriter <3s □ copy works □ preview is real UI □ text providers □ CTAs above fold @1280px □ <1.5s on 3G.

## 03 — Social Proof Bar
`★ 1,200+ GitHub Stars · 400+ Agents Connected · [logos]`. Infinite CSS ticker (no JS), pause on hover, aria-hidden duplicates, no layout shift, dark/light safe.

## 04 — Problem ("You don't know where the money goes")
3 cards: `$4,200 last month, up 38%, no idea why` · `??? which agent/team/model, one invoice` · `$800 Friday 11pm loop, found Monday`. Stagger 0.15s on first scroll-in.
AC: □ zero jargon □ real sourced numbers □ animate once □ dark borders visible.

## 05 — How It Works (3 steps, alternating)
01 Point (terminal, copyable) / 02 See (mini dashboard, REAL numbers, animated bars on scroll-in) / 03 Save (before/after cost chart). Mobile: text always first.
AC: □ one idea + one visual per step □ charts animate on scroll-in, not load.

## 06 — Features Bento (3-col desktop / 2 tablet / 1 mobile)
OBSERVE (every token/agent/cent, mini chart) · CACHE (semantic, 30–60% fewer calls, hit-rate ring) · ROUTE (right model/right price/auto, tier diagram) · ENFORCE (budgets, downgrade, loop detection, burndown) · TOPOLOGY (agent graph, mini viz, **Phase 5 "Coming" badge**) · KEY VAULT strip (virtual keys, real keys never leave server). Living mini-visuals, hover border glow, stagger on scroll.

## 07 — Live Demo (ungated)
"Try it before you install it." Embedded interactive dashboard with SEEDED mock data: tabs Overview/Agents/Cache/Routing, hover tooltips, agent drill-down, date-range filter, live hit-rate. Install CTA BELOW demo. Mobile scrolls horizontally.
AC: □ <2s load □ 4 tabs work □ drill-down □ range filter changes data □ no auth.

## 08 — Product Journey (trust-builder, owner: `ledger-web-journey`)
Horizontal dot timeline (LIVE filled green / BETA half blue / future empty gray), click → AnimatePresence card (number, name, badge, tagline, what-ships, checklist), auto-cycle 5s until interaction, arrow-key nav, mobile horizontal scroll + stacked cards, "Coming" shows dates. Phases per spec 15 table.

## 09 — Numbers (owner: `ledger-web-journey`)
`$2.4M+ tracked · 340M+ tokens optimized · 62% avg reduction · 400+ agents`. Count-up on scroll-in (rAF, once), compact notation, REAL data from `/api/stats` (public, cached), border top/bottom, aria-live final.

## 10 — Pricing (owner: `ledger-web-journey`, must match spec 15 + docs exactly)
FREE $0 (OSS, 1 team, 500K logs, community) · PRO $49 (unlimited teams, routing, enforcement, 5M logs, email — highlighted) · ENTERPRISE Custom (SSO+SOC2, self-hosted, SLA, white-label, dedicated eng → Calendly/email link). Annual/monthly toggle, comparison table, "no credit card" on free.
AC: □ toggle updates □ Pro highlighted □ full table □ enterprise = link-out.

## 11 — Open Source
"Open source. Self-hosted. Yours." Apache 2.0, one paragraph. Star + View Source (new tab), live star count, LICENSE link.

## 12 — FAQ (5, accordion, one-open, keyboard Enter/Space)
Agents compat → one env var. Latency → <1ms p99 Go. Safety → self-hosted, data never leaves. Vs Portkey/LiteLLM → "they show the bill, we cut it." Budget hit → 75% alert / 90% downgrade / 100% stop. ≤10-word questions, ≤2-sentence answers.

## 13 — Final CTA
"Stop guessing. Start seeing." One button (Get Started Free), primary-tint bg, 3 lines copy max, reassurance line always visible (no card, no lock-in, OSS forever).

## 14 — Footer
Product / Resources / Company columns, © 2026 · Apache 2.0 · Privacy · Terms, theme toggle.

## Routes (App Router)
`/` landing · `/pricing` · `/docs/[[...slug]]` (MDX) · `/blog` + `/blog/[slug]` · `/changelog` · `/waitlist`. Shared: `theme-toggle`, `logo`, `typewriter` (`components/shared/`), `lib/fonts|utils|metadata`.
