"use client";

// RequestTable — ledger-web-dashboard table (spec 17 Requests).
// Paginated table + expandable rows (headers, cost math, cache/route/enforce
// annotations). Row shape = lib/api TopRequest (same shape as RequestLog).
// TODO(API): rows + filters from useRequests() + GET /api/requests (backend);
// export CSV deferred.

import { useState } from "react";
import type { TopRequest } from "@/lib/api";

function costMath(r: TopRequest): string {
  return `${r.tokens_in} in + ${r.tokens_out} out → $${Number(r.cost_usd).toFixed(4)}`;
}

export default function RequestTable({ requests }: { requests: TopRequest[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  if (requests.length === 0) {
    return <p className="text-sm text-zinc-500">No requests in range — adjust filters or send traffic through the proxy.</p>;
  }
  return (
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
          {requests.map((r) => {
            const open = expanded === r.id;
            return (
              <>
                <tr key={r.id} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="py-1 pr-2">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={`${open ? "Collapse" : "Expand"} request ${r.id}`}
                      onClick={() => setExpanded(open ? null : r.id)}
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
                  <tr key={`${r.id}-detail`} className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                    <td />
                    <td colSpan={5} className="px-2 py-3">
                      <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                        <div>
                          <dt className="font-medium text-zinc-500">Cost math</dt>
                          <dd className="font-mono">{costMath(r)}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-zinc-500">Latency</dt>
                          <dd className="font-mono">{r.latency_ms} ms · team {r.team_id || "—"}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-zinc-500">Annotations</dt>
                          <dd className="text-zinc-600 dark:text-zinc-400">
                            cache: mock-miss · route: mock-tier · enforce: within budget (live annotations land with Phases 2–4 APIs)
                          </dd>
                        </div>
                        <div>
                          <dt className="font-medium text-zinc-500">Prompt / response</dt>
                          <dd className="text-zinc-600 dark:text-zinc-400">
                            Full bodies render here when policies allow; PII-redacted when a redaction policy is active (mock).
                          </dd>
                        </div>
                      </dl>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
