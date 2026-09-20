"use client";

// BudgetTable — ledger-web-dashboard table (spec 17 Budgets tree).
// Org→Team→Project→Agent collapsible tree: progress bar, $spent/$limit,
// green <75 / amber 75–90 / red >90 + inline enforcement state.
// TODO(API): nodes from GET /api/budgets + forecast (backend); edit modal
// writes via proxy management plane.

import { useState } from "react";

export type BudgetLevel = "org" | "team" | "project" | "agent";

export interface BudgetNode {
  id: string;
  name: string;
  level: BudgetLevel;
  spent: number;
  limit: number;
  enforcement?: string;
  children?: BudgetNode[];
}

function barClass(pct: number): string {
  if (pct > 90) return "bg-red-500";
  if (pct >= 75) return "bg-amber-500";
  return "bg-emerald-500";
}

function Row({ node, depth }: { node: BudgetNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const pct = node.limit > 0 ? (node.spent / node.limit) * 100 : 0;
  const hasKids = (node.children?.length ?? 0) > 0;
  return (
    <>
      <tr className="border-b border-zinc-100 dark:border-zinc-900">
        <td className="py-1.5 pr-3" style={{ paddingLeft: depth * 20 }}>
          <span className="flex items-center gap-2">
            {hasKids ? (
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`}
                onClick={() => setOpen((o) => !o)}
                className="rounded border border-zinc-300 px-1.5 text-xs dark:border-zinc-700"
              >
                {open ? "−" : "+"}
              </button>
            ) : (
              <span aria-hidden className="w-6 text-center text-zinc-400">·</span>
            )}
            <span>
              <span className="font-medium">{node.name}</span>{" "}
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800">{node.level}</span>
            </span>
          </span>
        </td>
        <td className="py-1.5 pr-3">
          <span className="flex items-center gap-2">
            <span className="h-2 w-24 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${node.name} utilization`}>
              <span className={`block h-full ${barClass(pct)}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
            </span>
            <span className="font-mono text-xs tabular-nums">{pct.toFixed(0)}%</span>
          </span>
        </td>
        <td className="py-1.5 pr-3 text-right font-mono text-xs tabular-nums">
          ${node.spent.toFixed(2)} / ${node.limit.toFixed(2)}
        </td>
        <td className="py-1.5 text-right text-xs text-zinc-500">{node.enforcement ?? "—"}</td>
      </tr>
      {open &&
        hasKids &&
        node.children!.map((c) => <Row key={c.id} node={c} depth={depth + 1} />)}
    </>
  );
}

export default function BudgetTable({ nodes }: { nodes: BudgetNode[] }) {
  if (nodes.length === 0) {
    return <p className="text-sm text-zinc-500">No budgets yet — create one to enforce hard caps (spec 07).</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
            <th className="py-1.5 pr-3 font-medium">Scope</th>
            <th className="py-1.5 pr-3 font-medium">Utilization</th>
            <th className="py-1.5 pr-3 text-right font-medium">Spent / Limit</th>
            <th className="py-1.5 text-right font-medium">Enforcement</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => (
            <Row key={n.id} node={n} depth={0} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
