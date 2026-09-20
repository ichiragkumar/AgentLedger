export type BudgetNode = {
  id: string;
  level: "org" | "team" | "project" | "agent";
  name: string;
  limit: number;
  spent: number;
  utilizationPct: number;
  forecastUSD: number;
  state: "healthy" | "watch" | "warning" | "downgrading" | "stopped";
  children: BudgetNode[];
};

export type BudgetAlert = {
  ts: string;
  budgetId: string;
  trigger: string;
  action: string;
};

// --- Additive (ledger-web-system): windows + AlertBanner severity. ---

/** Budget rollup window for burndown charts. */
export type BudgetWindow = "day" | "week" | "month";

/** Threshold rule: alert (then enforce) as utilization crosses pct. */
export type BudgetThreshold = {
  pct: number;
  severity: "info" | "warning" | "critical";
  action: "alert" | "downgrade" | "stop";
};
