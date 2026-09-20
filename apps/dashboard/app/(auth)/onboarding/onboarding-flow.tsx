// Onboarding flow — ship-track builder (spec 19 §Onboarding Flow, spec 17 §Auth).
// 3 steps vs live APIs: 1. workspace (POST /api/onboarding/workspace) →
// 2. first virtual key, FULL once + copy ✓ (POST /api/onboarding/key) →
// 3. connection test polling GET /api/onboarding/test (60s window, skip after
// 30s, green tick with real model/cost on first request).
// Back preserves input (all state lives here); progress dots; mobile stacked.

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createWorkspace, issueFirstKey, testConnection } from "@/lib/api-ext";

const POLL_MS = 3000;
const WINDOW_S = 60;
const SKIP_AFTER_S = 30;

type Sample = { model?: string; cost_usd?: number; agent_id?: string; ts?: string } | null;

function Dots({ step }: { step: number }) {
  return (
    <ol aria-label={`Step ${step + 1} of 3`} className="flex items-center gap-2">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          aria-current={i === step ? "step" : undefined}
          aria-label={`Step ${i + 1}${i === step ? " (current)" : ""}`}
          className={`h-2 w-8 rounded-full ${i === step ? "bg-indigo-600" : i < step ? "bg-indigo-300 dark:bg-indigo-800" : "bg-zinc-200 dark:bg-zinc-800"}`}
        />
      ))}
    </ol>
  );
}

