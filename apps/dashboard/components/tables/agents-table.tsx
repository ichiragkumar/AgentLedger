"use client";

// AgentsTable — ledger-web-dashboard table (spec 17 Agents).
// Sortable + searchable + paginated (20). Rows link to /agents/[id].
// TODO(API): rows from useAgents() hook + GET /api/agents (backend).
// TODO(store): back-from-detail preserves query/page via URL search params.

import Link from "next/link";
import { useMemo, useState } from "react";

export interface AgentRow {
  id: string;
  name: string;
  spend: number;
  tokens: number;
  requests: number;
  cachePct: number;
  model: string;
}

type SortKey = "name" | "spend" | "tokens" | "requests" | "cachePct";

const PAGE_SIZE = 20;
const HEADERS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Name" },
  { key: "spend", label: "Spend", numeric: true },
  { key: "tokens", label: "Tokens", numeric: true },
  { key: "requests", label: "Requests", numeric: true },
  { key: "cachePct", label: "Cache %", numeric: true },
];

export default function AgentsTable({ agents }: { agents: AgentRow[] }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? agents.filter((a) => a.name.toLowerCase().includes(q) || a.model.toLowerCase().includes(q))
      : [...agents];
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string") return sortDir * av.localeCompare(String(bv));
      return sortDir * (Number(av) - Number(bv));
    });
    return rows;
  }, [agents, query, sortKey, sortDir]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    setPage(0);
    if (key === sortKey) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? 1 : -1);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          placeholder="Search agents or models…"
          aria-label="Search agents"
          className="w-full max-w-xs rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <span className="text-xs text-zinc-500">
          {filtered.length} agents · page {current + 1}/{pages}
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
          <p className="text-sm font-medium">No agents match.</p>
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
                <th className="py-1.5 pr-3 font-medium text-zinc-500">Model</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a.id} className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900">
                  <td className="py-1.5 pr-3">
                    <Link href={`/agents/${encodeURIComponent(a.id)}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      {a.name}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums">${a.spend.toFixed(2)}</td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{a.tokens.toLocaleString()}</td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{a.requests.toLocaleString()}</td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{a.cachePct.toFixed(0)}%</td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{a.model}</td>
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
    </div>
  );
}
