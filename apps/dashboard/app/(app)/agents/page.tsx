// Agents page — ledger-web-dashboard owner (spec 17 §Agents).
// Async Server Component; mock rows (AgentsTable owns search/sort/page).
// TODO(API): rows from useAgents() + GET /api/agents (ledger-web-backend).

import AgentCard from "@/components/cards/agent-card";
import AgentsTable, { type AgentRow } from "@/components/tables/agents-table";

export const dynamic = "force-dynamic";

const agents: AgentRow[] = [
  { id: "writer", name: "writer", spend: 42.1, tokens: 1402000, requests: 610, cachePct: 58, model: "gemini-2.0-flash" },
  { id: "researcher", name: "researcher", spend: 31.5, tokens: 980000, requests: 540, cachePct: 71, model: "claude-3-5-haiku" },
  { id: "reviewer", name: "reviewer", spend: 24.8, tokens: 620000, requests: 402, cachePct: 44, model: "claude-3-5-sonnet" },
  { id: "planner", name: "planner", spend: 15.2, tokens: 310000, requests: 180, cachePct: 22, model: "claude-3-5-sonnet" },
  { id: "support-bot", name: "support-bot", spend: 8.3, tokens: 290000, requests: 111, cachePct: 83, model: "gpt-4o-mini" },
];

export default async function AgentsPage() {
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
        <p className="text-sm text-zinc-500">Spend, tokens, requests and cache per agent. Row → detail.</p>
      </header>

      <section aria-label="Top spenders">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {agents.slice(0, 3).map((a) => (
            <AgentCard key={a.id} {...a} />
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">All agents</h2>
        <AgentsTable agents={agents} />
      </section>
    </div>
  );
}
