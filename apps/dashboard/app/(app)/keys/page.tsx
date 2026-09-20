// Keys page — ledger-web-dashboard owner (spec 17 §Keys / Virtual Key Vault).
// Async Server Component. Reuses KeysTable; provider keys masked.
// Full key shown ONCE at creation (banner slot below, mock empty).
// TODO(API): list/create/revoke/rotate via proxy management plane (backend).

import KeysTable, { type VirtualKey } from "@/components/tables/keys-table";

export const dynamic = "force-dynamic";

const keys: VirtualKey[] = [
  { id: "k1", name: "writer-prod", scope: "writer", created: "09-02", lastUsed: "09-20 09:12", status: "active", last4: "a91f" },
  { id: "k2", name: "researcher-prod", scope: "researcher", created: "09-02", lastUsed: "09-20 08:58", status: "active", last4: "77c0" },
  { id: "k3", name: "support-legacy", scope: "support-bot", created: "08-14", lastUsed: "09-18 22:03", status: "rotating", last4: "0be4" },
];

const providers = [
  { provider: "OpenAI", masked: "sk-••••1234" },
  { provider: "Anthropic", masked: "sk-ant-••••9d2a" },
  { provider: "Google", masked: "AIza••••7qwe" },
];

export default async function KeysPage() {
  return (
    <div className="flex flex-col gap-5">
      <div role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950">
        <strong>Warning:</strong> real provider keys are encrypted at rest — agents only ever see virtual keys.
        New virtual keys are shown <strong>ONCE</strong> at creation (with copy button); afterwards only last-4.
      </div>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Keys</h1>
          <p className="text-sm text-zinc-500">Virtual Key Vault — scoped, revocable, rotatable.</p>
        </div>
        <button type="button" title="Create key → one-time reveal banner (backend)" className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white">
          New virtual key
        </button>
      </header>

      {/* One-time reveal slot: populated by create-key response, never persisted. */}
      <section aria-label="New key reveal" className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
        No new key to reveal — the full key appears here exactly once after creation (mock empty state).
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Virtual keys</h2>
        <KeysTable keys={keys} />
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Provider keys</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
              <th className="py-1.5 pr-3 font-medium">Provider</th>
              <th className="py-1.5 pr-3 font-medium">Key</th>
              <th className="py-1.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.provider} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-1.5 pr-3 font-medium">{p.provider}</td>
                <td className="py-1.5 pr-3 font-mono text-xs">{p.masked}</td>
                <td className="py-1.5 text-right">
                  <span className="inline-flex gap-1">
                    <button type="button" title="Rotate provider key (mock)" className="rounded border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700">Rotate</button>
                    <button type="button" title="Delete provider key (mock)" className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 dark:border-red-900">Delete</button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
