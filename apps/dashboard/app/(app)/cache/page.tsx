// Cache page — ledger-web-dashboard owner (spec 17 §Cache).
// Async Server Component. Reuses CachePanel (props-only) + CacheHitRate.
// Config form is mock: threshold slider 0.80–0.99 + TTL → API save + toast,
// flush = confirmation dialog (all backend mutations).
// TODO(API): stats from GET /api/cache/stats; save/flush via management plane.

import CachePanel from "@/components/cache-panel";
import CacheHitRate from "@/components/charts/cache-hit-rate";
import StatCard from "@/components/cards/stat-card";

export const dynamic = "force-dynamic";

export default async function CachePage() {
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Cache</h1>
        <p className="text-sm text-zinc-500">Stop paying twice — exact + semantic hit analytics.</p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Hit Rate" value="64.0%" sub="ring headline" deltaPct={3.1} invert={false} />
        <StatCard label="Saved" value="$38.20" sub="ROI headline · this week" deltaPct={12.4} invert={false} />
        <StatCard label="Hits" value="1,180" sub="last 7d" deltaPct={6.0} invert={false} />
        <StatCard label="Avg latency" value="8.5ms" sub="lookup overhead" deltaPct={-2.0} invert={false} />
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Exact vs semantic · 7d</h2>
        <CacheHitRate
          series={[
            { day: "09-14", exact: 41, semantic: 18 },
            { day: "09-15", exact: 43, semantic: 19 },
            { day: "09-16", exact: 40, semantic: 22 },
            { day: "09-17", exact: 44, semantic: 21 },
            { day: "09-18", exact: 42, semantic: 23 },
            { day: "09-19", exact: 45, semantic: 20 },
            { day: "09-20", exact: 44, semantic: 20 },
          ]}
        />
      </section>

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
          { query: "triage support thread #4821", hits: 33, savedUSD: 1.1 },
        ]}
      />

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Configuration</h2>
        {/* Mock form: on save → API persists, applies immediately, toast confirms.
            Submit wiring (server action / client handler) lands with backend. */}
        <form className="grid max-w-lg grid-cols-1 gap-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Semantic threshold (0.80–0.99): 0.92</span>
            <input type="range" min={0.8} max={0.99} step={0.01} defaultValue={0.92} aria-label="Semantic threshold" className="w-full" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Default TTL (seconds)</span>
            <input type="number" defaultValue={3600} aria-label="Default TTL seconds" className="w-40 rounded-md border border-zinc-300 px-3 py-1.5 font-mono dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <div className="flex gap-2">
            <button type="submit" title="Save wires to management plane (backend)" className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white">
              Save
            </button>
            <button type="button" title="Flush requires confirmation dialog, then purge (backend)" className="rounded-md border border-red-300 px-4 py-1.5 text-sm text-red-600 dark:border-red-900">
              Flush cache…
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
