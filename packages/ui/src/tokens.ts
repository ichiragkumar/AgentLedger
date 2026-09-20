// Canonical token contract shared by apps/web + apps/dashboard.
// Owner: ledger-web-system (spec 18). Values are CSS-var references so
// light/dark resolve at runtime. Components MUST use these (or the
// Tailwind utilities bg-primary, text-savings, …) — never raw hex.

export const TOKENS = [
  "background",
  "foreground",
  "card",
  "popover",
  "primary",
  "secondary",
  "muted",
  "accent",
  "savings",
  "overspend",
  "warning",
  "border",
  "input",
  "ring",
] as const;

export type TokenName = (typeof TOKENS)[number];

/** hsl(var(--savings)) — for inline styles / SVG attrs tokens can't reach. */
export function tokenVar(name: TokenName | `chart-${1 | 2 | 3 | 4 | 5}`): string {
  return `hsl(var(--${name}))`;
}

/** Semantic money tones → token names. */
export const MONEY_TOKENS = {
  spend: "overspend",
  savings: "savings",
  warning: "warning",
  neutral: "muted-foreground",
} as const;
