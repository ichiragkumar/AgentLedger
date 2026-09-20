// Budgets page — ledger-web-dashboard owner (spec 17 §Budgets).
// Async Server Component. Reuses BudgetPanel burndown + BudgetTable tree.
// Forecast, 3-month history and alerts log are mock.
// TODO(API): tree + forecast from GET /api/budgets (backend); edit writes
// via proxy management plane.

import { BudgetPanel } from "@/components/budget-panel";
import BudgetTable, { type BudgetNode } from "@/components/tables/budget-table";

export const dynamic = "force-dynamic";

const tree: BudgetNode[] = [
  {
    id: "org-acme",
    name: "acme",
    level: "org",
    spent: 412.55,
    limit: 600,
    enforcement: "watch",
    children: [
      {
        id: "team-content",
        name: "content",
        level: "team",
        spent: 410 - 88.4 + 88.4,
        limit: 500,
        enforcement: "downgrade armed at 90%",
        children: [
          { id: "proj-pipeline", name: "pipeline", level: "project", spent: 64.2, limit: 100, enforcement: "healthy" },
          {
            id: "proj-docs",
            name: "docs",
            level: "project",
            spent: 24.2,
            limit: 40,
            children: [
              { id: "agent-writer", name: "writer", level: "agent", spent: 42.1 - 24, limit: 30, enforcement: "healthy" },
            ],
          },
        ],
      },
      { id: "team-support", name: "support", level: "team", spent: 33.5, limit: 100, enforcement: "healthy" },
    ],
  },
];

const alertsLog = [
  { ts: "09-20 09:41", trigger: "content ≥ 75%", action: "warning toast" },
  { ts: "09-18 14:02", trigger: "support ≥ 90% (1h)", action: "downgrade to haiku for 30m" },
  { ts: "09-12 11:20", trigger: "pipeline forecast > cap", action: "notify #finops" },
];

export default async function BudgetsPage() {
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Budgets</h1>
        <p className="text-sm text-zinc-500">Never blow a budget again — hard caps with forecast.</p>
      </header>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Org → Team → Project → Agent</h2>
        <BudgetTable nodes={tree} />
      </section>

      <BudgetPanel
        teamName="content"
        budgetUSD={500}
        spentUSD={410}
        utilizationPct={82}
        forecastUSD={486}
        forecastMessage="at this rate $486 by month end"
        burndown={[
          { date: "09-01", idealCum: 16, actualCum: 12 },
          { date: "09-07", idealCum: 112, actualCum: 121 },
          { date: "09-14", idealCum: 224, actualCum: 268 },
          { date: "09-20", idealCum: 320, actualCum: 410 },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">3-month history</h2>
          <div className="flex h-24 items-end gap-2" aria-label="Spend history bars">
            {[
              { m: "Jul", v: 320, h: 55 },
              { m: "Aug", v: 388, h: 70 },
              { m: "Sep", v: 412, h: 76 },
            ].map((b) => (
              <div key={b.m} className="flex flex-1 flex-col items-center gap-1">
                <span className="font-mono text-xs tabular-nums">${b.v}</span>
                <div className="w-full rounded bg-indigo-500/70" style={{ height: `${b.h}px` }} />
                <span className="text-xs text-zinc-500">{b.m}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Alerts log</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
                <th className="py-1 pr-3 font-medium">Time</th>
                <th className="py-1 pr-3 font-medium">Trigger</th>
                <th className="py-1 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {alertsLog.map((a) => (
                <tr key={`${a.ts}-${a.trigger}`} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="py-1 pr-3 font-mono text-xs">{a.ts}</td>
                  <td className="py-1 pr-3 text-xs">{a.trigger}</td>
                  <td className="py-1 text-right text-xs">{a.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
