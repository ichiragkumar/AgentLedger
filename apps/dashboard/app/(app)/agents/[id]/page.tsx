// Agent detail — ledger-web-dashboard owner (spec 17 §Agents [id]).
// Async Server Component. Mock detail keyed by id; request rows reuse the
// lib/api TopRequest shape; BreakdownTable/RequestTable reused.
// TODO(API): detail from useAgent(id) + GET /api/agents/[id] (backend).
// Back link returns to /agents (list-state preservation via search params lands with filter.store).

import Link from "next/link";
import type { TopRequest } from "@/lib/api";
import BreakdownTable from "@/components/breakdown-table";
import RequestTable from "@/components/tables/request-table";
import StatCard from "@/components/cards/stat-card";
import CostOverTime from "@/components/charts/cost-over-time";
import { BudgetPanel } from "@/components/budget-panel";
import CachePanel from "@/components/cache-panel";

export const dynamic = "force-dynamic";

const detailRequests: TopRequest[] = [
  { id: 101, ts: "2026-09-20T09:12:00Z", model: "gemini-2.0-flash", agent_id: "writer", team_id: "content", tokens_in: 4200, tokens_out: 1800, cost_usd: 0.0042, latency_ms: 812, status_code: 200 },
  { id: 102, ts: "2026-09-20T08:58:00Z", model: "gemini-2.0-flash", agent_id: "writer", team_id: "content", tokens_in: 9100, tokens_out: 3200, cost_usd: 0.0091, latency_ms: 1210, status_code: 200 },
  { id: 103, ts: "2026-09-19T17:40:00Z", model: "claude-3-5-haiku", agent_id: "writer", team_id: "content", tokens_in: 2600, tokens_out: 900, cost_usd: 0.0031, latency_ms: 640, status_code: 200 },
];

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const name = decodeURIComponent(id);
  return (
    <div className="flex flex-col gap-5">
      <Link href="/agents" className="w-fit text-sm text-indigo-600 hover:underline dark:text-indigo-400">
        ← Back to agents
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-bold tracking-tight">{name}</h1>
          <p className="text-sm text-zinc-500">Agent detail · team content · virtual key <span className="font-mono">••••a91f</span></p>
        </div>
        <div className="flex gap-2">
          {/* Edit / View-Requests / Manage-Budget actions wire to backend mutations. */}
          <button type="button" title="Edit agent (mock — mutation lands with backend)" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">Edit</button>
          <Link href="/requests" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">View requests</Link>
          <Link href="/budgets" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">Manage budget</Link>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Spend · 7d" value="$42.10" sub="13% of org" deltaPct={-4.1} />
        <StatCard label="Tokens · 7d" value="1.4M" sub="in 1.0M · out 0.4M" deltaPct={2.2} />
        <StatCard label="Cache hit" value="58%" sub="per-agent cache" deltaPct={5.0} invert={false} />
        <StatCard label="Budget" value="61%" sub="$42.10 / $69.00" deltaPct={6.3} />
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">7-day timeline</h2>
        <CostOverTime
          data={[
            { day: "09-14", spend: 4.1, requests: 82 },
            { day: "09-15", spend: 6.8, requests: 104 },
            { day: "09-16", spend: 5.9, requests: 91 },
            { day: "09-17", spend: 7.4, requests: 112 },
            { day: "09-18", spend: 6.2, requests: 88 },
            { day: "09-19", spend: 5.5, requests: 79 },
            { day: "09-20", spend: 6.2, requests: 54 },
          ]}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Model breakdown</h2>
          <BreakdownTable
            title="Model"
            rows={[
              { key: "gemini-2.0-flash", spend: 30.4, requests: 480 },
              { key: "claude-3-5-haiku", spend: 11.7, requests: 130 },
            ]}
            emptyHint="No model spend for this agent."
          />
        </section>
        <CachePanel
          hitRatePct={58}
          hits={354}
          misses={256}
          savedUSD={4.2}
          savedWeekUSD={4.2}
          windowLabel="agent · 7d"
          cacheSize={64}
          topQueries={[{ query: "draft release notes", hits: 51, savedUSD: 1.8 }]}
        />
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Top requests</h2>
        <RequestTable requests={detailRequests} />
      </section>

      <BudgetPanel
        teamName={`${name} · budget`}
        budgetUSD={69}
        spentUSD={42.1}
        utilizationPct={61}
        forecastUSD={58.4}
        forecastMessage={`at this rate $58.40 by month end`}
        burndown={[
          { date: "09-14", idealCum: 9.8, actualCum: 4.1 },
          { date: "09-17", idealCum: 29.6, actualCum: 24.2 },
          { date: "09-20", idealCum: 49.3, actualCum: 42.1 },
        ]}
      />
    </div>
  );
}
