// Keys page — ship-track builder (spec 17 §Keys / Virtual Key Vault).
// Live: list/issue/revoke/rotate via /api/keys (proxy-first, once-only).
// Full key material appears ONLY in the issue/rotate reveal dialog (component
// state, cleared on close, never persisted) — afterwards last-4 only.
// Table is inline: the live VirtualKey shape (agentScope/teamScope, createdAt,
// graceExpiresAt) differs from the mock KeysTable.
// Keyboard: dialogs trap nothing but expose labels, Escape closes, focus lands
// on the dialog heading via autoFocus.

"use client";

import { useCallback, useEffect, useState } from "react";
import { getKeys, issueKey, revokeKey, rotateKey, type VirtualKey } from "@/lib/api-ext";

export const dynamic = "force-dynamic";

type Reveal = { fullKey: string; name: string; rotated: boolean; warning: string } | null;

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  grace: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  revoked: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

function Dialog({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export default function KeysPage() {
  const [keys, setKeys] = useState<VirtualKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [showIssue, setShowIssue] = useState(false);
  const [issueName, setIssueName] = useState("");
  const [issueAgent, setIssueAgent] = useState("");
  const [issueTeam, setIssueTeam] = useState("");
  const [reveal, setReveal] = useState<Reveal>(null);
  const [copied, setCopied] = useState(false);

  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [rotateId, setRotateId] = useState<string | null>(null);
  const [graceHours, setGraceHours] = useState(1);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getKeys();
      setKeys(res.keys);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const closeReveal = useCallback(() => {
    // The full key lives only in this state — closing destroys it.
    setReveal(null);
    setCopied(false);
  }, []);

  const doIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueName.trim()) return;
    setBusy("issue");
    try {
      const res = await issueKey({ name: issueName.trim(), agentScope: issueAgent.trim(), teamScope: issueTeam.trim() });
      setReveal({ fullKey: res.fullKey, name: res.key.name, rotated: false, warning: res.warning });
      setShowIssue(false);
      setIssueName("");
      setIssueAgent("");
      setIssueTeam("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "issue_failed");
    } finally {
      setBusy(null);
    }
  };

  const doRevoke = async () => {
    if (!revokeId) return;
    setBusy(revokeId);
    try {
      await revokeKey(revokeId);
      setRevokeId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "revoke_failed");
    } finally {
      setBusy(null);
    }
  };

  const doRotate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rotateId) return;
    setBusy(rotateId);
    try {
      const res = await rotateKey(rotateId, Math.round(graceHours * 3600));
      setReveal({ fullKey: res.fullKey, name: res.key.name, rotated: true, warning: res.warning });
      setRotateId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "rotate_failed");
    } finally {
      setBusy(null);
    }
  };

  const copyKey = async () => {
    if (!reveal) return;
    try {
      await navigator.clipboard.writeText(reveal.fullKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950">
        <strong>Warning:</strong> real provider keys are encrypted at rest — agents only ever see virtual keys.
        New virtual keys are shown <strong>ONCE</strong> at creation (with copy button); afterwards only last-4.
      </div>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Keys</h1>
          <p className="text-sm text-zinc-500">
            Virtual Key Vault — scoped, revocable, rotatable ({keys.filter((k) => k.status === "active").length} active).
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowIssue(true)}
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white"
        >
          New virtual key
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-300 p-4 text-sm dark:border-red-900">
          <p className="font-medium text-red-600">Keys error: {error}</p>
          <button
            type="button"
            onClick={() => { setError(null); void refresh(); }}
            className="mt-2 rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
          >
            Retry
          </button>
        </div>
      )}

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Virtual keys</h2>
        {loading ? (
          <div aria-label="Loading keys" className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
            ))}
          </div>
        ) : keys.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
            <p className="text-sm font-medium">No virtual keys yet.</p>
            <p className="mt-1 text-sm text-zinc-500">Create your first key — it is shown ONCE, then only last-4.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
                  <th className="py-1.5 pr-3 font-medium">Name</th>
                  <th className="py-1.5 pr-3 font-medium">Scopes</th>
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
                    <td className="py-1.5 pr-3 font-mono text-xs">
                      {[k.agentScope, k.teamScope].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs" title={`prefix ${k.prefix}`}>
                      ••••{k.last4}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{new Date(k.createdAt).toLocaleString()}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}
                    </td>
                    <td className="py-1.5 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[k.status] ?? ""}`}>
                        {k.status}
                      </span>
                      {k.status === "grace" && k.graceExpiresAt && (
                        <span className="mt-1 block font-mono text-[11px] text-zinc-500" title={`rotated from ${k.rotatedFrom ?? "—"}`}>
                          grace until {new Date(k.graceExpiresAt).toLocaleString()}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right">
                      <span className="inline-flex gap-1">
                        <button
                          type="button"
                          disabled={k.status === "revoked" || busy === k.id}
                          onClick={() => setRotateId(k.id)}
                          title="Rotate: issue a new key; old key stays valid for the grace window"
                          className="rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-zinc-700"
                        >
                          Rotate
                        </button>
                        <button
                          type="button"
                          disabled={k.status === "revoked" || busy === k.id}
                          onClick={() => setRevokeId(k.id)}
                          className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 disabled:opacity-40 dark:border-red-900"
                        >
                          Revoke
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showIssue && (
        <Dialog label="Issue virtual key" onClose={() => setShowIssue(false)}>
          <h2 className="text-lg font-semibold tracking-tight">New virtual key</h2>
          <form onSubmit={doIssue} className="mt-3 flex flex-col gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium">Name (required)</span>
              <input
                autoFocus
                value={issueName}
                onChange={(e) => setIssueName(e.target.value)}
                required
                maxLength={80}
                placeholder="writer-prod"
                aria-label="Key name"
                className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Agent scope (optional)</span>
              <input
                value={issueAgent}
                onChange={(e) => setIssueAgent(e.target.value)}
                maxLength={80}
                placeholder="writer"
                aria-label="Agent scope"
                className="w-full rounded-md border border-zinc-300 px-3 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Team scope (optional)</span>
              <input
                value={issueTeam}
                onChange={(e) => setIssueTeam(e.target.value)}
                maxLength={80}
                placeholder="content"
                aria-label="Team scope"
                className="w-full rounded-md border border-zinc-300 px-3 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowIssue(false)} className="rounded-md border border-zinc-300 px-4 py-1.5 text-sm dark:border-zinc-700">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!issueName.trim() || busy === "issue"}
                className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy === "issue" ? "Issuing…" : "Issue key"}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {reveal && (
        <Dialog label={reveal.rotated ? "Rotated key — shown once" : "New key — shown once"} onClose={closeReveal}>
          <h2 className="text-lg font-semibold tracking-tight">
            {reveal.rotated ? "Rotated — copy the new key" : "Key issued — copy now"}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            {reveal.warning} This dialog is the only place it ever appears.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
            <code className="min-w-0 flex-1 break-all font-mono text-xs">{reveal.fullKey}</code>
            <button
              type="button"
              onClick={() => void copyKey()}
              aria-label="Copy key to clipboard"
              className="shrink-0 rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium dark:border-zinc-700"
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 font-mono text-xs text-zinc-500">key for “{reveal.name}” · table shows last-4 only</p>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={closeReveal}
              disabled={!copied}
              title={copied ? "Close" : "Copy the key first — it will never be shown again"}
              className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Done — I copied it
            </button>
          </div>
        </Dialog>
      )}

      {revokeId && (
        <Dialog label="Confirm revoke" onClose={() => setRevokeId(null)}>
          <h2 className="text-lg font-semibold tracking-tight">Revoke this key?</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Revocation is instant — agents using this key will be rejected immediately. This cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setRevokeId(null)} className="rounded-md border border-zinc-300 px-4 py-1.5 text-sm dark:border-zinc-700">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void doRevoke()}
              disabled={busy === revokeId}
              aria-label={`Confirm revoke ${revokeId}`}
              className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy === revokeId ? "Revoking…" : "Revoke now"}
            </button>
          </div>
        </Dialog>
      )}

      {rotateId && (
        <Dialog label="Rotate key with grace" onClose={() => setRotateId(null)}>
          <h2 className="text-lg font-semibold tracking-tight">Rotate key</h2>
          <p className="mt-1 text-sm text-zinc-500">
            A new key is issued (shown ONCE). The old key stays valid until the grace window expires.
          </p>
          <form onSubmit={doRotate} className="mt-3 flex flex-col gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium">Grace period (hours, max 168)</span>
              <input
                type="number"
                min={0}
                max={168}
                step={0.5}
                value={graceHours}
                onChange={(e) => setGraceHours(Number(e.target.value))}
                aria-label="Grace period in hours"
                className="w-full rounded-md border border-zinc-300 px-3 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRotateId(null)} className="rounded-md border border-zinc-300 px-4 py-1.5 text-sm dark:border-zinc-700">
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy === rotateId}
                className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy === rotateId ? "Rotating…" : "Rotate"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
