// Demo agent detail — Demo-UI builder (spec 21 proof plan).
// One kitchen-sink agent: before/after toggle, metered model split with
// inferred routing tiers, latest-20 requests (cache always "unknown" → n/a),
// budget state, key prefixes. useParams id = logical demo agent id
// (research-agent covers planner/researcher/writer chain steps).
// Honesty contract: modeled vs metered labels on every figure.

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useDemoAgent, useDemoRun } from "@/lib/hooks/use-demo";

export const dynamic = "force-dynamic";

type View = "after" | "before";

function fmtSpend(v: number): string {
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v > 0) return `$${v.toFixed(6)}`;
  return "$0.00";
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mono mt-1 text-xl font-bold">{value}</p>
      <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-label="Loading demo agent detail">
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

export default function DemoAgentPage() {
  const params = useParams<{ agent: string }>();
  const id = decodeURIComponent(params.agent ?? "");
  const [view, setView] = useState<View>("after");
  const { agent, loading, error, refresh } = useDemoAgent(id || null);
  const { running, lastDirect, runError, run, runWithout, resetOne } = useDemoRun(refresh);

  if (loading) return <DetailSkeleton />;

  if (error || !agent) {
    const notFound = error === "not_found";
    return (
      <div className="flex flex-col gap-4">
        <Link href="/demo" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          ← Back to demo
        </Link>
        <div role="alert" className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="font-medium">
            {notFound ? `Unknown demo agent “${id}”.` : `Demo agent unavailable (${error ?? "unknown"}).`}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            Known agents: support-bot, ticket-classifier, summarizer, code-reviewer, research-agent
            (see <span className="mono">demo/runner.py</span>).
          </p>
        </div>
      </div>
    );
  }

  const primary = view === "after" ? agent.afterSpend : agent.beforeSpend;
  const showChain = agent.requests20.some((r) => r.chainId || r.parentAgentId);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/demo" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          ← Back to demo
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{agent.label}</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {agent.blurb} Team {agent.team} · member rows:{" "}
              <span className="mono">{agent.memberAgentIds.join(", ")}</span>
            </p>
            <p className="mt-2 max-w-2xl rounded-md border-l-2 border-indigo-600 bg-indigo-50 px-2.5 py-1.5 text-xs text-zinc-700 dark:border-indigo-400 dark:bg-indigo-950 dark:text-zinc-300">
              <span className="font-semibold">Problem it solves: </span>
              {agent.problem}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Before-after view" className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
              {(["after", "before"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={`px-4 py-1.5 text-sm font-medium ${
                    view === v
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  }`}
                >
                  {v === "after" ? "After · metered" : "Before · modeled"}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={running}
              onClick={() => void run({ cycles: 1, agent: id })}
              aria-label={`Run ${id} with AgentLedger now`}
              title="Through the proxy: metered, attributed, budgeted"
              className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {running ? "Running…" : "Run with AgentLedger"}
            </button>
            <button
              type="button"
              disabled={running}
              onClick={() => void runWithout({ cycles: 1, agent: id })}
              aria-label={`Run ${id} without AgentLedger now`}
              title="Direct to provider: billed blind, nothing logged"
              className="rounded-md border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {running ? "Running…" : "Run without"}
            </button>
            <button
              type="button"
              disabled={running}
              onClick={() => void resetOne(id).then(() => refresh())}
              aria-label={`Reset ${id} demo data`}
              title="Deletes this agent's keys and rows (shared team budgets stay)"
              className="rounded-md px-2 py-1.5 text-sm text-zinc-500 hover:text-red-600 hover:underline disabled:opacity-50"
            >
              Reset
            </button>
          </div>
        </div>
        {runError && (
          <p role="alert" className="text-sm text-red-600">Run failed: {runError}</p>
        )}
        {lastDirect && (
          <div role="status" className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
            Direct run — <span className="mono font-semibold">{fmtSpend(lastDirect.modeledSpend)}</span> billed blind
            ({lastDirect.ok}/{lastDirect.ran} ok{lastDirect.realCalls > 0 ? `, ${lastDirect.realCalls} on a real provider` : ", mock upstream"})
            · visibility none — refresh to compare against metered.
          </div>
        )}
      </div>

      {!agent.hasTraffic ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-6 dark:border-zinc-700">
          <p className="text-sm font-medium">No traffic for {agent.label} yet.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={running}
              onClick={() => void run({ cycles: 1, agent: id })}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {running ? "Running…" : "Run with AgentLedger"}
            </button>
            <button
              type="button"
              disabled={running}
              onClick={() => void runWithout({ cycles: 1, agent: id })}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {running ? "Running…" : "Run without"}
            </button>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Terminal alternative: <span className="mono">python3 demo/seed.py</span> then{" "}
            <span className="mono">python3 demo/runner.py --once</span> (<span className="mono">demo/README.md</span>).
          </p>
        </div>
      ) : (
        <>
          <section aria-label="Before-after totals" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label={view === "after" ? "Spend · metered" : "Spend · modeled"}
              value={fmtSpend(primary)}
              sub={view === "after" ? "real proxy cost" : `frontier ${agent.baselineModel} rates · model`}
            />
            <Stat
              label={view === "after" ? "Before · modeled" : "After · metered"}
              value={fmtSpend(view === "after" ? agent.beforeSpend : agent.afterSpend)}
              sub={view === "after" ? "same tokens at frontier rates" : "real proxy cost"}
            />
            <Stat label="Saved" value={fmtSpend(agent.savedUsd)} sub="before (modeled) − after (metered)" />
            <Stat label="Requests" value={agent.requests.toLocaleString()} sub="metered rows in range" />
          </section>

          <section aria-label="Model split" className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="text-lg font-semibold tracking-tight">Model split</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Spend is metered; tier labels are inferred from the model path. {agent.routingNote}
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                    <th className="py-1.5 pr-3 font-medium text-zinc-500">Model</th>
                    <th className="py-1.5 pr-3 text-right font-medium text-zinc-500">Tier (inferred)</th>
                    <th className="py-1.5 pr-3 text-right font-medium text-zinc-500">Spend (metered)</th>
                    <th className="py-1.5 pr-3 text-right font-medium text-zinc-500">Requests</th>
                    <th className="py-1.5 text-right font-medium text-zinc-500">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {agent.modelSplit.map((m, i) => (
                    <tr key={`${m.model}-${i}`} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="mono py-1.5 pr-3">{m.model}</td>
                      <td className="py-1.5 pr-3 text-right text-xs text-zinc-500">{m.tier}</td>
                      <td className="mono py-1.5 pr-3 text-right">{fmtSpend(m.spend)}</td>
                      <td className="mono py-1.5 pr-3 text-right">{m.requests.toLocaleString()}</td>
                      <td className="mono py-1.5 text-right">{m.tokens.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-label="Latest requests" className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="text-lg font-semibold tracking-tight">Latest requests</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Cost is metered per row. {agent.cacheNote}
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                    <th className="py-1.5 pr-3 font-medium text-zinc-500">Time</th>
                    <th className="py-1.5 pr-3 font-medium text-zinc-500">Step</th>
                    <th className="py-1.5 pr-3 font-medium text-zinc-500">Model</th>
                    {showChain && <th className="py-1.5 pr-3 font-medium text-zinc-500">Chain</th>}
                    <th className="py-1.5 pr-3 text-right font-medium text-zinc-500">In/out</th>
                    <th className="py-1.5 pr-3 text-right font-medium text-zinc-500">Cost (metered)</th>
                    <th className="py-1.5 pr-3 text-right font-medium text-zinc-500">Cache</th>
                    <th className="py-1.5 text-right font-medium text-zinc-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {agent.requests20.map((r) => (
                    <tr key={r.id} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="mono whitespace-nowrap py-1.5 pr-3 text-xs">
                        {new Date(r.ts).toLocaleString()}
                      </td>
                      <td className="mono py-1.5 pr-3 text-xs">{r.agentId}</td>
                      <td className="mono py-1.5 pr-3 text-xs">{r.model}</td>
                      {showChain && (
                        <td className="mono py-1.5 pr-3 text-xs text-zinc-500">
                          {[r.chainId, r.parentAgentId ? `←${r.parentAgentId}` : null]
                            .filter(Boolean)
                            .join(" ") || "—"}
                        </td>
                      )}
                      <td className="mono py-1.5 pr-3 text-right text-xs">
                        {r.tokensIn.toLocaleString()}/{r.tokensOut.toLocaleString()}
                      </td>
                      <td className="mono py-1.5 pr-3 text-right">{fmtSpend(r.costUsd)}</td>
                      <td className="py-1.5 pr-3 text-right text-xs text-zinc-500">n/a</td>
                      <td className="mono py-1.5 text-right text-xs">{r.statusCode}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-label="Budget state" className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="text-lg font-semibold tracking-tight">Budget state</h2>
            {agent.budgets.length === 0 ? (
              <p className="mt-1 text-sm text-zinc-500">
                No agent/team budget rows for {agent.label} — seed them via{" "}
                <span className="mono">python3 demo/seed.py</span>.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {agent.budgets.map((b) => (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-100 p-3 dark:border-zinc-900"
                  >
                    <div className="text-sm">
                      <span className="mono font-medium">{b.scopeKey}</span>{" "}
                      <span className="text-xs text-zinc-500">
                        {b.level} · {b.window}
                      </span>
                    </div>
                    <div className="mono text-sm">
                      {fmtSpend(b.spentUsd)} / {b.dollarLimit > 0 ? fmtSpend(b.dollarLimit) : "∞"}{" "}
                      <span
                        className={
                          b.state === "exceeded"
                            ? "text-overspend"
                            : b.state === "watch"
                              ? "text-warning"
                              : "text-savings"
                        }
                      >
                        ({b.dollarLimit > 0 ? `${b.utilizationPct.toFixed(1)}%` : "unlimited"} · {b.state})
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {agent.keyPrefixes.length > 0 && (
              <p className="mt-3 text-xs text-zinc-500">
                Virtual-key prefixes on the data plane:{" "}
                <span className="mono">{agent.keyPrefixes.join(", ")}</span>
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
