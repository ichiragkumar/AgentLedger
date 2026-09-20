"use client";

// Policies page — live rule list + create/edit against GET /api/policies
// (durable Postgres, hot-mirrored to the Go policy engine). Zero-state safe.

import { useEffect, useState } from "react";
import { buildPolicyYAML, usePolicies, type Policy } from "@/lib/hooks/use-policies";

const EMPTY_FORM = {
  name: "support-deny-frontier",
  team: "support",
  allowModels: "claude-3-5-haiku, gemini-2.0-flash",
  denyModels: "gpt-4o",
  maxTokens: "4096",
  denyHours: "0-6",
  redactPii: true,
  blockPii: false,
};

function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800 ${className}`} />;
}

export default function PoliciesPage() {
  const { policies, engineRules, engineReachable, loading, error, notice, setNotice, create, update, remove } =
    usePolicies();
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(null), 5000);
      return () => clearTimeout(t);
    }
  }, [notice, setNotice]);

  function set<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startEdit(p: Policy) {
    setEditingId(p.id);
    // Round-trip through stored YAML would need a parser; seed the form
    // from name/team and let the editor adjust the generated doc freely.
    setForm({ ...EMPTY_FORM, name: p.name, team: p.team });
    setFormError(null);
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const config = buildPolicyYAML(form);
    try {
      if (editingId) {
        await update(editingId, { name: form.name.trim(), team: form.team.trim(), config });
        setEditingId(null);
      } else {
        await create({ name: form.name.trim(), team: form.team.trim(), config });
      }
      setForm({ ...EMPTY_FORM, name: "", team: form.team });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save the rule.");
    }
  }

  async function onDelete(p: Policy) {
    if (!window.confirm(`Delete rule ${p.name}? The engine drops it immediately.`)) return;
    try {
      await remove(p.id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not delete the rule.");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {policies.length === 0 && !loading ? (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950">
          <strong>Fail-closed PII:</strong> no policy rules are configured, so redaction defaults to ON for all
          teams (live engine state — add a rule below to scope it).
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          Live engine:{" "}
          <strong className="mono">{engineReachable ? `${engineRules} rule${engineRules === 1 ? "" : "s"} loaded` : "unreachable — drafts still save durably"}</strong>
          . Saves hot-apply with a toast.
        </div>
      )}

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Policies</h1>
          <p className="text-sm text-zinc-500">Phase 4 engine — model access, PII, token caps, time windows.</p>
        </div>
      </header>

      {notice && (
        <div role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950">
          {notice}
        </div>
      )}
      {(error || formError) && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950">
          {error ? `Could not load policies (${error}) — showing zero state.` : formError}
        </div>
      )}

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Rules</h2>
        {loading ? (
          <div className="flex flex-col gap-2" aria-label="Loading policies">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-11/12" />
            <Skeleton className="h-6 w-10/12" />
          </div>
        ) : policies.length === 0 ? (
          <p className="text-sm text-zinc-500">No rules yet — create one below. Deny-lists, PII redaction, token caps, quiet hours.</p>
        ) : (
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
                {policies.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="mono py-1.5 pr-3 text-xs font-medium">{r.name}</td>
                    <td className="mono py-1.5 pr-3 text-xs">{r.team}</td>
                    <td className="py-1.5 pr-3">
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{r.kind}</span>
                    </td>
                    <td className="mono py-1.5 pr-3 text-xs">{String(r.updatedAt).slice(5, 10)}</td>
                    <td className="py-1.5 pr-3 text-xs text-zinc-600 dark:text-zinc-400">{r.summary}</td>
                    <td className="py-1.5 text-right">
                      <span className="inline-flex gap-1">
                        <button type="button" onClick={() => startEdit(r)} className="rounded border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700">
                          Edit
                        </button>
                        <button type="button" onClick={() => onDelete(r)} className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 dark:border-red-900">
                          Delete
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

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">{editingId ? "Edit rule" : "Create rule"}</h2>
        <form onSubmit={onSave} className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Name</span>
            <input value={form.name} onChange={(e) => set("name", e.target.value)} required aria-label="Rule name" className="mono w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Team scope (* = all)</span>
            <input value={form.team} onChange={(e) => set("team", e.target.value)} required aria-label="Team scope" className="mono w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Allow models (comma-separated, * wildcard)</span>
            <input value={form.allowModels} onChange={(e) => set("allowModels", e.target.value)} aria-label="Model allow list" className="mono w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Deny models (comma-separated)</span>
            <input value={form.denyModels} onChange={(e) => set("denyModels", e.target.value)} aria-label="Model deny list" className="mono w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Max output tokens</span>
            <input value={form.maxTokens} onChange={(e) => set("maxTokens", e.target.value)} inputMode="numeric" aria-label="Max output tokens" className="mono w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Deny hours UTC (e.g. 0-6,22-23)</span>
            <input value={form.denyHours} onChange={(e) => set("denyHours", e.target.value)} aria-label="Deny hours" className="mono w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <div className="flex items-center gap-4 text-sm sm:col-span-2">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={form.redactPii} onChange={(e) => set("redactPii", e.target.checked)} /> PII redact
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={form.blockPii} onChange={(e) => set("blockPii", e.target.checked)} /> PII block
            </label>
            {editingId && (
              <button type="button" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }} className="rounded border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
                Cancel
              </button>
            )}
            <button type="submit" className="ml-auto rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white">
              Save rule
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
