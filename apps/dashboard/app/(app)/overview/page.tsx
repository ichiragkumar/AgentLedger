// Overview page — ledger-web-dashboard owner (spec 17 §Overview).
// Async Server Component. Mock data uses the SAME shapes as lib/api
// (SpendSummary, TopRequest). No fetching here.
// TODO(API): replace mocks with useOverview()/useRealtime() hooks
// (ledger-web-backend) + GET /api/spend + SSE alerts; range from filter.store.

import type { SpendSummary, TopRequest } from "@/lib/api";
import CachePanel from "@/components/cache-panel";
import RoutingPanel from "@/components/routing-panel";
import { BudgetPanel } from "@/components/budget-panel";
import TopologyPanel from "@/components/topology-panel";
import StatCard from "@/components/cards/stat-card";
import AlertCard from "@/components/cards/alert-card";
import CostOverTime from "@/components/charts/cost-over-time";
import SpendByAgent from "@/components/charts/spend-by-agent";
import ModelDistribution from "@/components/charts/model-distribution";
import Link from "next/link";

export const dynamic = "force-dynamic";

const RANGES = ["24h", "7d", "30d", "custom"] as const;

const summary: SpendSummary = {
  spend24h: 18.42,
  spend7d: 121.9,
  spend30d: 412.55,
  requests24h: 1843,
  byModel: [
    { model: "gemini-2.0-flash", spend: 6.11, requests: 920 },
    { model: "claude-3-5-haiku", spend: 22.4, requests: 410 },
    { model: "claude-3-5-sonnet", spend: 58.2, requests: 260 },
    { model: "gpt-4o", spend: 35.19, requests: 253 },
  ],
  byAgent: [
    { agent: "writer", spend: 42.1, requests: 610 },
    { agent: "researcher", spend: 31.5, requests: 540 },
    { agent: "reviewer", spend: 24.8, requests: 402 },
    { agent: "planner", spend: 15.2, requests: 180 },
    { agent: "support-bot", spend: 8.3, requests: 111 },
  ],
  byTeam: [
    { team: "content", spend: 88.4, requests: 1210 },
    { team: "support", spend: 33.5, requests: 633 },
  ],
  trend: [
    { day: "09-07", spend: 6.2, requests: 210 },
    { day: "09-08", spend: 7.8, requests: 244 },
    { day: "09-09", spend: 5.4, requests: 190 },
    { day: "09-10", spend: 9.1, requests: 301 },
    { day: "09-11", spend: 8.3, requests: 280 },
    { day: "09-12", spend: 10.5, requests: 330 },
    { day: "09-13", spend: 7.2, requests: 240 },
    { day: "09-14", spend: 6.9, requests: 228 },
    { day: "09-15", spend: 11.4, requests: 352 },
    { day: "09-16", spend: 9.8, requests: 310 },
    { day: "09-17", spend: 12.6, requests: 388 },
    { day: "09-18", spend: 10.1, requests: 322 },
    { day: "09-19", spend: 8.2, requests: 265 },
    { day: "09-20", spend: 8.4, requests: 271 },
  ],
};

const alerts = [
  { title: "Budget warning: content", message: "Team content at 82% of monthly cap — downgrade guard armed.", ts: "09:41", severity: "warning" as const },
  { title: "Cache hit rate up", message: "Semantic cache admitted 34 new entries; hit rate 61% → 64%.", ts: "09:12", severity: "info" as const },
  { title: "Escalation spike: support-bot", message: "Cheap→frontier retries at 11% (budget line 10%).", ts: "08:57", severity: "critical" as const },
];

const _requestsShapeCheck: TopRequest[] = [];

