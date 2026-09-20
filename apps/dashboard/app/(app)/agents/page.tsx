// Agents page — ship-track builder (spec 17 §Agents).
// Live: rows from useAgents() + GET /api/agents (server-side search + range).
// Sort/paginate client-side (20/page); list state (q/sort/page/range) syncs to
// the URL so detail pages can link back without losing it (?from=…).
// NOTE: table is inline (not AgentsTable) — the live API exposes model COUNT
// and null cacheHitRate (request_logs has no cache column), so the mock
// columns (single model, cache %) would render fake data.

"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useAgents } from "@/lib/hooks/use-agents";
import type { AgentSummary } from "@/lib/api-ext";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const RANGES = ["24h", "7d", "30d"] as const;

type SortKey = "name" | "spend" | "tokens" | "requests" | "lastSeen";

function fmtSpend(v: number): string {
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v > 0) return `$${v.toFixed(6)}`;
  return "$0.00";
}

function AgentsLive() {
  const router = useRouter();
  const search = useSearchParams();
  const [range, setRange] = useState<string>(search.get("range") ?? "30d");
  const [input, setInput] = useState(search.get("q") ?? "");
  const [sortKey, setSortKey] = useState<SortKey>((search.get("sort") as SortKey) || "spend");
  const [sortDir, setSortDir] = useState<1 | -1>(search.get("dir") === "asc" ? 1 : -1);
  const [page, setPage] = useState(Number(search.get("page") ?? 0) || 0);

  const { agents, q, setQ, loading, error, refresh } = useAgents({ range });

  // Debounced server-side search (hook refetches per q change).
  useEffect(() => {
    const t = setTimeout(() => {
      if (input !== q) {
        setQ(input);
        setPage(0);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  // Persist list state to the URL for state-preserving back from detail.
  useEffect(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (range !== "30d") p.set("range", range);
    if (sortKey !== "spend") p.set("sort", sortKey);
    if (sortDir === 1) p.set("dir", "asc");
    if (page > 0) p.set("page", String(page));
    const qs = p.toString();
    router.replace(`/agents${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [q, range, sortKey, sortDir, page, router]);

  const sorted = useMemo(() => {
    const rows = [...agents];
    rows.sort((a, b) => {
      if (sortKey === "name") return sortDir * a.name.localeCompare(b.name);
      if (sortKey === "lastSeen")
        return sortDir * (new Date(a.lastSeen ?? 0).getTime() - new Date(b.lastSeen ?? 0).getTime());
      return sortDir * ((a[sortKey] as number) - (b[sortKey] as number));
    });
    return rows;
  }, [agents, sortKey, sortDir]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = sorted.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  const from = (() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (range !== "30d") p.set("range", range);
    if (sortKey !== "spend") p.set("sort", sortKey);
    if (sortDir === 1) p.set("dir", "asc");
    if (current > 0) p.set("page", String(current));
    return p.toString();
  })();

  const totals = useMemo(
    () => ({
      spend: agents.reduce((s, a) => s + a.spend, 0),
      requests: agents.reduce((s, a) => s + a.requests, 0),
    }),
    [agents]
  );

  const toggleSort = (key: SortKey) => {
    setPage(0);
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(key === "name" ? 1 : -1);
    }
  };

  const HEADERS: { key: SortKey; label: string; numeric?: boolean }[] = [
    { key: "name", label: "Name" },
    { key: "spend", label: "Spend", numeric: true },
    { key: "tokens", label: "Tokens", numeric: true },
    { key: "requests", label: "Requests", numeric: true },
    { key: "lastSeen", label: "Last seen", numeric: true },
  ];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
          <p className="text-sm text-zinc-500">
            {loading ? "Loading live agents…" : (
              <>
                {agents.length} agents · {fmtSpend(totals.spend)} · {totals.requests.toLocaleString()} requests ({range})
              </>
            )}
          </p>
        </div>
        <label className="text-xs text-zinc-500">
          Range{" "}
          <select
            aria-label="Date range"
            value={range}
            onChange={(e) => {
              setRange(e.target.value);
              setPage(0);
            }}
            className="rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {RANGES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
      </header>

      <section aria-label="Agent filters" className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search agents…"
          aria-label="Search agents"
          className="w-full max-w-xs rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <span className="text-xs text-zinc-500">
          {sorted.length} match · page {current + 1}/{pages}
        </span>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">All agents</h2>
        {loading ? (
          <div aria-label="Loading agents" className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="rounded-lg border border-red-300 p-4 text-sm dark:border-red-900">
            <p className="font-medium text-red-600">Agents unavailable ({error}).</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-2 rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
            >
              Retry
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
            <p className="text-sm font-medium">No agents in range.</p>
            <p className="mt-1 text-sm text-zinc-500">
              Tag requests with X-Agent-Id to attribute cost — see onboarding step 2 (first virtual key).
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                  {HEADERS.map((h) => (
                    <th key={h.key} className={`py-1.5 pr-3 font-medium text-zinc-500 ${h.numeric ? "text-right" : ""}`}>
                      <button type="button" onClick={() => toggleSort(h.key)} aria-label={`Sort by ${h.label}`}>
                        {h.label}
                        {sortKey === h.key && <span aria-hidden>{sortDir === 1 ? " ▲" : " ▼"}</span>}
                      </button>
                    </th>
                  ))}
                  <th className="py-1.5 pr-3 text-right font-medium text-zinc-500">Models</th>
                  <th className="py-1.5 pr-3 text-right font-medium text-zinc-500">Cache</th>
                  <th className="py-1.5 text-right font-medium text-zinc-500">Avg latency</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a: AgentSummary) => (
                  <tr key={a.name} className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900">
                    <td className="py-1.5 pr-3">
                      <Link
                        href={`/agents/${encodeURIComponent(a.name)}${from ? `?from=${encodeURIComponent(from)}` : ""}`}
                        className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {a.name}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{fmtSpend(a.spend)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{a.tokens.toLocaleString()}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{a.requests.toLocaleString()}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-xs">
                      {a.lastSeen ? new Date(a.lastSeen).toLocaleString() : "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{a.models}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-xs tabular-nums">
                      {a.cacheHitRate == null ? "n/a" : `${a.cacheHitRate.toFixed(0)}%`}
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs tabular-nums">{Math.round(a.avgLatencyMs)} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={current === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-md border border-zinc-300 px-3 py-1 text-sm disabled:opacity-40 dark:border-zinc-700"
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={current >= pages - 1}
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              className="rounded-md border border-zinc-300 px-3 py-1 text-sm disabled:opacity-40 dark:border-zinc-700"
            >
              Next →
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export default function AgentsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading agents…</p>}>
      <AgentsLive />
    </Suspense>
  );
}