export default function OnboardingFlow() {
  const [step, setStep] = useState(0);

  // Step 1 state (preserved on back).
  const [workspaceName, setWorkspaceName] = useState("");
  const [invites, setInvites] = useState<string[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  // Step 2 state (preserved on back).
  const [agentScope, setAgentScope] = useState("");
  const [fullKey, setFullKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Step 3 state.
  const [elapsed, setElapsed] = useState(0);
  const [connected, setConnected] = useState(false);
  const [sample, setSample] = useState<Sample>(null);
  const [requestsSeen, setRequestsSeen] = useState(0);
  const [hint, setHint] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<{ interval?: ReturnType<typeof setInterval>; timeout?: ReturnType<typeof setTimeout> }>({});

  const stopPoll = () => {
    if (timers.current.interval) clearInterval(timers.current.interval);
    if (timers.current.timeout) clearTimeout(timers.current.timeout);
    timers.current = {};
  };
  useEffect(() => stopPoll, []);

  const doWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createWorkspace(workspaceName.trim());
      setWorkspaceId(res.workspace.id);
      setStep(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "workspace_failed");
    } finally {
      setBusy(false);
    }
  };

  const doIssueKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await issueFirstKey(agentScope.trim());
      setFullKey(res.fullKey);
      setCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "key_failed");
    } finally {
      setBusy(false);
    }
  };

  const copyKey = async () => {
    if (!fullKey) return;
    try {
      await navigator.clipboard.writeText(fullKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const startPoll = () => {
    stopPoll();
    setElapsed(0);
    setConnected(false);
    setSample(null);
    setHint(null);
    const tick = async () => {
      try {
        // Scope the poll to the just-issued key so other workspaces' traffic
        // can't trip the green tick (prefix is safe to send — never secret).
        const res = await testConnection(fullKey ? { keyPrefix: fullKey.slice(0, 7) } : {});
        setRequestsSeen(res.requestsSeen);
        if (res.connected) {
          setConnected(true);
          setSample((res.sample ?? null) as Sample);
          stopPoll();
        } else {
          setHint(res.hint);
        }
      } catch {
        setHint("Test endpoint unreachable — is the dashboard running?");
      }
    };
    void tick();
    timers.current.interval = setInterval(() => {
      setElapsed((s) => s + POLL_MS / 1000);
      void tick();
    }, POLL_MS);
    timers.current.timeout = setTimeout(stopPoll, WINDOW_S * 1000);
  };

  useEffect(() => {
    if (step === 2) startPoll();
    else stopPoll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const shell = "max-w-md";
  return (
    <main className={`mx-auto flex min-h-screen w-full ${shell} flex-col justify-center gap-5 px-6 py-10`}>
      <Dots step={step} />

      {step === 0 && (
        <>
          <div>
            <p className="text-xs text-zinc-500">Step 1 of 3 — workspace</p>
            <h1 className="text-2xl font-bold tracking-tight">Welcome to AgentLedger</h1>
            <p className="text-sm text-zinc-500">Name your workspace. Teammates can join later.</p>
          </div>
          <form onSubmit={doWorkspace} className="flex flex-col gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium">Workspace name (required)</span>
              <input
                autoFocus
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                required
                maxLength={80}
                placeholder="acme-prod"
                aria-label="Workspace name"
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
              />
            </label>
            {invites.map((inv, i) => (
              <label key={i} className="text-sm">
                <span className="mb-1 block font-medium">Invite (optional)</span>
                <input
                  type="email"
                  value={inv}
                  onChange={(e) => setInvites((list) => list.map((v, j) => (j === i ? e.target.value : v)))}
                  placeholder="teammate@acme.com"
                  aria-label={`Invite email ${i + 1}`}
                  className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
                />
              </label>
            ))}
            <button
              type="button"
              onClick={() => setInvites((list) => [...list, ""])}
              className="w-fit rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            >
              + Add another
            </button>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={!workspaceName.trim() || busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
              {busy ? "Creating…" : "Continue →"}
            </button>
          </form>
        </>
      )}

      {step === 1 && (
        <>
          <div>
            <p className="text-xs text-zinc-500">Step 2 of 3 — connect agent</p>
            <h1 className="text-2xl font-bold tracking-tight">Your first virtual key</h1>
            <p className="text-sm text-zinc-500">Shown in FULL once. Copy it now — afterwards only last-4.</p>
          </div>
          {!fullKey ? (
            <form onSubmit={doIssueKey} className="flex flex-col gap-3">
              <label className="text-sm">
                <span className="mb-1 block font-medium">Agent scope (optional)</span>
                <input
                  autoFocus
                  value={agentScope}
                  onChange={(e) => setAgentScope(e.target.value)}
                  maxLength={80}
                  placeholder="writer"
                  aria-label="Agent scope"
                  className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 font-mono dark:border-zinc-700"
                />
              </label>
              {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => setStep(0)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">
                  ← Back
                </button>
                <button type="submit" disabled={busy} className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
                  {busy ? "Issuing…" : "Issue key"}
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
                <code className="min-w-0 flex-1 break-all font-mono text-xs">{fullKey}</code>
                <button
                  type="button"
                  onClick={() => void copyKey()}
                  aria-label="Copy key to clipboard"
                  className="shrink-0 rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium dark:border-zinc-700"
                >
                  {copied ? "✓ Copied" : "Copy"}
                </button>
              </div>
              <div className="rounded-lg bg-zinc-950 p-4 text-xs dark:bg-zinc-900">
                <p className="mb-2 font-medium text-zinc-400">Point your agent at the proxy:</p>
                <pre className="overflow-x-auto font-mono text-zinc-100">
{`OPENAI_BASE_URL="https://proxy.agentledger.io/v1"
OPENAI_API_KEY="${fullKey}"`}
                </pre>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setStep(0)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={!copied}
                  title={copied ? "Continue" : "Copy the key first — it will never be shown again"}
                  className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  Test Connection →
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <div>
            <p className="text-xs text-zinc-500">Step 3 of 3 — connection test</p>
            <h1 className="text-2xl font-bold tracking-tight">Listening for your first request</h1>
          </div>
          <div aria-live="polite" className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            {connected && sample ? (
              <div className="flex flex-col gap-2">
                <p className="text-lg font-semibold text-emerald-600">✅ Request received!</p>
                <p className="font-mono text-sm">
                  {sample.model ?? "unknown model"} ·{" "}
                  {sample.cost_usd != null ? `$${Number(sample.cost_usd).toFixed(6)}` : "cost n/a"}
                  {sample.agent_id ? ` · agent ${sample.agent_id}` : ""}
                </p>
                <p className="text-xs text-zinc-500">{requestsSeen} request(s) seen in window.</p>
              </div>
            ) : connected ? (
              <div className="flex flex-col gap-2">
                <p className="text-lg font-semibold text-emerald-600">✅ Request received!</p>
                <p className="text-xs text-zinc-500">{requestsSeen} request(s) seen in window.</p>
              </div>
            ) : elapsed >= WINDOW_S ? (
              <div className="flex flex-col gap-2">
                <p className="font-medium">No request seen in 60s.</p>
                <p className="text-sm text-zinc-500">{hint ?? "Send a request through the proxy, then retry."}</p>
                <button type="button" onClick={startPoll} className="w-fit rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">
                  Retry test
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="flex items-center gap-2 text-sm">
                  <span aria-hidden className="inline-block h-3 w-3 animate-ping rounded-full bg-indigo-500" />
                  Listening on your proxy URL… ({elapsed}s)
                </p>
                <p className="text-xs text-zinc-500">{hint ?? "Send a request through the proxy with your new key."}</p>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {elapsed >= SKIP_AFTER_S && !connected && (
              <Link href="/overview" className="rounded-lg border border-zinc-300 px-4 py-2 text-center text-sm dark:border-zinc-700">
                Skip for now →
              </Link>
            )}
            {connected ? (
              <Link href="/overview" className="rounded-lg bg-indigo-600 px-4 py-2 text-center text-sm font-medium text-white">
                Go to Dashboard →
              </Link>
            ) : (
              <button type="button" onClick={() => setStep(1)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">
                ← Back
              </button>
            )}
            {workspaceId && <p className="font-mono text-[11px] text-zinc-500">workspace {workspaceId}</p>}
          </div>
        </>
      )}
    </main>
  );
}
