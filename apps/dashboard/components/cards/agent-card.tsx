// AgentCard — ledger-web-dashboard primitive (spec 17 Agents).
// Server presentational, links to /agents/[id]. Money in monospace.

import Link from "next/link";

export interface AgentCardProps {
  id: string;
  name: string;
  spend: number;
  tokens: number;
  requests: number;
  cachePct: number;
  model: string;
}

export default function AgentCard({ id, name, spend, tokens, requests, cachePct, model }: AgentCardProps) {
  return (
    <Link
      href={`/agents/${encodeURIComponent(id)}`}
      className="block rounded-xl border border-zinc-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="truncate font-semibold">{name}</h3>
        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[11px] dark:bg-zinc-800">{model}</span>
      </div>
      <p className="mt-1 font-mono text-xl font-bold tabular-nums">${spend.toFixed(2)}</p>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-zinc-500">
        <div>
          <dt>Tokens</dt>
          <dd className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">{tokens.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Requests</dt>
          <dd className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">{requests.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Cache</dt>
          <dd className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">{cachePct.toFixed(0)}%</dd>
        </div>
      </dl>
    </Link>
  );
}
