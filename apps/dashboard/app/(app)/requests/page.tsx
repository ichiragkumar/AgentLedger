// Requests page — ship-track builder (spec 17 §Requests).
// Live: rows from GET /api/requests (top-10 by cost, Postgres), agent options
// from GET /api/agents. Filters (agent/team/model/status/date) + sort apply
// client-side over the live rows; expandable rows show cost math + metadata.
// Accepts ?agent= (agent-detail "View requests" deep link).
// Table is inline — live ids arrive as strings and rows carry no cache/route
// annotations yet, so the mock component shape would mislead.

"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, Fragment, useEffect, useMemo, useState } from "react";
import { getAgents } from "@/lib/api-ext";
import { getTopRequests, type TopRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

type SortKey = "ts" | "cost_usd" | "latency_ms";

function statusMatch(code: number, f: string): boolean {
  if (f === "all") return true;
  if (f === "5xx") return code >= 500;
  return String(code) === f;
}

function RequestsLive() {
  const search = useSearchParams();
  const [requests, setRequests] = useState<TopRequest[]>([]);
  const [agentOptions, setAgentOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fAgent, setFAgent] = useState(search.get("agent") ?? "all");
  const [fTeam, setFTeam] = useState("all");
  const [fModel, setFModel] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [fDate, setFDate] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("ts");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [reqs, ags] = await Promise.all([getTopRequests(), getAgents({ limit: 200 }).catch(() => null)]);
      setRequests(reqs);
      if (ags) setAgentOptions(ags.agents.map((a) => a.name));
    } catch {
      setError("unavailable");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const teams = useMemo(() => [...new Set(requests.map((r) => r.team_id).filter(Boolean))], [requests]);
  const models = useMemo(() => [...new Set(requests.map((r) => r.model).filter(Boolean))], [requests]);

  const filtered = useMemo(() => {
    const rows = requests.filter(
      (r) =>
        (fAgent === "all" || r.agent_id === fAgent) &&
        (fTeam === "all" || r.team_id === fTeam) &&
        (fModel === "all" || r.model === fModel) &&
        statusMatch(r.status_code, fStatus) &&
        (!fDate || new Date(r.ts).toISOString().slice(0, 10) === fDate)
    );
    rows.sort((a, b) => {
      if (sortKey === "ts")
        return sortDir * (new Date(a.ts).getTime() - new Date(b.ts).getTime());
      return sortDir * (Number(a[sortKey]) - Number(b[sortKey]));
    });
    return rows;
  }, [requests, fAgent, fTeam, fModel, fStatus, fDate, sortKey, sortDir]);

  const resetPage = () => setPage(0);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const selectCls =
    "ml-1 rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Requests</h1>
          <p className="text-sm text-zinc-500">
            Live log — {requests.length} rows (server top-10 by cost) · filters apply client-side.
          </p>
        </div>
        <span title="Export CSV deferred — lands with backend" className="cursor-not-allowed rounded-md border border-zinc-300 px-3 py-1.5 text-sm opacity-50 dark:border-zinc-700">
          Export CSV (soon)
        </span>
      </header>

      <section aria-label="Request filters" className="flex flex-wrap gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <label className="text-xs text-zinc-500">
          Agent
          <select aria-label="Filter by agent" value={fAgent} onChange={(e) => { setFAgent(e.target.value); resetPage(); }} className={selectCls}>
            <option value="all">all</option>
            {[...new Set([...agentOptions, ...requests.map((r) => r.agent_id)].filter(Boolean))].map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-zinc-500">
          Team
          <select aria-label="Filter by team" value={fTeam} onChange={(e) => { setFTeam(e.target.value); resetPage(); }} className={selectCls}>
            <option value="all">all</option>
            {teams.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-zinc-500">
          Model
          <select aria-label="Filter by model" value={fModel} onChange={(e) => { setFModel(e.target.value); resetPage(); }} className={selectCls}>
            <option value="all">all</option>
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-zinc-500">
          Status
          <select aria-label="Filter by status" value={fStatus} onChange={(e) => { setFStatus(e.target.value); resetPage(); }} className={selectCls}>
            {["all", "200", "429", "5xx"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-zinc-500">
          Date
          <input type="date" aria-label="Filter by date" value={fDate} onChange={(e) => { setFDate(e.target.value); resetPage(); }} className={selectCls} />
        </label>
        <label className="text-xs text-zinc-500">
          Sort
          <select
            aria-label="Sort requests"
            value={`${sortKey}:${sortDir}`}
            onChange={(e) => {
              const [k, d] = e.target.value.split(":");
              setSortKey(k as SortKey);
              setSortDir(Number(d) as 1 | -1);
              resetPage();
            }}
            className={selectCls}
          >
            <option value="ts:-1">newest</option>
            <option value="ts:1">oldest</option>
            <option value="cost_usd:-1">costliest</option>
            <option value="cost_usd:1">cheapest</option>
            <option value="latency_ms:-1">slowest</option>
            <option value="latency_ms:1">fastest</option>
          </select>
        </label>
        <span className="ml-auto self-center text-xs text-zinc-500">
          {filtered.length} rows · page {current + 1}/{pages}
        </span>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Log (expandable)</h2>
        {loading ? (
          <div aria-label="Loading requests" className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="rounded-lg border border-red-300 p-4 text-sm dark:border-red-900">
            <p className="font-medium text-red-600">Requests unavailable ({error}).</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-2 rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
            >
              Retry
            </button>
          </div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-zinc-500">No requests match — adjust filters or send traffic through the proxy.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
                  <th className="w-8 py-1 pr-2" aria-label="Expand" />
                  <th className="py-1 pr-3 font-medium">Time</th>
                  <th className="py-1 pr-3 font-medium">Model</th>
                  <th className="py-1 pr-3 font-medium">Agent</th>
                  <th className="py-1 pr-3 text-right font-medium">Cost</th>
                  <th className="py-1 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const key = String(r.id);
                  const open = expanded === key;
                  return (
                    <Fragment key={key}>
                      <tr className="border-b border-zinc-100 dark:border-zinc-900">
                        <td className="py-1 pr-2">
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-label={`${open ? "Collapse" : "Expand"} request ${key}`}
                            onClick={() => setExpanded(open ? null : key)}
                            className="rounded border border-zinc-300 px-1.5 text-xs dark:border-zinc-700"
                          >
                            {open ? "−" : "+"}
                          </button>
                        </td>
                        <td className="whitespace-nowrap py-1 pr-3 font-mono text-xs">{new Date(r.ts).toLocaleString()}</td>
                        <td className="py-1 pr-3 font-mono text-xs">{r.model}</td>
                        <td className="py-1 pr-3 font-mono text-xs">{r.agent_id || "—"}</td>
                        <td className="py-1 pr-3 text-right font-mono tabular-nums">${Number(r.cost_usd).toFixed(4)}</td>
                        <td className="py-1 text-right font-mono text-xs">{r.status_code}</td>
                      </tr>
                      {open && (
                        <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                          <td />
                          <td colSpan={5} className="px-2 py-3">
                            <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                              <div>
                                <dt className="font-medium text-zinc-500">Cost math</dt>
                                <dd className="font-mono">
                                  {r.tokens_in} in + {r.tokens_out} out → ${Number(r.cost_usd).toFixed(4)}
                                </dd>
                              </div>
                              <div>
                                <dt className="font-medium text-zinc-500">Latency</dt>
                                <dd className="font-mono">{r.latency_ms} ms · team {r.team_id || "—"}</dd>
                              </div>
                              <div>
                                <dt className="font-medium text-zinc-500">Annotations</dt>
                                <dd className="text-zinc-600 dark:text-zinc-400">
                                  cache/route/enforce annotations land with Phases 2–4 APIs (not yet stored).
                                </dd>
                              </div>
                              <div>
                                <dt className="font-medium text-zinc-500">Prompt / response</dt>
                                <dd className="text-zinc-600 dark:text-zinc-400">
                                  Bodies are not stored — metadata only, PII-free by construction.
                                </dd>
                              </div>
                            </dl>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
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

export default function RequestsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading requests…</p>}>
      <RequestsLive />
    </Suspense>
  );
}
