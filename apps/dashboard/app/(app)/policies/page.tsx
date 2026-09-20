// Policies page — ledger-web-dashboard owner (spec 17 §Policies).
// Async Server Component. Rule list + create/edit UI are mock; policy rows
// come from the `policies` table / policy YAML via backend.
// TODO(API): list/save from policies API (backend); save → hot-applied + toast.

export const dynamic = "force-dynamic";

type PolicyKind = "model-access" | "pii" | "max-tokens" | "time-window";

interface PolicyRule {
  id: string;
  name: string;
  team: string;
  kind: PolicyKind;
  updated: string;
  summary: string;
}

const rules: PolicyRule[] = [
  { id: "p1", name: "support-deny-frontier", team: "support", kind: "model-access", updated: "09-18", summary: "deny gpt-4o, allow haiku + flash" },
  { id: "p2", name: "pii-redact-all", team: "*", kind: "pii", updated: "09-15", summary: "redact emails + API keys in logs" },
  { id: "p3", name: "writer-cap-4k", team: "content", kind: "max-tokens", updated: "09-12", summary: "max 4096 output tokens" },
  { id: "p4", name: "no-nightly-frontier", team: "*", kind: "time-window", updated: "09-10", summary: "deny frontier 00:00–06:00 UTC" },
];

export default async function PoliciesPage() {
  return (
    <div className="flex flex-col gap-5">
      <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950">
        <strong>Fail-closed PII:</strong> no internal allowlist is configured, so redaction defaults to ON for all teams (mock banner — live state from policy engine).
      </div>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Policies</h1>
          <p className="text-sm text-zinc-500">Phase 4 engine — model access, PII, token caps, time windows.</p>
        </div>
        <button type="button" title="Create rule (mock — save wires to policies API)" className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white">
          New rule
        </button>
      </header>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Rules</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
                <th className="py-1.5 pr-3 font-medium">Name</th>
                <th className="py-1.5 pr-3 font-medium">Team scope</th>
                <th className="py-1.5 pr-3 font-medium">Kind</th>
                <th className="py-1.5 pr-3 font-medium">Updated</th>
                <th className="py-1.5 pr-3 font-medium">Summary</th>
                <th className="py-1.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="py-1.5 pr-3 font-mono text-xs font-medium">{r.name}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{r.team}</td>
                  <td className="py-1.5 pr-3">
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{r.kind}</span>
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{r.updated}</td>
                  <td className="py-1.5 pr-3 text-xs text-zinc-600 dark:text-zinc-400">{r.summary}</td>
                  <td className="py-1.5 text-right">
                    <span className="inline-flex gap-1">
                      <button type="button" title="Edit rule (mock)" className="rounded border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700">Edit</button>
                      <button type="button" title="Delete rule (mock)" className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 dark:border-red-900">Delete</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Create / edit (mock)</h2>
        {/* Mock form: submit wiring (server action) lands with policies API. */}
        <form className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Name</span>
            <input defaultValue="support-deny-frontier" aria-label="Rule name" className="w-full rounded-md border border-zinc-300 px-3 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Team scope (* = all)</span>
            <input defaultValue="support" aria-label="Team scope" className="w-full rounded-md border border-zinc-300 px-3 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-medium">Allow / deny models (comma-separated, * wildcard)</span>
            <input defaultValue="allow: claude-3-5-haiku, gemini-2.0-flash · deny: gpt-4o" aria-label="Model allow deny list" className="w-full rounded-md border border-zinc-300 px-3 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Max output tokens</span>
            <input type="number" defaultValue={4096} aria-label="Max output tokens" className="w-full rounded-md border border-zinc-300 px-3 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Deny hours (UTC)</span>
            <input defaultValue="00:00–06:00" aria-label="Deny hours" className="w-full rounded-md border border-zinc-300 px-3 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <div className="flex items-center gap-4 text-sm sm:col-span-2">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" defaultChecked /> PII redact
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" /> PII block
            </label>
            <button type="submit" title="Save → hot-applied + toast (backend)" className="ml-auto rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white">
              Save rule
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
