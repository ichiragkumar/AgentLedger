// Integrations page — ecosystem surface (spec 17; new files only).
// Cards for DronaHQ / Anakin / Nasiko from GET /api/integrations (copy lives
// in the route). Per-platform "Create key" POSTs the live /api/keys route
// with a scoped name; the full key appears ONLY in the once-only reveal
// dialog (component state, cleared on close — keys-page pattern by COPY,
// not import: keys/page.tsx untouched).
// Keyboard: native buttons/checkboxes, Escape closes dialogs, focus lands on
// the dialog input/heading via autoFocus. Mobile: single-column stack.

"use client";

import { useCallback, useEffect, useState } from "react";

import DronaHqConsole from "@/components/integrations/dronahq-console";

export const dynamic = "force-dynamic";

type Integration = {
  id: string;
  name: string;
  status: "live" | "beta" | "coming-soon";
  docsPath: string;
  keyScope: string;
  tagline: string;
  steps: string[];
  live?: { keys: number; calls: number; spend: number };
};

type Reveal = { fullKey: string; name: string; warning: string; metered?: Metered; verified?: boolean } | null;

type Metered = {
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  statusCode: number;
} | null;

const STATUS_STYLE: Record<string, string> = {
  live: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  beta: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  "coming-soon": "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const STATUS_LABEL: Record<string, string> = {
  live: "Live",
  beta: "Beta",
  "coming-soon": "Coming soon",
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

function CardSkeleton() {
  return (
    <div aria-hidden className="animate-pulse rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="h-5 w-32 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-2 h-3 w-full rounded bg-zinc-100 dark:bg-zinc-900" />
      <div className="mt-2 h-3 w-2/3 rounded bg-zinc-100 dark:bg-zinc-900" />
      <div className="mt-4 h-9 w-28 rounded bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}

export default function IntegrationsPage() {
  const [items, setItems] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Setup-checklist ticks, in-memory only: `${integrationId}:${stepIdx}`.
  const [done, setDone] = useState<Record<string, boolean>>({});

  const [issueFor, setIssueFor] = useState<Integration | null>(null);
  const [issueName, setIssueName] = useState("");
  const [issueAgent, setIssueAgent] = useState("");
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<Reveal>(null);
  const [copied, setCopied] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations", { cache: "no-store" });
      if (!res.ok) throw new Error(`integrations_${res.status}`);
      const data = (await res.json()) as { integrations?: Integration[] };
      setItems(Array.isArray(data.integrations) ? data.integrations : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openIssue = (it: Integration) => {
    setIssueFor(it);
    setIssueName(`${it.id}-prod`);
    setIssueAgent(it.keyScope);
  };

  const closeReveal = useCallback(() => {
    // The full key lives only in this state — closing destroys it.
    setReveal(null);
    setCopied(false);
  }, []);

  const doIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueName.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: issueName.trim(), agentScope: issueAgent.trim() }),
      });
      if (!res.ok) throw new Error(res.status === 400 ? "invalid_key_request" : `issue_${res.status}`);
      const data = (await res.json()) as { key: { name: string }; fullKey: string; warning: string };
      setReveal({ fullKey: data.fullKey, name: data.key.name, warning: data.warning });
      setIssueFor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "issue_failed");
    } finally {
      setBusy(false);
    }
  };

  const doVerify = async (it: Integration) => {
    if (verifying) return;
    setVerifying(it.id);
    setError(null);
    try {
      const res = await fetch(`/api/integrations/${encodeURIComponent(it.id)}/verify`, {
        method: "POST",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(res.status === 404 ? "unknown_integration" : `verify_${res.status}`);
      const data = (await res.json()) as {
        key: { name: string };
        fullKey: string;
        warning: string;
        metered: Metered;
      };
      setReveal({ fullKey: data.fullKey, name: data.key.name, warning: data.warning, metered: data.metered, verified: true });
      setCopied(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "verify_failed");
    } finally {
      setVerifying(null);
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
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
        <p className="text-sm text-zinc-500">
          Connect ecosystem platforms with scoped virtual keys — each key is shown ONCE, then last-4 only.
        </p>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-300 p-4 text-sm dark:border-red-900">
          <p className="font-medium text-red-600">Integrations error: {error}</p>
          <button
            type="button"
            onClick={() => { setError(null); void refresh(); }}
            className="mt-2 rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div aria-label="Loading integrations" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : items.length === 0 && !error ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
          <p className="text-sm font-medium">No integrations registered yet.</p>
          <p className="mt-1 text-sm text-zinc-500">The registry at /api/integrations is empty — check back soon.</p>
        </div>
      ) : (
        <section aria-label="Ecosystem integrations" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((it) => {
            const doneCount = it.steps.filter((_, i) => done[`${it.id}:${i}`]).length;
            return (
              <article
                key={it.id}
                aria-label={`${it.name} integration`}
                className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold tracking-tight">{it.name}</h2>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[it.status] ?? ""}`}>
                    {STATUS_LABEL[it.status] ?? it.status}
                  </span>
                </div>
                <p className="text-sm text-zinc-500">{it.tagline}</p>

                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-widest text-zinc-500">
                    Setup ({doneCount}/{it.steps.length})
                  </p>
                  <ol className="flex flex-col gap-1.5">
                    {it.steps.map((step, i) => {
                      const key = `${it.id}:${i}`;
                      const checked = !!done[key];
                      return (
                        <li key={i}>
                          <label className="flex cursor-pointer items-start gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setDone((d) => ({ ...d, [key]: !d[key] }))}
                              aria-label={`${it.name} step ${i + 1}: ${step}`}
                              className="mt-0.5 accent-indigo-600"
                            />
                            <span className={checked ? "text-zinc-400 line-through" : ""}>{step}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ol>
                </div>

                <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => openIssue(it)}
                    disabled={it.status === "coming-soon"}
                    title={it.status === "coming-soon" ? "Provisioning opens at launch" : `Create a virtual key scoped to ${it.keyScope}`}
                    className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                  >
                    Create key
                  </button>
                  <button
                    type="button"
                    onClick={() => void doVerify(it)}
                    disabled={verifying !== null}
                    title={`Issue a fresh key, fire one ${it.name}-shaped call through the live proxy, show the metered proof`}
                    className="rounded-md border border-zinc-300 px-4 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    {verifying === it.id ? "Verifying…" : "Verify live"}
                  </button>
                  <span className="font-mono text-xs text-zinc-500" title="Pre-filled agent scope for the new key">
                    scope: {it.keyScope}
                  </span>
                  <a href={it.docsPath} className="ml-auto text-sm text-indigo-600 hover:underline dark:text-indigo-400">
                    Setup docs
                  </a>
                </div>
                {it.id === "dronahq" && <DronaHqConsole />}
                {it.live && (it.live.keys > 0 || it.live.calls > 0) && (
                  <p className="text-xs text-zinc-500" role="status">
                    {it.live.keys} key{it.live.keys === 1 ? "" : "s"} · {it.live.calls} metered call{it.live.calls === 1 ? "" : "s"} ·{" "}
                    <span className="mono">${it.live.spend.toFixed(6)}</span> metered
                  </p>
                )}
              </article>
            );
          })}
        </section>
      )}

      {issueFor && (
        <Dialog label={`Create key for ${issueFor.name}`} onClose={() => setIssueFor(null)}>
          <h2 className="text-lg font-semibold tracking-tight">Create key — {issueFor.name}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Scoped to this platform. The full key is shown <strong>ONCE</strong>; afterwards only last-4.
          </p>
          <form onSubmit={doIssue} className="mt-3 flex flex-col gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium">Name (required)</span>
              <input
                autoFocus
                value={issueName}
                onChange={(e) => setIssueName(e.target.value)}
                required
                maxLength={80}
                placeholder={`${issueFor.id}-prod`}
                aria-label="Key name"
                className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Agent scope</span>
              <input
                value={issueAgent}
                onChange={(e) => setIssueAgent(e.target.value)}
                maxLength={80}
                aria-label="Agent scope"
                className="w-full rounded-md border border-zinc-300 px-3 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setIssueFor(null)} className="rounded-md border border-zinc-300 px-4 py-1.5 text-sm dark:border-zinc-700">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!issueName.trim() || busy}
                className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy ? "Issuing…" : "Issue key"}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {reveal && (
        <Dialog label="New key — shown once" onClose={closeReveal}>
          <h2 className="text-lg font-semibold tracking-tight">Key issued — copy now</h2>
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
          {reveal.verified && (reveal.metered ? (
            <div role="status" className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950">
              <p className="font-medium text-emerald-800 dark:text-emerald-200">
                Verified live — {reveal.metered.model}
              </p>
              <p className="mono mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                {reveal.metered.tokensIn} in · {reveal.metered.tokensOut} out · $
                {reveal.metered.costUsd.toFixed(6)} metered · {reveal.metered.latencyMs.toFixed(0)}ms ·
                HTTP {reveal.metered.statusCode}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-amber-600">Call went through but no metered row settled — check request logs.</p>
          ))}
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
    </div>
  );
}
