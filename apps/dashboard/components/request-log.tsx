import type { TopRequest } from "@/lib/api";

export default function RequestLog({ requests }: { requests: TopRequest[] }) {
  if (requests.length === 0) {
    return <p className="text-sm text-zinc-500">No requests logged yet — the 10 costliest requests will appear here.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
            <th className="py-1 pr-3 font-medium">Time</th>
            <th className="py-1 pr-3 font-medium">Model</th>
            <th className="py-1 pr-3 font-medium">Agent</th>
            <th className="py-1 pr-3 font-medium">Team</th>
            <th className="py-1 pr-3 text-right font-medium">In/Out</th>
            <th className="py-1 pr-3 text-right font-medium">Cost</th>
            <th className="py-1 text-right font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id} className="border-b border-zinc-100 dark:border-zinc-900">
              <td className="whitespace-nowrap py-1 pr-3 font-mono text-xs">{new Date(r.ts).toLocaleString()}</td>
              <td className="py-1 pr-3 font-mono text-xs">{r.model}</td>
              <td className="py-1 pr-3 font-mono text-xs">{r.agent_id || "—"}</td>
              <td className="py-1 pr-3 font-mono text-xs">{r.team_id || "—"}</td>
              <td className="py-1 pr-3 text-right font-mono text-xs">
                {r.tokens_in}/{r.tokens_out}
              </td>
              <td className="py-1 pr-3 text-right">${Number(r.cost_usd).toFixed(4)}</td>
              <td className="py-1 text-right font-mono text-xs">{r.status_code}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
