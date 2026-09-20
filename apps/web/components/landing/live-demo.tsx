"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Range = "7d" | "30d" | "90d";
type Tab = "overview" | "agents" | "cache" | "routing";

interface AgentSeed {
  id: string;
  model: string;
  requests: number;
  cost: number;
  cacheHit: number;
  tier: "cheap" | "balanced" | "frontier";
}

const RANGE_MULT: Record<Range, number> = { "7d": 1, "30d": 4.1, "90d": 11.8 };

const AGENTS: AgentSeed[] = [
  { id: "support-triage", model: "gpt-4o-mini", requests: 48210, cost: 312.44, cacheHit: 58, tier: "cheap" },
  { id: "code-review", model: "claude-sonnet", requests: 12840, cost: 198.1, cacheHit: 34, tier: "balanced" },
  { id: "data-sync", model: "deepseek-chat", requests: 31200, cost: 41.07, cacheHit: 71, tier: "cheap" },
  { id: "research-deep", model: "claude-opus", requests: 1930, cost: 284.66, cacheHit: 12, tier: "frontier" },
  { id: "embeddings-idx", model: "text-embedding-3", requests: 88400, cost: 22.9, cacheHit: 83, tier: "cheap" },
];

const CACHE_BY_RANGE: Record<Range, { hitRate: number; saved: number; calls: number }> = {
  "7d": { hitRate: 47, saved: 212.4, calls: 182580 },
  "30d": { hitRate: 44, saved: 861.15, calls: 748200 },
  "90d": { hitRate: 41, saved: 2410.7, calls: 2150400 },
};

const ROUTE_SPLIT: Array<{ tier: string; pct: number; tone: string }> = [
  { tier: "cheap", pct: 71, tone: "bg-emerald-500" },
  { tier: "balanced", pct: 22, tone: "bg-amber-500" },
  { tier: "frontier", pct: 7, tone: "bg-red-500" },
];

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function num(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "agents", label: "Agents" },
  { id: "cache", label: "Cache" },
  { id: "routing", label: "Routing" },
];

