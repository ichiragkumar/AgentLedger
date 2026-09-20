import { tokenVar } from "./tokens";

// Recharts theming via CSS vars (spec 18). Series colors resolve against
// the active theme — no hardcoded hex except tier semantics (cheap green
// → frontier red/purple), which intentionally match savings/overspend.

// Ordered categorical palette: --chart-1 … --chart-5.
export const CHART_SERIES: string[] = [1, 2, 3, 4, 5].map((n) =>
  tokenVar(`chart-${n as 1 | 2 | 3 | 4 | 5}`)
);

// Cost-tier semantics for model series: cheap → frontier.
export const TIER_COLORS: string[] = [
  tokenVar("savings"),
  tokenVar("chart-2"),
  tokenVar("warning"),
  tokenVar("chart-5"),
  tokenVar("overspend"),
];

export const CHART_GRID_PROPS = {
  strokeDasharray: "3 3",
  opacity: 0.4,
} as const;
