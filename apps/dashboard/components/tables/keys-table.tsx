"use client";

// KeysTable — ledger-web-dashboard table (spec 17 Keys / Virtual Key Vault).
// Full key shown ONCE at creation (parent handles the one-time banner);
// table shows last-4 only. Revoke = instant + confirm; Rotate = new key +
// configurable grace (both mock — management plane is backend).
// TODO(API): list/revoke/rotate via proxy management plane (ledger-web-backend).

import { useState } from "react";

export interface VirtualKey {
  id: string;
  name: string;
  scope: string;
  created: string;
  lastUsed: string;
  status: "active" | "revoked" | "rotating";
  last4: string;
}

const STATUS_STYLE: Record<VirtualKey["status"], string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  revoked: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  rotating: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

export default function KeysTable({ keys }: { keys: VirtualKey[] }) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (keys.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
        <p className="text-sm font-medium">No virtual keys yet.</p>
        <p className="mt-1 text-sm text-zinc-500">Create your first key — it is shown ONCE, then only last-4.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
            <th className="py-1.5 pr-3 font-medium">Name</th>
            <th className="py-1.5 pr-3 font-medium">Agent scope</th>
            <th className="py-1.5 pr-3 font-medium">Key</th>
            <th className="py-1.5 pr-3 font-medium">Created</th>
            <th className="py-1.5 pr-3 font-medium">Last used</th>
            <th className="py-1.5 pr-3 font-medium">Status</th>
            <th className="py-1.5 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id} className="border-b border-zinc-100 dark:border-zinc-900">
              <td className="py-1.5 pr-3 font-medium">{k.name}</td>
              <td className="py-1.5 pr-3 font-mono text-xs">{k.scope}</td>
              <td className="py-1.5 pr-3 font-mono text-xs">••••{k.last4}</td>
              <td className="py-1.5 pr-3 font-mono text-xs">{k.created}</td>
              <td className="py-1.5 pr-3 font-mono text-xs">{k.lastUsed}</td>
              <td className="py-1.5 pr-3">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[k.status]}`}>{k.status}</span>
              </td>
              <td className="py-1.5 text-right">
                {confirmId === k.id ? (
                  <span className="inline-flex gap-1">
                    <button type="button" onClick={() => setConfirmId(null)} aria-label={`Confirm revoke ${k.name}`} className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white">
                      Confirm
                    </button>
                    <button type="button" onClick={() => setConfirmId(null)} className="rounded border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700">
                      Cancel
                    </button>
                  </span>
                ) : (
                  <span className="inline-flex gap-1">
                    <button type="button" title="Rotate: new key + grace window (mock)" className="rounded border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700">
                      Rotate
                    </button>
                    <button type="button" onClick={() => setConfirmId(k.id)} className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 dark:border-red-900">
                      Revoke
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
