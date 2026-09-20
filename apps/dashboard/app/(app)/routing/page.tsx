// Routing page — ledger-web-dashboard owner (spec 17 §Routing).
// Async Server Component. Reuses RoutingPanel (props-only).
// Tier model dropdowns, YAML rules editor, fallback drag-reorder and
// hot-reload toasts are mock UI — mutations land with backend.
// TODO(API): tiers/rules/fallback from router API (ledger-web-backend).

import RoutingPanel from "@/components/routing-panel";
import StatCard from "@/components/cards/stat-card";

export const dynamic = "force-dynamic";

const TIERS = [
  { tier: "simple", model: "gemini-2.0-flash", price: "$0.075 / 1M", desc: "Fast + cheap classification, extraction" },
  { tier: "moderate", model: "claude-3-5-haiku", price: "$0.80 / 1M", desc: "Everyday drafting, summarization" },
  { tier: "complex", model: "claude-3-5-sonnet", price: "$3.00 / 1M", desc: "Reasoning, planning, review" },
  { tier: "frontier", model: "gpt-4o", price: "$5.00 / 1M", desc: "High-stakes, evals, final review" },
] as const;

const RULES_YAML = `# Custom routing rules — hot-reloaded on save (mock)
- if: { agent: support-bot, task: refund }
  then: claude-3-5-haiku
- if: { agent: writer, task: final-review }
  then: claude-3-5-sonnet
`;

export default async function RoutingPage() {
  return (
    <div className="flex flex-col gap-5">
      <div role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950">
        <strong>ACTIVE — saving avg 44%.</strong> <span className="text-zinc-600 dark:text-zinc-400">Saved $38.20 this week vs always-frontier baseline.</span>
      </div>

      <header>
        <h1 className="text-2xl font-bold tracking-tight">Routing</h1>
        <p className="text-sm text-zinc-500">Right model, right price — tiers, rules, fallback.</p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Saved this week" value="$38.20" sub="44% vs frontier" deltaPct={12.4} invert={false} />
        <StatCard label="Escalation rate" value="7.0%" sub="within 10% budget" deltaPct={-1.2} invert={false} />
      </div>

      <section aria-label="Tier configuration" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {TIERS.map((t) => (
          <div key={t.tier} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">{t.tier}</p>
            <p className="mt-1 font-mono text-sm font-bold">{t.model}</p>
            <p className="font-mono text-xs text-emerald-600">{t.price}</p>
            <p className="mt-1 text-xs text-zinc-500">{t.desc}</p>
            {/* Model dropdown (mock): live price per option lands with pricing feed. */}
            <select aria-label={`${t.tier} model`} defaultValue={t.model} className="mt-2 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              <option>{t.model}</option>
            </select>
          </div>
        ))}
      </section>

      <RoutingPanel
        distribution={[
          { model: "gemini-2.0-flash", share: 0.5 },
          { model: "claude-3-5-haiku", share: 0.22 },
          { model: "claude-3-5-sonnet", share: 0.14 },
          { model: "gpt-4o", share: 0.14 },
        ]}
        wouldHaveSpent={160.1}
        spent={121.9}
        qualityPerModel={[
          { model: "gemini-2.0-flash", score: 0.78 },
          { model: "claude-3-5-haiku", score: 0.84 },
          { model: "claude-3-5-sonnet", score: 0.91 },
          { model: "gpt-4o", score: 0.93 },
        ]}
        escalationRate={0.07}
        windowLabel="last 7d"
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Custom rules</h2>
          <p className="mb-2 text-xs text-zinc-500">IF agent AND task THEN model · YAML · hot-reload toast on save.</p>
          <textarea readOnly rows={8} defaultValue={RULES_YAML} aria-label="Routing rules YAML" className="w-full rounded-md border border-zinc-300 bg-zinc-50 p-3 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900" />
          <div className="mt-2 flex gap-2">
            <button type="button" title="Edit rules (mock)" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">Edit</button>
            <button type="button" title="Delete rule (mock)" className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 dark:border-red-900">Delete</button>
          </div>
        </section>
        <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Fallback chain</h2>
          <p className="mb-2 text-xs text-zinc-500">Drag to reorder (mock — static list until dnd lands).</p>
          <ol className="space-y-1.5">
            {["claude-3-5-sonnet", "claude-3-5-haiku", "gemini-2.0-flash"].map((m, i) => (
              <li key={m} className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 font-mono text-sm dark:border-zinc-800">
                <span aria-hidden className="cursor-grab text-zinc-400">⠿</span>
                <span className="text-zinc-500">{i + 1}.</span> {m}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
