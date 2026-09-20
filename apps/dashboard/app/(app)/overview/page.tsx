"use client";

// Overview page — live data via /api/spend + /api/alerts, realtime refresh
// via SSE (useRealtime). Range comes from filter.store; skeleton while
// loading, guided empty state at zero traffic, retry on error.
// Phase panels below stay on showcase props until each phase page wires its
// live hook (tracked in spec 20).

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAlerts, type Alert } from "@/lib/api-ext";
import { getSpendSummary, type SpendSummary } from "@/lib/api";
import { useFilterStore, type DateRange } from "@/lib/stores/filter.store";
import { useRealtime } from "@/lib/hooks/use-realtime";
import CachePanel from "@/components/cache-panel";
import RoutingPanel from "@/components/routing-panel";
import { BudgetPanel } from "@/components/budget-panel";
import TopologyPanel from "@/components/topology-panel";
import StatCard from "@/components/cards/stat-card";
import AlertCard from "@/components/cards/alert-card";
import CostOverTime from "@/components/charts/cost-over-time";
import SpendByAgent from "@/components/charts/spend-by-agent";
import ModelDistribution from "@/components/charts/model-distribution";
import { OverviewSkeleton } from "@/components/layout/skeletons";

const RANGES: DateRange[] = ["24h", "7d", "30d"];

const fmtUSD = (n: number) =>
  n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Deterministic UTC stamp (no locale hydration drift).
const fmtTs = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 16).replace("T", " ");
};

export default function OverviewPage() {
  const range = useFilterStore((s) => s.range);
  const setRange = useFilterStore((s) => s.setRange);
  const [summary, setSummary] = useState<SpendSummary | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastFetch = useRef(0);
  const { events } = useRealtime(true);

  const refresh = useCallback(async () => {
    const now = Date.now();
    if (now - lastFetch.current < 3000) return; // throttle SSE bursts
    lastFetch.current = now;
    setLoading(true);
    setError(null);
    try {
      const [s, a] = await Promise.all([getSpendSummary(), getAlerts(5)]);
      setSummary(s);
      setAlerts(a.alerts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (events.length > 0) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length]);

  // Toast on fresh alert events (budget breach → visible within seconds).
  const [toast, setToast] = useState<string | null>(null);
  const seenAlerts = useRef(0);
  useEffect(() => {
    const fresh = events.filter((e) => e.type === "alert");
    if (fresh.length > seenAlerts.current) {
      seenAlerts.current = fresh.length;
      const latest = fresh[0];
      setToast(`${latest.action} — ${latest.budgetId || "budget"} · ${latest.detail || ""}`.slice(0, 160));
      const t = setTimeout(() => setToast(null), 8000);
      return () => clearTimeout(t);
    }
  }, [events]);

  if (loading && !summary) return <OverviewSkeleton />;

  if (error && !summary) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-zinc-200 bg-white p-10 text-center dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-lg font-semibold">Overview unavailable</h1>
        <p className="text-sm text-zinc-500">Could not reach the dashboard API ({error}). Is the dev server running?</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Retry
        </button>
      </div>
    );
  }

  const s: SpendSummary = summary ?? {
    spend24h: 0, spend7d: 0, spend30d: 0, requests24h: 0, byModel: [], byAgent: [], byTeam: [], trend: [],
  };
  const spend = range === "24h" ? s.spend24h : range === "30d" ? s.spend30d : s.spend7d;
  const empty = s.requests24h === 0 && s.spend30d === 0 && alerts.length === 0;

  return (
    <div className="flex flex-col gap-5">
      {toast && (
        <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {toast}
        </div>
      )}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-sm text-zinc-500">Token spend across agents, models and teams.</p>
        </div>
        <div role="group" aria-label="Date range" className="flex gap-1 rounded-lg border border-zinc-300 p-1 dark:border-zinc-700">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1 text-sm ${range === r ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
            >
              {r}
            </button>
          ))}
        </div>
      </header>

      {empty ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-950">
          <h2 className="text-lg font-semibold">No traffic yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">
            Point an agent at the proxy — <code className="rounded bg-zinc-100 px-1 font-mono text-xs dark:bg-zinc-800">OPENAI_BASE_URL=http://localhost:8787/v1</code> with
            your virtual key — and spend by agent, model and team appears here within seconds.
          </p>
          <Link href="/keys" className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
            Create your first key
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={`Total Spend · ${range}`} value={fmtUSD(spend)} sub={`over the last ${range}`} />
            <StatCard label="Requests · 24h" value={`${s.requests24h.toLocaleString("en-US")}`} sub="via proxy" invert={false} />
            <StatCard label="Active Models" value={`${s.byModel.length}`} sub="in selected window" invert={false} />
            <StatCard label="Active Agents" value={`${s.byAgent.length}`} sub="attributed via headers" invert={false} />
          </div>

          <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="mb-3 text-lg font-semibold tracking-tight">Cost over time</h2>
            <CostOverTime data={s.trend} />
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold tracking-tight">Spend by agent</h2>
                <Link href="/agents" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">View all</Link>
              </div>
              <SpendByAgent rows={s.byAgent.slice(0, 5)} />
            </section>
            <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <h2 className="mb-3 text-lg font-semibold tracking-tight">Model distribution</h2>
              <ModelDistribution rows={s.byModel} />
            </section>
          </div>

          <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold tracking-tight">Recent alerts</h2>
              <span className="text-xs text-zinc-500">live via SSE · max 5</span>
            </div>
            {alerts.length === 0 ? (
              <p className="text-sm text-zinc-500">No alerts — budget breaches and policy denials land here in real time.</p>
            ) : (
              <ul className="space-y-2">
                {alerts.map((a) => (
                  <AlertCard key={a.id} title={a.title} message={a.detail} ts={fmtTs(a.ts)} severity={a.severity} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {/* Live-MVP phase panels, still on showcase props (each phase page wires its live hook next). */}
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
        burndown={s.trend.map((t, i) => ({ date: t.day, idealCum: (500 / 14) * (i + 1), actualCum: s.trend.slice(0, i + 1).reduce((sum, p) => sum + p.spend, 0) * 3.4 }))}
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
