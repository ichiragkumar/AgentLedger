"use client";

// Budgets page — live hierarchy + burndown + forecast + alerts log.
// Reads GET /api/budgets (Postgres utilization/forecast views, Go-mirrored
// writes) via use-budgets; alerts log from GET /api/alerts. Zero-state safe.

import { useEffect, useMemo, useState } from "react";
import { BudgetPanel } from "@/components/budget-panel";
import BudgetTable, { type BudgetNode } from "@/components/tables/budget-table";
import { useBudgets } from "@/lib/hooks/use-budgets";
import { getAlerts, type Alert, type Budget } from "@/lib/api-ext";

const STATE_LABEL: Record<Budget["state"], string> = {
  ok: "healthy",
  notice: "watch ≥50%",
  watch: "warning ≥75%",
  downgrade: "downgrade active",
  hard_stop: "hard stop",
};

const WINDOW_DAYS: Record<string, number> = { daily: 1, weekly: 7, monthly: 30 };

function friendlyWriteError(e: unknown): string {
  const err = e as { status?: number; code?: string; message?: string };
  if (err?.status === 403 || err?.code === "forbidden")
    return "Only admins can change budgets — ask an admin to raise this cap.";
  return err?.message ?? "Budget store is unreachable — try again.";
}

/** Nest flat budget rows into an Org→Team→Project→Agent forest. */
function buildTree(budgets: Budget[]): BudgetNode[] {
  const node = (b: Budget): BudgetNode => ({
    id: b.id,
    name: b.key,
    level: (["org", "team", "project", "agent"] as const).includes(b.level as BudgetNode["level"])
      ? (b.level as BudgetNode["level"])
      : "project",
    spent: b.spentUsd,
    limit: b.dollarLimit,
    enforcement: STATE_LABEL[b.state] ?? b.state,
  });
  const nodes = new Map(budgets.map((b) => [b.id, node(b)]));
  const byKey = (level: string, key: string) => budgets.find((b) => b.level === level && b.key === key);
  const orgs = budgets.filter((b) => b.level === "org");
  const roots: BudgetNode[] = [];
  const attach = (child: Budget, parent: Budget | undefined) => {
    const cn = nodes.get(child.id)!;
    if (parent && nodes.get(parent.id) && parent.id !== child.id) {
      const pn = nodes.get(parent.id)!;
      pn.children = [...(pn.children ?? []), cn];
    } else {
      roots.push(cn);
    }
  };
  for (const b of budgets.filter((b) => b.level === "team")) attach(b, orgs[0]);
  for (const b of budgets.filter((b) => b.level === "project")) {
    const prefix = b.key.includes("/") ? b.key.split("/")[0] : "";
    attach(b, byKey("team", prefix) ?? byKey("team", b.ownerTeam) ?? orgs[0]);
  }
  for (const b of budgets.filter((b) => b.level === "agent")) {
    const prefix = b.key.includes("/") ? b.key.split("/")[0] : "";
    attach(
      b,
      byKey("project", b.key) ??
        byKey("team", prefix) ??
        byKey("team", b.ownerTeam) ??
        budgets.find((p) => p.level === "project" && p.ownerTeam === b.ownerTeam) ??
        orgs[0]
    );
  }
  for (const b of budgets.filter((b) => b.level === "org")) roots.push(nodes.get(b.id)!);
  for (const b of budgets.filter((b) => !["org", "team", "project", "agent"].includes(b.level))) roots.push(nodes.get(b.id)!);
  return roots;
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800 ${className}`} />;
}

export default function BudgetsPage() {
  const { budgets, loading, error, refresh, create, update, remove } = useBudgets(true);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    getAlerts(20).then((r) => setAlerts(r.alerts)).catch(() => setAlertsError("Alerts log is unreachable."));
  }, []);

  const tree = useMemo(() => buildTree(budgets), [budgets]);
  const selected: Budget | undefined =
    budgets.find((b) => b.id === selectedId) ?? budgets.find((b) => b.state !== "ok") ?? budgets[0];

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const burndown = useMemo(() => {
    if (!selected) return [];
    const days = (selected as Budget & { history14d?: { day: string; spend: number }[] }).history14d ?? [];
    const windowDays = WINDOW_DAYS[selected.window] ?? 30;
    const perDay = selected.dollarLimit > 0 ? selected.dollarLimit / windowDays : 0;
    let cum = 0;
    return days.map((d, i) => {
      cum += d.spend;
      return { date: d.day.slice(5), idealCum: Math.round(perDay * (i + 1) * 100) / 100, actualCum: Math.round(cum * 100) / 100 };
    });
  }, [selected]);

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const fd = new FormData(e.currentTarget);
    try {
      await create({
        level: String(fd.get("level") ?? "team"),
        key: String(fd.get("key") ?? "").trim(),
        window: String(fd.get("window") ?? "monthly"),
        tokenLimit: Number(fd.get("tokenLimit") ?? 0),
        dollarLimit: Number(fd.get("dollarLimit") ?? 0),
      });
      setShowCreate(false);
      setToast("Budget created and mirrored to the live enforcer.");
      void refresh();
    } catch (err) {
      setFormError(friendlyWriteError(err));
    }
  }

  async function onRaise() {
    if (!selected) return;
    setFormError(null);
    const next = window.prompt("New dollar limit (USD) for " + selected.level + ":" + selected.key, String(selected.dollarLimit));
    if (next === null) return;
    const dollarLimit = Number(next);
    if (!Number.isFinite(dollarLimit) || dollarLimit < 0) {
      setFormError("Enter a non-negative dollar limit.");
      return;
    }
    try {
      await update(selected.id, { dollarLimit });
      setToast("Budget raised — traffic resumes under the new cap.");
    } catch (err) {
      setFormError(friendlyWriteError(err));
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("Delete this budget? Enforcement stops for its scope.")) return;
    try {
      await remove(id);
      setToast("Budget deleted.");
    } catch (err) {
      setFormError(friendlyWriteError(err));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Budgets</h1>
          <p className="text-sm text-zinc-500">Never blow a budget again — hard caps with forecast.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((s) => !s)}
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white"
        >
          {showCreate ? "Close" : "New budget"}
        </button>
      </header>

      {toast && (
        <div role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950">
          {toast}
        </div>
      )}
      {(error || formError) && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950">
          {error ? `Could not load budgets (${error}) — showing zero state.` : formError}
        </div>
      )}

      {showCreate && (
        <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Create budget</h2>
          <form onSubmit={onCreate} className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium">Level</span>
              <select name="level" defaultValue="team" aria-label="Budget level" className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                <option value="org">org</option>
                <option value="team">team</option>
                <option value="project">project</option>
                <option value="agent">agent</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Scope key</span>
              <input name="key" required placeholder="support" aria-label="Scope key" className="mono w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Window</span>
              <select name="window" defaultValue="monthly" aria-label="Budget window" className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                <option value="daily">daily</option>
                <option value="weekly">weekly</option>
                <option value="monthly">monthly</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Token limit (0 = unlimited)</span>
              <input name="tokenLimit" type="text" inputMode="numeric" pattern="[0-9]*" defaultValue={0} aria-label="Token limit" className="mono w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Dollar limit (USD)</span>
              <input name="dollarLimit" type="text" inputMode="decimal" defaultValue={100} aria-label="Dollar limit" className="mono w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
            </label>
            <div className="flex items-end">
              <button type="submit" className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white">
                Save budget
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Org → Team → Project → Agent</h2>
        {loading ? (
          <div className="flex flex-col gap-2" aria-label="Loading budgets">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-11/12" />
            <Skeleton className="h-6 w-10/12" />
          </div>
        ) : (
          <>
            <BudgetTable nodes={tree} />
            {budgets.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-zinc-500">Inspect:</span>
                {budgets.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelectedId(b.id)}
                    aria-pressed={selected?.id === b.id}
                    className={`mono rounded border px-2 py-0.5 ${
                      selected?.id === b.id
                        ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                        : "border-zinc-300 dark:border-zinc-700"
                    }`}
                  >
                    {b.level}:{b.key}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {loading ? (
        <Skeleton className="h-72 w-full" />
      ) : selected ? (
        <>
          <BudgetPanel
            teamName={`${selected.level}:${selected.key}`}
            budgetUSD={selected.dollarLimit}
            spentUSD={selected.spentUsd}
            utilizationPct={selected.utilizationPct}
            forecastUSD={selected.forecastUsd}
            forecastMessage={`at this rate $${selected.forecastUsd.toFixed(2)} by ${selected.window} end`}
            burndown={burndown}
            updatedAt={selected.resetAt ? `resets ${selected.resetAt}` : undefined}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onRaise} className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white">
              Raise budget via API
            </button>
            <button
              type="button"
              onClick={() => onDelete(selected.id)}
              className="rounded-md border border-red-300 px-4 py-1.5 text-sm font-medium text-red-600 dark:border-red-900"
            >
              Delete
            </button>
          </div>
        </>
      ) : (
        <section className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No budgets yet — create one above to enforce hard caps (spec 07).
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">14-day spend history</h2>
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="flex h-24 items-end gap-2" aria-label="Spend history bars">
              {(((selected as Budget & { history14d?: { day: string; spend: number }[] })?.history14d ?? []).length > 0
                ? ((selected as Budget & { history14d?: { day: string; spend: number }[] }).history14d ?? [])
                : []
              ).map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: $${d.spend.toFixed(2)}`}>
                  <span className="mono text-[11px] tabular-nums">${d.spend.toFixed(0)}</span>
                  <div
                    className="w-full rounded bg-indigo-500/70"
                    style={{ height: `${Math.max(4, Math.min(76, d.spend * 8))}px` }}
                  />
                  <span className="text-[11px] text-zinc-500">{d.day.slice(5)}</span>
                </div>
              ))}
              {(((selected as Budget & { history14d?: { day: string; spend: number }[] })?.history14d ?? []).length === 0) && (
                <p className="text-sm text-zinc-500">No spend in the last 14 days.</p>
              )}
            </div>
          )}
        </section>
        <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Alerts log</h2>
          {alertsError ? (
            <p className="text-sm text-zinc-500">{alertsError}</p>
          ) : alerts.length === 0 ? (
            <p className="text-sm text-zinc-500">No alerts — thresholds at 50 / 75 / 90 / 100% will land here.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
                  <th className="py-1 pr-3 font-medium">Time</th>
                  <th className="py-1 pr-3 font-medium">Trigger</th>
                  <th className="py-1 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {alerts.slice(0, 10).map((a) => (
                  <tr key={a.id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="mono py-1 pr-3 text-xs">{a.ts.slice(5, 16).replace("T", " ")}</td>
                    <td className="py-1 pr-3 text-xs">{a.title}</td>
                    <td className="py-1 text-right text-xs text-zinc-500">{a.detail.slice(0, 60)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