export default async function OverviewPage() {
  void _requestsShapeCheck;
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Good morning — how much, where?</h1>
          <p className="text-sm text-zinc-500">Token spend across agents, models and teams.</p>
        </div>
        {/* Range dropdown (mock): selected range drives all cards via filter.store. */}
        <div role="group" aria-label="Date range" className="flex gap-1 rounded-lg border border-zinc-300 p-1 dark:border-zinc-700">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={r === "7d"}
              title="Range selection wires to filter.store (backend)"
              className={`rounded-md px-3 py-1 text-sm ${r === "7d" ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
            >
              {r}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Spend" value="$121.90" sub="last 7 days" deltaPct={-8.2} />
        <StatCard label="Tokens Used" value="4.2M" sub="in 2.9M · out 1.3M" deltaPct={4.5} />
        <StatCard label="Cache Hit Rate" value="64.0%" sub="exact + semantic" deltaPct={3.1} invert={false} />
        <StatCard label="Saved This Week" value="$38.20" sub="vs always-frontier" deltaPct={12.4} invert={false} />
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Cost over time</h2>
        <CostOverTime data={summary.trend} />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Spend by agent</h2>
            <Link href="/agents" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">View all</Link>
          </div>
          <SpendByAgent rows={summary.byAgent} />
        </section>
        <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Model distribution</h2>
          <ModelDistribution rows={summary.byModel} />
        </section>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Recent alerts</h2>
          <span className="text-xs text-zinc-500">SSE live feed lands with use-realtime (backend) · max 5</span>
        </div>
        <ul className="space-y-2">
          {alerts.map((a) => (
            <AlertCard key={a.title} {...a} />
          ))}
        </ul>
      </section>

      {/* Live-MVP phase panels, reused props-only with overview mocks. */}
      <CachePanel
        hitRatePct={64}
        hits={1180}
        misses={663}
        savedUSD={9.4}
        savedWeekUSD={38.2}
        windowLabel="last 7d"
        cacheSize={212}
        avgLookupMs={8.5}
        threshold={0.92}
        topQueries={[
          { query: "summarize onboarding doc", hits: 84, savedUSD: 3.1 },
          { query: "draft release notes", hits: 51, savedUSD: 1.8 },
        ]}
      />
      <RoutingPanel
        distribution={[
          { model: "gemini-2.0-flash", share: 0.5 },
          { model: "claude-3-5-haiku", share: 0.22 },
          { model: "claude-3-5-sonnet", share: 0.14 },
          { model: "gpt-4o", share: 0.14 },
        ]}
        wouldHaveSpent={160.1}
        spent={121.9}
        qualityPerModel={[
          { model: "gemini-2.0-flash", score: 0.78 },
          { model: "claude-3-5-haiku", score: 0.84 },
          { model: "claude-3-5-sonnet", score: 0.91 },
          { model: "gpt-4o", score: 0.93 },
        ]}
        escalationRate={0.07}
        windowLabel="last 7d"
      />
      <BudgetPanel
        teamName="content"
        budgetUSD={500}
        spentUSD={410}
        utilizationPct={82}
        forecastUSD={486}
        forecastMessage="at this rate $486 by month end"
        burndown={summary.trend.map((t, i) => ({ date: t.day, idealCum: (500 / 14) * (i + 1), actualCum: summary.trend.slice(0, i + 1).reduce((s, p) => s + p.spend, 0) * 3.4 }))}
      />
      <TopologyPanel
        chainId="content-pipeline"
        steps={[
          { id: "planner", depth: 0, model: "claude-3-5-sonnet", costUsd: 0.042, quality: 0.9, failureRate: 0.02, criticality: 0.9, tier: "frontier" },
          { id: "researcher", depth: 1, model: "claude-3-5-haiku", costUsd: 0.018, quality: 0.84, failureRate: 0.05, criticality: 0.5, tier: "standard" },
          { id: "writer", depth: 2, model: "gemini-2.0-flash", costUsd: 0.006, quality: 0.78, failureRate: 0.08, criticality: 0.2, tier: "cheap" },
          { id: "reviewer", depth: 3, model: "claude-3-5-sonnet", costUsd: 0.031, quality: 0.92, failureRate: 0.03, criticality: 0.85, tier: "frontier" },
        ]}
        edges={[
          { from: "planner", to: "researcher" },
          { from: "researcher", to: "writer" },
          { from: "writer", to: "reviewer" },
        ]}
        expectedTotalUsd={0.104}
        savingsVsUniform={0.3}
      />
    </div>
  );
}
