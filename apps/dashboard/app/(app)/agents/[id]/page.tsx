// Agent detail — ship-track builder (spec 17 §Agents [id]).
// Live: scoped cards + 7d timeline + model breakdown + top-10 expandable
// requests + budget status + virtual-key prefixes from useAgent(id) +
// GET /api/agents/[id]. Back link preserves list state via ?from=… (set by
// /agents). All tables inline — live shapes (string ids, unknown budgets)
// differ from the mock components.
// NOTE: prompt/response bodies are NOT stored (metadata only) — expandable
// rows show headers + cost math, PII-free by construction.

"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, Fragment, useState } from "react";
import { useAgent } from "@/lib/hooks/use-agents";

export const dynamic = "force-dynamic";

type DetailRequest = {
  id: number | string;
  ts: string;
  model: string;
  team_id?: string;
  project_id?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  latency_ms?: number;
  status_code?: number;
  chain_id?: string;
  virtual_key_prefix?: string;
};

type BudgetLite = {
  id?: string;
  window?: string;
  tokenLimit?: number;
  dollarLimit?: number;
  spentTokens?: number;
  spentUsd?: number;
  resetAt?: string;
};

function fmtSpend(v: number): string {
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v > 0) return `$${v.toFixed(6)}`;
  return "$0.00";
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 font-mono text-xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>
    </div>
  );
}

function AgentDetailLive() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const id = decodeURIComponent(params.id ?? "");
  const from = search.get("from");
  const backHref = `/agents${from ? `?${from}` : ""}`;
  const { agent, loading, error } = useAgent(id || null);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex flex-col gap-5" aria-label="Loading agent detail">
        <div className="h-4 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-8 w-64 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !agent) {
    const notFound = error === "not_found";
    return (
      <div className="flex flex-col gap-4">
        <Link href={backHref} className="w-fit text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          ← Back to agents
        </Link>
        <div role="alert" className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h1 className="font-mono text-xl font-bold">{id}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {notFound ? "Unknown agent — no requests logged for this id." : `Detail unavailable (${error ?? "empty"}).`}
          </p>
        </div>
      </div>
    );
  }

  const requests = (agent.topRequests ?? []) as DetailRequest[];
  const budgets = (agent.budgets ?? []) as BudgetLite[];
  const team = requests[0]?.team_id || "—";
  const maxDay = Math.max(1, ...agent.timeline7d.map((t) => t.spend));

  return (
    <div className="flex flex-col gap-5">
      <Link href={backHref} className="w-fit text-sm text-indigo-600 hover:underline dark:text-indigo-400">
        ← Back to agents
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-bold tracking-tight">{agent.name}</h1>
          <p className="text-sm text-zinc-500">
            Agent detail · team {team} ·{" "}
            {agent.keyPrefixes.length > 0 ? (
              <>virtual key <span className="font-mono">{agent.keyPrefixes.join(", ")}</span></>
            ) : (
              "no virtual-key usage"
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled
            title="Edit agent — no mutation API yet"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700"
          >
            Edit
          </button>
          <Link
            href={`/requests?agent=${encodeURIComponent(agent.name)}`}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
          >
            View requests
          </Link>
          <Link href="/budgets" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">
            Manage budget
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Spend · 30d" value={fmtSpend(agent.spend30d)} sub={`${agent.requests30d.toLocaleString()} requests`} />
        <Stat label="Tokens · 30d" value={agent.tokens30d.toLocaleString()} sub="in + out" />
        <Stat label="Models" value={String(agent.byModel.length)} sub={agent.byModel[0]?.model ?? "—"} />
        <Stat
          label="Budget"
          value={budgets.length > 0 ? fmtSpend(budgets[0].spentUsd ?? 0) : "—"}
          sub={budgets.length > 0 ? `of ${fmtSpend(budgets[0].dollarLimit ?? 0)} · ${budgets[0].window ?? ""}` : "no agent budget"}
        />
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">7-day timeline</h2>
        {agent.timeline7d.length === 0 ? (
          <p className="text-sm text-zinc-500">No traffic in the last 7 days.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {agent.timeline7d.map((d) => (
              <li key={d.day} className="flex items-center gap-3 text-xs">
                <span className="w-24 shrink-0 font-mono text-zinc-500">{d.day}</span>
                <span className="h-3 min-w-1 rounded bg-indigo-500" style={{ width: `${Math.max(2, (d.spend / maxDay) * 100)}%` }} aria-hidden />
                <span className="font-mono tabular-nums">{fmtSpend(d.spend)} · {d.requests} req</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Model breakdown</h2>
          {agent.byModel.length === 0 ? (
            <p className="text-sm text-zinc-500">No model spend for this agent.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
                  <th className="py-1.5 pr-3 font-medium">Model</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Spend</th>
                  <th className="py-1.5 text-right font-medium">Requests</th>
                </tr>
              </thead>
              <tbody>
                {agent.byModel.map((m) => (
                  <tr key={m.model} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-1.5 pr-3 font-mono text-xs">{m.model}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{fmtSpend(m.spend)}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{m.requests.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Budget status</h2>
          {budgets.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No agent-level budget. <Link href="/budgets" className="text-indigo-600 hover:underline dark:text-indigo-400">Manage budgets →</Link>
            </p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {budgets.map((b, i) => {
                const pct = b.dollarLimit ? Math.min(100, ((b.spentUsd ?? 0) / b.dollarLimit) * 100) : 0;
                return (
                  <li key={b.id ?? i} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                    <p className="font-mono text-xs text-zinc-500">{b.id} · {b.window}</p>
                    <p className="mt-1 font-mono tabular-nums">
                      {fmtSpend(b.spentUsd ?? 0)} / {fmtSpend(b.dollarLimit ?? 0)} ({pct.toFixed(0)}%)
                    </p>
                    <div className="mt-1 h-2 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-900" aria-hidden>
                      <div
                        className={`h-full rounded ${pct > 90 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-emerald-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Top requests</h2>
        {requests.length === 0 ? (
          <p className="text-sm text-zinc-500">No requests for this agent.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
                  <th className="w-8 py-1 pr-2" aria-label="Expand" />
                  <th className="py-1 pr-3 font-medium">Time</th>
                  <th className="py-1 pr-3 font-medium">Model</th>
                  <th className="py-1 pr-3 text-right font-medium">Cost</th>
                  <th className="py-1 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
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
                        <td className="py-1 pr-3 text-right font-mono tabular-nums">{fmtSpend(r.cost_usd ?? 0)}</td>
                        <td className="py-1 text-right font-mono text-xs">{r.status_code ?? "—"}</td>
                      </tr>
                      {open && (
                        <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                          <td />
                          <td colSpan={4} className="px-2 py-3">
                            <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                              <div>
                                <dt className="font-medium text-zinc-500">Cost math</dt>
                                <dd className="font-mono">
                                  {(r.tokens_in ?? 0)} in + {(r.tokens_out ?? 0)} out → {fmtSpend(r.cost_usd ?? 0)}
                                </dd>
                              </div>
                              <div>
                                <dt className="font-medium text-zinc-500">Latency</dt>
                                <dd className="font-mono">{r.latency_ms ?? "—"} ms · team {r.team_id || "—"}</dd>
                              </div>
                              <div>
                                <dt className="font-medium text-zinc-500">Routing</dt>
                                <dd className="font-mono text-xs">
                                  chain {r.chain_id || "—"} · key {r.virtual_key_prefix || "—"} · project {r.project_id || "—"}
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
      </section>
    </div>
  );
}

export default function AgentDetailPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading agent…</p>}>
      <AgentDetailLive />
    </Suspense>
  );
}
