# 18 — Frontend Design System

> Prev: [17-frontend-dashboard](./17-frontend-dashboard.md) | Parent: [00-index](./00-index.md)

Owner: `ledger-web-system`. Applies to `apps/web`, `apps/dashboard`, `packages/ui`.

## Brand
Deep Indigo primary (trust/finance/technical), Mint accent (savings/positive). Warm dark — NEVER pure black. Radius 0.5rem. Cost numbers ALWAYS monospace tabular-nums (`.mono`).

## Tokens (`globals.css`, Tailwind v4 + shadcn HSL convention)

```css
@import "tailwindcss";

@layer base {
  :root {
    --background: 0 0% 100%;            --foreground: 240 10% 4%;
    --card: 0 0% 100%;                  --card-foreground: 240 10% 4%;
    --popover: 0 0% 100%;               --popover-foreground: 240 10% 4%;
    --primary: 243 75% 58%;             --primary-foreground: 0 0% 100%;
    --secondary: 240 5% 96%;            --secondary-foreground: 240 6% 10%;
    --muted: 240 5% 96%;                --muted-foreground: 240 4% 46%;
    --accent: 162 63% 41%;              --accent-foreground: 0 0% 100%;
    --savings: 142 71% 45%;             --overspend: 0 84% 60%;   --warning: 38 92% 50%;
    --border: 240 6% 90%;               --input: 240 6% 90%;      --ring: 243 75% 58%;
    --radius: 0.5rem;
  }
  .dark {
    --background: 240 10% 4%;           --foreground: 0 0% 98%;
    --card: 240 10% 6%;                 --card-foreground: 0 0% 98%;
    --popover: 240 10% 6%;              --popover-foreground: 0 0% 98%;
    --primary: 243 75% 66%;             --primary-foreground: 0 0% 100%;
    --secondary: 240 4% 16%;            --secondary-foreground: 0 0% 98%;
    --muted: 240 4% 16%;                --muted-foreground: 240 5% 65%;
    --accent: 162 63% 50%;              --accent-foreground: 0 0% 100%;
    --savings: 142 71% 52%;             --overspend: 0 84% 65%;   --warning: 38 92% 56%;
    --border: 240 4% 16%;               --input: 240 4% 16%;      --ring: 243 75% 66%;
  }
}

.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

.grid-bg {
  background-image:
    linear-gradient(hsl(var(--border)) 1px, transparent 1px),
    linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px);
  background-size: 4rem 4rem;
}
```

Dark mode = `.dark` class toggle (localStorage + `prefers-color-scheme` init, `suppressHydrationWarning` for extension-injected attrs). Semantic colors: savings green / overspend red / warning amber, with dark-mode brightened variants above.

## shadcn Separation (upgrades safe)
```
components/
├── ui/               ← Raw shadcn — NEVER modify
│   ├── button.tsx, card.tsx, badge.tsx, dialog.tsx, table.tsx, chart.tsx, ...
├── primitives/       ← Lightly wrapped, brand tweaks
│   ├── stat-card.tsx (Card + cost coloring)
│   ├── cost-badge.tsx (Badge + $ formatting, .mono)
│   ├── model-chip.tsx (Badge per LLM provider)
│   └── alert-banner.tsx (budget threshold alerts)
└── blocks/           ← Product compositions from primitives
    ├── hero.tsx, features-bento.tsx, product-journey.tsx, overview-grid.tsx
```

## Shared Packages
- `packages/ui` — primitives + blocks shared by web + dashboard.
- `packages/types/src` — `agent.ts, cost.ts, budget.ts, cache.ts, api.ts` (single TS truth; dashboard `lib/api.ts` and proxy-adjacent code conform to it).
- `packages/config` — tailwind / eslint / typescript presets both apps extend.
- Fonts: Geist sans + mono via `next/font` (`lib/fonts.ts` on web).

## Rules
- No raw hex in components — tokens only (`bg-primary`, `text-muted-foreground`, `var(--savings)`…).
- Money/usage figures always `.mono`.
- Charts: Recharts themed via CSS vars (no hardcoded series colors except tier semantics: cheap green → frontier red/purple).
- `npx tsc --noEmit` clean per app; new UI = new file, never rewrite another agent's component.

## Implementation Status (token-sweep, 2026-09-20)

Report-listed dashboard files swept hex → tokens; `@agentledger/ui`
`charts.ts` exists but is NOT a workspace dep of `apps/dashboard`, so
series colors use `hsl(var(--chart-N))` directly (no new imports).
`text-savings`/`text-overspend`/`text-warning`/`bg-primary`/
`text-primary-foreground`/`border-primary` verified present in built CSS;
`.mono` already defined in `apps/dashboard/app/globals.css`.
Topology `<title>` kept as a single expression (hydration fix intact).
Tier semantics preserved: cheap green → frontier red/purple.
Verify: `npx tsc --noEmit` clean, `npm run build` green,
`:3000/overview` → 307 auth redirect → `/login` 200.
