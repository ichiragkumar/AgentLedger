// CachePanel — Phase 2 (Saver) dashboard panel (spec 05 §2.5).
//
// Presentational only: all data arrives via props (a Server Component or
// route handler aggregates Postgres request logs + hook Stats). This file
// adds no data fetching and touches no other dashboard files.
//
// Wire-up (dashboard owner): <CachePanel {...stats} /> inside the overview
// page; feed it from GET /api/cache/stats when that route lands.
"use client";

import React from "react";

export interface TopCachedQuery {
  query: string;
  hits: number;
  savedUSD: number;
}

export interface CachePanelProps {
  /** 0–100. Ring + headline number. */
  hitRatePct: number;
  /** Total HIT responses in window. */
  hits: number;
  /** Total MISS responses in window. */
  misses: number;
  /** Dollars avoided in window (within 10% of actual per acceptance). */
  savedUSD: number;
  /** Dollars avoided trailing-7d (headline: "$X saved this week"). */
  savedWeekUSD: number;
  /** Window label, e.g. "last 24h". */
  windowLabel?: string;
  /** Live entries across both layers. */
  cacheSize: number;
  /** Mean lookup overhead ms (exact p99 <1ms, semantic 5–20ms). */
  avgLookupMs?: number;
  /** Admit threshold in [0.85, 0.99]. */
  threshold?: number;
  /** Drill-down rows by agent (acceptance: drill-down by agent). */
  topQueries: TopCachedQuery[];
}

function fmtUSD(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Ring({ pct }: { pct: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={`hit rate ${clamped.toFixed(1)} percent`}>
      <circle cx="48" cy="48" r={r} fill="none" strokeWidth="10" className="stroke-muted" stroke="currentColor" opacity={0.15} />
      <circle
        cx="48"
        cy="48"
        r={r}
        fill="none"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c - (c * clamped) / 100}
        transform="rotate(-90 48 48)"
        className="stroke-emerald-500"
      />
      <text x="48" y="48" textAnchor="middle" dominantBaseline="central" className="fill-foreground text-lg font-bold">
        {clamped.toFixed(0)}%
      </text>
    </svg>
  );
}

export default function CachePanel({
  hitRatePct,
  hits,
  misses,
  savedUSD,
  savedWeekUSD,
  windowLabel = "last 24h",
  cacheSize,
  avgLookupMs,
  threshold = 0.92,
  topQueries,
}: CachePanelProps) {
  return (
    <section aria-label="cache analytics" className="rounded-xl border p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Cache · Saver</h2>
        <span className="text-xs text-muted-foreground">{windowLabel}</span>
      </div>

      <p className="text-sm">
        <span className="font-bold text-emerald-600">{fmtUSD(savedWeekUSD)} saved this week</span>
        <span className="text-muted-foreground"> via caching</span>
      </p>

      <div className="flex items-center gap-6">
        <Ring pct={hitRatePct} />
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Hits</dt>
          <dd className="text-right font-mono">{hits.toLocaleString()}</dd>
          <dt className="text-muted-foreground">Misses</dt>
          <dd className="text-right font-mono">{misses.toLocaleString()}</dd>
          <dt className="text-muted-foreground">$ saved ({windowLabel})</dt>
          <dd className="text-right font-mono">{fmtUSD(savedUSD)}</dd>
          <dt className="text-muted-foreground">Cache size</dt>
          <dd className="text-right font-mono">{cacheSize.toLocaleString()}</dd>
          {avgLookupMs !== undefined && (
            <>
              <dt className="text-muted-foreground">Avg lookup</dt>
              <dd className="text-right font-mono">{avgLookupMs.toFixed(1)} ms</dd>
            </>
          )}
          <dt className="text-muted-foreground">Threshold</dt>
          <dd className="text-right font-mono">{threshold.toFixed(2)}</dd>
        </dl>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">Top cached queries</h3>
        {topQueries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cache hits in this window yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-2 font-normal">Query</th>
                <th className="py-1 pr-2 font-normal text-right">Hits</th>
                <th className="py-1 font-normal text-right">Saved</th>
              </tr>
            </thead>
            <tbody>
              {topQueries.slice(0, 10).map((q) => (
                <tr key={q.query} className="border-t">
                  <td className="py-1 pr-2 truncate max-w-[280px]" title={q.query}>
                    {q.query}
                  </td>
                  <td className="py-1 pr-2 text-right font-mono">{q.hits}</td>
                  <td className="py-1 text-right font-mono">{fmtUSD(q.savedUSD)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
