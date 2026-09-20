// Requests page — ledger-web-dashboard owner (spec 17 §Requests).
// Async Server Component. Filters are mock selects (filter.store owns state);
// rows reuse lib/api TopRequest shape via RequestTable (+ RequestLog reuse).
// TODO(API): filters/rows/export from useRequests() + GET /api/requests (backend).

import type { TopRequest } from "@/lib/api";
import RequestTable from "@/components/tables/request-table";
import RequestLog from "@/components/request-log";

export const dynamic = "force-dynamic";

const requests: TopRequest[] = [
  { id: 201, ts: "2026-09-20T09:12:00Z", model: "gpt-4o", agent_id: "support-bot", team_id: "support", tokens_in: 12400, tokens_out: 2100, cost_usd: 0.0725, latency_ms: 1830, status_code: 200 },
  { id: 202, ts: "2026-09-20T09:04:00Z", model: "claude-3-5-sonnet", agent_id: "reviewer", team_id: "content", tokens_in: 8600, tokens_out: 1900, cost_usd: 0.0315, latency_ms: 1420, status_code: 200 },
  { id: 203, ts: "2026-09-20T08:58:00Z", model: "gemini-2.0-flash", agent_id: "writer", team_id: "content", tokens_in: 9100, tokens_out: 3200, cost_usd: 0.0091, latency_ms: 1210, status_code: 200 },
  { id: 204, ts: "2026-09-20T08:41:00Z", model: "claude-3-5-haiku", agent_id: "researcher", team_id: "content", tokens_in: 5400, tokens_out: 1200, cost_usd: 0.0053, latency_ms: 940, status_code: 200 },
  { id: 205, ts: "2026-09-20T08:22:00Z", model: "gpt-4o-mini", agent_id: "support-bot", team_id: "support", tokens_in: 3100, tokens_out: 700, cost_usd: 0.0011, latency_ms: 510, status_code: 429 },
  { id: 206, ts: "2026-09-20T08:02:00Z", model: "claude-3-5-sonnet", agent_id: "planner", team_id: "content", tokens_in: 4800, tokens_out: 1100, cost_usd: 0.0177, latency_ms: 1180, status_code: 200 },
];

export default async function RequestsPage() {
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Requests</h1>
          <p className="text-sm text-zinc-500">Full log — filter, sort, expand for cost math.</p>
        </div>
        <button type="button" title="Export CSV deferred — lands with backend" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
          Export CSV (soon)
        </button>
      </header>

      {/* Filter bar (mock): agent/team/model/status/date selects drive filter.store. */}
      <section aria-label="Request filters" className="flex flex-wrap gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        {[
          { label: "Agent", options: ["all", "writer", "researcher", "reviewer", "planner", "support-bot"] },
          { label: "Team", options: ["all", "content", "support"] },
          { label: "Model", options: ["all", "gpt-4o", "claude-3-5-sonnet", "claude-3-5-haiku", "gemini-2.0-flash"] },
          { label: "Status", options: ["all", "200", "429", "5xx"] },
        ].map((f) => (
          <label key={f.label} className="text-xs text-zinc-500">
            {f.label}
            <select aria-label={`Filter by ${f.label}`} defaultValue="all" className="ml-1 rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
              {f.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
        ))}
        <label className="text-xs text-zinc-500">
          Date
          <input type="date" aria-label="Filter by date" defaultValue="2026-09-20" className="ml-1 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Log (expandable)</h2>
        <RequestTable requests={requests} />
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Top costliest (existing component)</h2>
        <RequestLog requests={requests} />
      </section>
    </div>
  );
}
