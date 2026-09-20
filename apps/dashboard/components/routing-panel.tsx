// RoutingPanel — Phase 3 routing analytics (spec 06 task 3.7).
//
// Presentational only: all data arrives via props from the Next.js read
// plane (Postgres polling, live <5s). No fetch, no store, no deps beyond
// React — the distribution pie renders with a CSS conic-gradient so this
// component never blocks the dashboard's <2s load budget on chart libs.
//
// Backend sources (internal/router):
//   distribution  ← per-model request counts (X-AgentLedger-Tier/Route headers in request_logs)
//   wouldHaveSpent/spent/saved ← Decision.Savings vs always-frontier baseline
//   qualityPerModel ← ModelQuality.Snapshot (judge means per model)
//   escalationRate  ← Guard.EscalationRate (<10% budget line)

export interface DistributionSlice {
  model: string;
  /** Share of routed requests, 0..1. */
  share: number;
  /** Optional brand color override; defaults cycle MODEL_COLORS. */
  color?: string;
}

export interface ModelQuality {
  model: string;
  /** Mean judge score, 0..1. */
  score: number;
}

export interface RoutingPanelProps {
  /** Per-model traffic distribution (sums to ~1). */
  distribution: DistributionSlice[];
  /** "You would have spent $X" — always-frontier baseline. */
  wouldHaveSpent: number;
  /** "You spent $Y" — actual routed spend. */
  spent: number;
  /** "Saved $Z (N%)" — derived when omitted. */
  saved?: number;
  savedPct?: number;
  /** Mean quality score per model (LLM-as-judge). */
  qualityPerModel: ModelQuality[];
  /** Cheap → expensive retry rate; budget line at 10%. */
  escalationRate: number;
  /** Window label, e.g. "last 24h". */
  windowLabel?: string;
}

const MODEL_COLORS = [
  "#22c55e", // cheap tiers — green
  "#38bdf8",
  "#a78bfa",
  "#f59e0b",
  "#ef4444", // frontier — red (expensive)
  "#94a3b8",
];

const MODEL_SHORT: Record<string, string> = {
  "gemini-2.0-flash": "Flash",
  "gemini-1.5-flash": "Flash 1.5",
  "claude-3-5-haiku": "Haiku",
  "claude-3-5-sonnet": "Sonnet",
  "claude-sonnet-4": "Sonnet 4",
  "gpt-5.5-pro": "Frontier",
  "gpt-4o": "GPT-4o",
  "gpt-4o-mini": "4o-mini",
};

function shortName(model: string): string {
  return MODEL_SHORT[model] ?? model;
}

function fmtUSD(n: number): string {
  return "$" + n.toFixed(2);
}

function pieBackground(slices: DistributionSlice[]): string {
  let acc = 0;
  const stops = slices.map((s, i) => {
    const start = acc * 100;
    acc += s.share;
    const color = s.color ?? MODEL_COLORS[i % MODEL_COLORS.length];
    return `${color} ${start.toFixed(1)}% ${(acc * 100).toFixed(1)}%`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

function barColor(score: number): string {
  if (score >= 0.85) return "#22c55e";
  if (score >= 0.6) return "#f59e0b";
  return "#ef4444";
}

export default function RoutingPanel(props: RoutingPanelProps) {
  const {
    distribution,
    wouldHaveSpent,
    spent,
    qualityPerModel,
    escalationRate,
    windowLabel = "last 24h",
  } = props;
  const saved = props.saved ?? Math.max(0, wouldHaveSpent - spent);
  const savedPct =
    props.savedPct ?? (wouldHaveSpent > 0 ? (saved / wouldHaveSpent) * 100 : 0);
  const overBudget = escalationRate >= 0.1;

  return (
    <section aria-label="Routing analytics" data-testid="routing-panel">
      <header>
        <h2>Routing — right model, right price</h2>
        <span>{windowLabel}</span>
      </header>

      <p data-testid="savings-line">
        You would have spent {fmtUSD(wouldHaveSpent)}. You spent{" "}
        {fmtUSD(spent)}. Saved {fmtUSD(saved)} ({savedPct.toFixed(1)}%).
      </p>

      <div data-testid="distribution-pie">
        <div
          role="img"
          aria-label="Model distribution"
          style={{ background: pieBackground(distribution) }}
        />
        <ul>
          {distribution.map((s, i) => (
            <li key={s.model}>
              <span
                style={{
                  background:
                    s.color ?? MODEL_COLORS[i % MODEL_COLORS.length],
                }}
              />
              {shortName(s.model)} — {(s.share * 100).toFixed(1)}%
            </li>
          ))}
        </ul>
      </div>

      <ul data-testid="quality-per-model">
        {qualityPerModel.map((q) => (
          <li key={q.model}>
            {shortName(q.model)} — {(q.score * 100).toFixed(0)}%
            <span
              style={{
                width: `${(q.score * 100).toFixed(0)}%`,
                background: barColor(q.score),
              }}
            />
          </li>
        ))}
      </ul>

      <p data-testid="escalation-rate">
        Escalation rate: {(escalationRate * 100).toFixed(1)}%
        {overBudget ? " — over 10% budget" : " — within 10% budget"}
      </p>
    </section>
  );
}