export default function LiveDemo() {
  const [tab, setTab] = useState<Tab>("overview");
  const [range, setRange] = useState<Range>("7d");
  const [selected, setSelected] = useState<string | null>(null);

  const mult = RANGE_MULT[range];
  const totals = useMemo(() => {
    const cost = AGENTS.reduce((s, a) => s + a.cost * mult, 0);
    const reqs = AGENTS.reduce((s, a) => s + a.requests * mult, 0);
    return { cost, reqs };
  }, [mult]);

  const cache = CACHE_BY_RANGE[range];
  const drill = selected ? AGENTS.find((a) => a.id === selected) ?? null : null;

  return (
    <section aria-labelledby="demo-heading" className="border-y border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">LIVE DEMO</p>
          <h2 id="demo-heading" className="mt-2 text-balance text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl dark:text-white">
            Try it before you install it.
          </h2>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            Seeded sample data — no account, no tracking. Connect your own proxy for live numbers.
          </p>
        </div>

        <div className="mx-auto mt-10 max-w-5xl overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
          {/* Toolbar: tabs + range filter */}
          <div className="flex flex-col gap-3 border-b border-zinc-200 p-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
            <div role="tablist" aria-label="Demo views" className="flex gap-1 overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    tab === t.id
                      ? "bg-indigo-600 text-white"
                      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1" role="group" aria-label="Date range">
              {(Object.keys(RANGE_MULT) as Range[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  aria-pressed={range === r}
                  className={cn(
                    "mono rounded-md px-2.5 py-1.5 font-mono text-xs font-semibold tabular-nums transition-colors",
                    range === r
                      ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                      : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Panels — horizontally scrollable on mobile */}
          <div className="overflow-x-auto">
            <div className="min-w-[560px] p-4 sm:p-5">
              {tab === "overview" && (
                <div role="tabpanel" aria-label="Overview">
                  <dl className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Total spend", value: money(totals.cost) },
                      { label: "Requests", value: num(totals.reqs) },
                      { label: "Cache hit rate", value: `${cache.hitRate}%` },
                    ].map((s) => (
                      <div key={s.label} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                        <dt className="text-xs text-zinc-500 dark:text-zinc-400">{s.label}</dt>
                        <dd className="mono mt-1 font-mono text-lg font-bold tabular-nums text-zinc-950 dark:text-white">
                          {s.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">Spend by agent</p>
                    <div className="space-y-2">
                      {AGENTS.map((a) => {
                        const max = Math.max(...AGENTS.map((x) => x.cost));
                        return (
                          <button
                            key={a.id}
                            onClick={() => {
                              setSelected(a.id);
                              setTab("agents");
                            }}
                            title={`${a.id}: ${money(a.cost * mult)} — view details`}
                            className="group block w-full text-left"
                          >
                            <div className="mb-0.5 flex items-center justify-between text-xs">
                              <span className="font-medium text-zinc-700 group-hover:text-indigo-600 dark:text-zinc-300 dark:group-hover:text-indigo-400">
                                {a.id}
                              </span>
                              <span className="mono font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                                {money(a.cost * mult)}
                              </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                              <div
                                className="h-full rounded-full bg-indigo-600 transition-all dark:bg-indigo-500"
                                style={{ width: `${Math.max(6, (a.cost / max) * 100)}%` }}
                              />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {tab === "agents" && (
                <div role="tabpanel" aria-label="Agents">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                          <th scope="col" className="py-2 pr-3 font-medium">Agent</th>
                          <th scope="col" className="py-2 pr-3 font-medium">Model</th>
                          <th scope="col" className="py-2 pr-3 text-right font-medium">Requests</th>
                          <th scope="col" className="py-2 pr-3 text-right font-medium">Cost</th>
                          <th scope="col" className="py-2 text-right font-medium">Cache</th>
                        </tr>
                      </thead>
                      <tbody>
                        {AGENTS.map((a) => (
                          <tr
                            key={a.id}
                            onClick={() => setSelected(selected === a.id ? null : a.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSelected(selected === a.id ? null : a.id);
                              }
                            }}
                            tabIndex={0}
                            aria-expanded={selected === a.id}
                            title={`${a.id} — activate for details`}
                            className={cn(
                              "cursor-pointer border-b border-zinc-100 transition-colors last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/50",
                              selected === a.id && "bg-indigo-50 dark:bg-indigo-950/30"
                            )}
                          >
                            <td className="py-2.5 pr-3 font-medium text-zinc-900 dark:text-zinc-100">{a.id}</td>
                            <td className="py-2.5 pr-3 font-mono text-xs text-zinc-500 dark:text-zinc-400">{a.model}</td>
                            <td className="mono py-2.5 pr-3 text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                              {num(a.requests * mult)}
                            </td>
                            <td className="mono py-2.5 pr-3 text-right font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                              {money(a.cost * mult)}
                            </td>
                            <td className="mono py-2.5 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                              {a.cacheHit}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {drill && (
                    <div className="mt-3 rounded-md border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/40" aria-live="polite">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {drill.id} <span className="font-mono text-xs font-normal text-zinc-500">· {drill.model}</span>
                        </p>
                        <button
                          onClick={() => setSelected(null)}
                          className="rounded px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-indigo-100 dark:text-zinc-400 dark:hover:bg-indigo-900"
                          aria-label="Close agent details"
                        >
                          Close
                        </button>
                      </div>
                      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                        {[
                          { k: "Requests", v: num(drill.requests * mult) },
                          { k: "Cost", v: money(drill.cost * mult) },
                          { k: "Cache hits", v: `${drill.cacheHit}%` },
                          { k: "Tier", v: drill.tier },
                        ].map((d) => (
                          <div key={d.k} className="rounded bg-white/70 p-2 dark:bg-zinc-900/60">
                            <dt className="text-zinc-500 dark:text-zinc-400">{d.k}</dt>
                            <dd className="mono mt-0.5 font-mono font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{d.v}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}
                </div>
              )}

              {tab === "cache" && (
                <div role="tabpanel" aria-label="Cache">
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Hit rate (live)", value: `${cache.hitRate}%` },
                      { label: "Saved", value: money(cache.saved) },
                      { label: "Calls served", value: num(cache.calls) },
                    ].map((s) => (
                      <div key={s.label} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                        <dt className="text-xs text-zinc-500 dark:text-zinc-400">{s.label}</dt>
                        <dd className="mono mt-1 font-mono text-lg font-bold tabular-nums text-zinc-950 dark:text-white">
                          {s.value}
                        </dd>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4">
                    <div className="mb-1 flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                      <span>Exact hits 60%</span>
                      <span>Semantic hits 40%</span>
                    </div>
                    <div className="flex h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" role="img" aria-label={`Cache hit rate ${cache.hitRate} percent`}>
                      <div className="bg-emerald-500" style={{ width: `${cache.hitRate * 0.6}%` }} title="Exact hits" />
                      <div className="bg-emerald-300" style={{ width: `${cache.hitRate * 0.4}%` }} title="Semantic hits" />
                    </div>
                  </div>
                </div>
              )}

              {tab === "routing" && (
                <div role="tabpanel" aria-label="Routing">
                  <div className="space-y-2.5">
                    {ROUTE_SPLIT.map((r) => (
                      <div key={r.tier}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="font-medium capitalize text-zinc-700 dark:text-zinc-300">{r.tier}</span>
                          <span className="mono font-mono tabular-nums text-zinc-500 dark:text-zinc-400">{r.pct}%</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                          <div className={cn("h-full rounded-full", r.tone)} style={{ width: `${r.pct}%` }} title={`${r.tier}: ${r.pct}%`} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 rounded-md bg-zinc-100 p-3 text-xs leading-5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    Policy: cheap-first with quality guardrails. Only 7% of traffic needs frontier
                    models — the rest is served cheaper with identical evals.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mx-auto mt-6 max-w-5xl text-center">
          <Link
            href="/signup"
            className="inline-flex h-11 items-center rounded-md bg-indigo-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
          >
            Install to see your own data
          </Link>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">One env var · under 5 minutes</p>
        </div>
      </div>
    </section>
  );
}
