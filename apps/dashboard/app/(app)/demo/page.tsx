// Demo before-vs-after — Demo-UI builder (spec 21 proof plan).
// Per kitchen-sink demo agent: BEFORE (modeled frontier baseline, gpt-4o
// rates) vs AFTER (metered proxy rows). Live via useDemoSummary() +
// GET /api/demo/summary. Honesty contract: every figure carries a
// modeled/metered label — baseline is NEVER presented as measured.
// Skeletons while loading; empty state links the demo/README.md run order.

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useDemoSummary, type DemoCard } from "@/lib/hooks/use-demo";

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

function AgentCard({ card, view }: { card: DemoCard; view: View }) {
  const primary = view === "after" ? card.afterSpend : card.beforeSpend;
  const primaryKind = view === "after" ? "metered" : "modeled";
  return (
    <article
      aria-label={`Demo agent ${card.label}`}
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">
          <Link
            href={`/demo/${encodeURIComponent(card.id)}`}
            className="text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {card.label}
          </Link>
        </h2>
        <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500 dark:border-zinc-700">
          team {card.team}
        </span>
      </div>
      <p className="text-sm text-zinc-500">{card.blurb}</p>

      <div className="flex items-baseline gap-2">
        <p className="mono text-2xl font-bold">{fmtSpend(primary)}</p>
        <span className="text-xs text-zinc-500">
          {view === "after" ? "AFTER · metered" : "BEFORE · modeled"}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-zinc-500">Requests</dt>
          <dd className="mono">{card.hasTraffic ? card.requests.toLocaleString() : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Tokens</dt>
          <dd className="mono">{card.hasTraffic ? card.tokens.toLocaleString() : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">
            {view === "after" ? "Before (modeled)" : "After (metered)"}
          </dt>
          <dd className="mono">{fmtSpend(view === "after" ? card.beforeSpend : card.afterSpend)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Saved</dt>
          <dd className="mono font-semibold text-savings">
            {card.hasTraffic
              ? `${fmtSpend(card.savedUsd)} (${card.savingsPct.toFixed(1)}%)`
              : "—"}
          </dd>
        </div>
      </dl>

      <div>
        <p className="text-xs text-zinc-500">Model path (metered)</p>
        {card.modelPath.length === 0 ? (
          <p className="mt-1 text-xs text-zinc-500">No traffic yet — run the demo to light this up.</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={`Model path for ${card.label}`}>
            {card.modelPath.map((m) => (
              <li
                key={m.model}
                title={`${m.requests} req · ${fmtSpend(m.spend)} metered`}
                className="mono rounded-md border border-zinc-200 px-2 py-0.5 text-xs dark:border-zinc-700"
              >
                {m.model}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-auto pt-1">
        <Link
          href={`/demo/${encodeURIComponent(card.id)}`}
          aria-label={`Open before-after detail for ${card.label}`}
          className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Open detail →
        </Link>
      </div>
      <p className="sr-only">
        Spend shown is {primaryKind}: {view === "after" ? "real metered proxy cost" : "modeled frontier baseline"}.
      </p>
    </article>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 p-6 dark:border-zinc-700">
      <p className="text-sm font-medium">No demo traffic yet.</p>
      <p className="mt-1 text-sm text-zinc-500">
        AFTER (metered) lights up once the kitchen-sink agents send traffic through the proxy.
        BEFORE (modeled) reprices the same tokens at frontier rates. Run order from{" "}
        <span className="mono">demo/README.md</span>:
      </p>
      <pre className="mono mt-3 overflow-x-auto rounded-lg bg-zinc-100 p-4 text-xs dark:bg-zinc-900">
{`docker compose up -d postgres redis qdrant   # 1. infra
python3 demo/mock_upstream.py                 # 2. mock upstream (terminal A)
OPENAI_BASE_URL=http://127.0.0.1:9999 \\
ANTHROPIC_BASE_URL=http://127.0.0.1:9999 \\
GOOGLE_BASE_URL=http://127.0.0.1:9999 \\
DATABASE_URL='postgres://agentledger:agentledger@localhost:5432/agentledger?sslmode=disable' \\
PORT=8787 go run ./cmd/proxy                  # 3. proxy (terminal B)
python3 demo/seed.py                          # 5. keys + budgets
python3 demo/runner.py --once                 # 6. traffic`}
      </pre>
    </div>
  );
}

export default function DemoPage() {
  const [view, setView] = useState<View>("after");
  const { summary, loading, error, refresh } = useDemoSummary();
  const totals = useMemo(() => summary?.totals ?? null, [summary]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Demo — before vs after</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            BEFORE (direct-to-provider, billed blind) vs AFTER (one env var per agent → full
            visibility). AFTER figures are <strong>metered</strong> proxy rows; BEFORE is{" "}
            <strong>modeled</strong> at frontier {summary?.baseline.model ?? "gpt-4o"} rates — a
            model, never a measurement.
          </p>
        </div>
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
      </header>

      {loading ? (
        <div aria-label="Loading demo summary" className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-64 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
            ))}
          </div>
        </div>
      ) : error ? (
        <div role="alert" className="rounded-lg border border-red-300 p-4 text-sm dark:border-red-900">
          <p className="font-medium text-red-600">Demo summary unavailable ({error}).</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-2 rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
          >
            Retry
          </button>
        </div>
      ) : !summary || !summary.hasTraffic ? (
        <EmptyState />
      ) : (
        <>
          {totals && (
            <section aria-label="Demo totals" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="After · metered" value={fmtSpend(totals.afterSpend)} sub={`${totals.requests.toLocaleString()} requests · real proxy cost`} />
              <Stat label="Before · modeled" value={fmtSpend(totals.beforeSpend)} sub={`frontier ${summary.baseline.model} rates · model, not measured`} />
              <Stat label="Saved" value={fmtSpend(totals.savedUsd)} sub="before (modeled) − after (metered)" />
              <Stat label="Savings" value={`${totals.savingsPct.toFixed(1)}%`} sub={`${totals.tokens.toLocaleString()} tokens repriced`} />
            </section>
          )}
          <section aria-label="Per-agent before-after" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {summary.agents.map((card) => (
              <AgentCard key={card.id} card={card} view={view} />
            ))}
          </section>
          <p className="text-xs text-zinc-500">
            Baseline: input ${summary.baseline.inputPer1M.toFixed(2)}/1M · output $
            {summary.baseline.outputPer1M.toFixed(2)}/1M ({summary.baseline.model}).{" "}
            {summary.baseline.note} Cache HIT/MISS is unknown until the chain patches land
            (request_logs has no cache column) — per-agent detail renders n/a, never 0%.
          </p>
        </>
      )}
    </div>
  );
}
