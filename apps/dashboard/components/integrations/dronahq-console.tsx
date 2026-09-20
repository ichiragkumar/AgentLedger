// DronaHqConsole — DronaHQ card console (ledger-drona-ui).
//
// Working console inside the DronaHQ integration card: pick a read-only
// tool, edit its JSON args, run it live, and see the MCP result next to the
// metered LLM cost side by side.
//
// Backend contract (server holds the MCP token + vk material — secrets NEVER
// touch this client):
//   GET  /api/integrations/dronahq/tools            → { tools: Tool[] }
//   POST /api/integrations/dronahq/run   {tool,args} → { result, metered }
//   POST /api/integrations/dronahq/invoke {tool,args} → same (compat fallback)
// If the routes are not live yet the console falls back to a built-in
// read-only catalog for the picker/editor and reports run attempts as
// pending-backend errors with retry — the UI itself stays complete.
//
// Tokens: page zinc/indigo/emerald/red/amber classes only (spec 18 — no new
// colors, no raw hex). Cost figures use `.mono`. Keyboard: native
// select/textarea/buttons with labels; result in aria-live; Escape blurs the
// editor. Mobile: single-column stack.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const TOOLS_URL = "/api/integrations/dronahq/tools";
const RUN_URL = "/api/integrations/dronahq/run";
const INVOKE_URL = "/api/integrations/dronahq/invoke";

export type DronaTool = {
  name: string;
  description?: string;
  exampleArgs?: Record<string, unknown>;
};

export type Metered = {
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  statusCode?: number;
} | null;

type RunResult = {
  summary: string;
  raw?: unknown;
  metered: Metered;
  // DronaHQ run contract: `toolResultText` (2k truncated server-side) — what
  // DronaHQ returned, rendered as a quoted block under the summary. Optional:
  // absent until the backend sibling lands it, never a crash.
  toolResultText?: string;
};

// Built-in read-only catalog used ONLY until GET …/dronahq/tools is live.
// Shapes mirror the Tool-Builder JSON task verbs the proxy meters today.
const FALLBACK_TOOLS: DronaTool[] = [
  {
    name: "summarize_ticket",
    description: "Classify a support ticket and draft a suggested reply (read-only).",
    exampleArgs: {
      ticket_id: "T-1042",
      text: "Customer reports duplicate charge on the March invoice; wants a refund to the original card.",
    },
  },
  {
    name: "list_records",
    description: "List records from a DronaHQ sheet / table (read-only).",
    exampleArgs: { table: "tickets", limit: 10 },
  },
  {
    name: "get_record",
    description: "Fetch one record by id from a DronaHQ sheet / table (read-only).",
    exampleArgs: { table: "tickets", id: "T-1042" },
  },
];

function normalizeTools(data: unknown): DronaTool[] | null {
  const list = Array.isArray(data)
    ? data
    : (data as { tools?: unknown })?.tools;
  if (!Array.isArray(list)) return null;
  const out: DronaTool[] = [];
  for (const t of list) {
    if (typeof t === "string" && t.trim()) out.push({ name: t.trim() });
    else if (t && typeof t === "object") {
      const o = t as Record<string, unknown>;
      const name =
        typeof o.name === "string" ? o.name.trim() : typeof o.tool === "string" ? o.tool.trim() : "";
      if (!name) continue;
      out.push({
        name,
        description: typeof o.description === "string" ? o.description : undefined,
        exampleArgs:
          o.exampleArgs && typeof o.exampleArgs === "object"
            ? (o.exampleArgs as Record<string, unknown>)
            : o.args && typeof o.args === "object"
              ? (o.args as Record<string, unknown>)
              : undefined,
      });
    }
  }
  return out;
}

function normalizeMetered(m: unknown): Metered {
  if (!m || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v));
  const tokensIn = num(o.tokensIn ?? o.tokens_in);
  const tokensOut = num(o.tokensOut ?? o.tokens_out);
  const costUsd = num(o.costUsd ?? o.cost_usd);
  const latencyMs = num(o.latencyMs ?? o.latency_ms);
  return {
    model: typeof o.model === "string" ? o.model : "unknown",
    tokensIn: Number.isFinite(tokensIn) ? tokensIn : 0,
    tokensOut: Number.isFinite(tokensOut) ? tokensOut : 0,
    costUsd: Number.isFinite(costUsd) ? costUsd : 0,
    latencyMs: Number.isFinite(latencyMs) ? latencyMs : 0,
    statusCode: typeof o.statusCode === "number" ? o.statusCode : undefined,
  };
}

function normalizeResult(data: unknown): RunResult {
  const o = (data ?? {}) as Record<string, unknown>;
  const result = o.result ?? o.output ?? o.data ?? null;
  let summary = "";
  if (typeof o.summary === "string" && o.summary) summary = o.summary;
  else if (typeof result === "string") summary = result;
  else if (result !== null && result !== undefined) {
    try {
      summary = JSON.stringify(result, null, 2);
    } catch {
      summary = String(result);
    }
  } else if (typeof o.message === "string") summary = o.message;
  return {
    summary: summary || "(empty result)",
    raw: result ?? undefined,
    metered: normalizeMetered(o.metered ?? o.usage ?? null),
    toolResultText:
      typeof o.toolResultText === "string" && o.toolResultText ? o.toolResultText : undefined,
  };
}

function Skeleton() {
  return (
    <div aria-hidden className="animate-pulse rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="h-4 w-28 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-2 h-16 rounded bg-zinc-100 dark:bg-zinc-900" />
      <div className="mt-2 h-8 w-24 rounded bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}

export default function DronaHqConsole() {
  const [tools, setTools] = useState<DronaTool[] | null>(null);
  const [liveTools, setLiveTools] = useState(false);
  const [loadingTools, setLoadingTools] = useState(true);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [argsText, setArgsText] = useState("{}");
  const [argsError, setArgsError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  const loadTools = useCallback(async () => {
    setLoadingTools(true);
    setToolsError(null);
    try {
      const res = await fetch(TOOLS_URL, { cache: "no-store" });
      if (res.status === 404) {
        // Backend not live yet — picker/editor stay fully usable offline.
        setTools(FALLBACK_TOOLS);
        setLiveTools(false);
        return;
      }
      if (!res.ok) throw new Error(`tools_${res.status}`);
      const data = (await res.json()) as unknown;
      const list = normalizeTools(data);
      if (!list || list.length === 0) throw new Error("tools_empty");
      setTools(list);
      setLiveTools(true);
    } catch (e) {
      // Unreachable backend — same offline treatment, surfaced with retry.
      setTools(FALLBACK_TOOLS);
      setLiveTools(false);
      setToolsError(e instanceof Error ? e.message : "tools_unavailable");
    } finally {
      setLoadingTools(false);
    }
  }, []);

  useEffect(() => {
    void loadTools();
  }, [loadTools]);

  const active = useMemo(
    () => tools?.find((t) => t.name === selected) ?? null,
    [tools, selected]
  );

  // Prefill the args editor whenever the picked tool changes.
  useEffect(() => {
    const first = tools?.[0];
    if (!selected && first) {
      setSelected(first.name);
      setArgsText(JSON.stringify(first.exampleArgs ?? {}, null, 2));
      setArgsError(null);
      return;
    }
    if (active) {
      setArgsText(JSON.stringify(active.exampleArgs ?? {}, null, 2));
      setArgsError(null);
    }
  }, [tools, selected, active]);

  const onPick = (name: string) => {
    setSelected(name);
    setResult(null);
    setRunError(null);
  };

  const onArgs = (text: string) => {
    setArgsText(text);
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed !== "object" && !Array.isArray(parsed)) {
        setArgsError("args must be a JSON object");
      } else setArgsError(null);
    } catch {
      setArgsError("invalid JSON");
    }
  };

  const doRun = async () => {
    if (running || !selected) return;
    let args: unknown = {};
    try {
      args = argsText.trim() ? JSON.parse(argsText) : {};
    } catch {
      setArgsError("invalid JSON — fix args before running");
      return;
    }
    setRunning(true);
    setRunError(null);
    setResult(null);
    try {
      const body = JSON.stringify({ tool: selected, args });
      let res = await fetch(RUN_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      if (res.status === 404) {
        // Compat: older contract exposed POST …/invoke {tool,args}.
        res = await fetch(INVOKE_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
      }
      if (res.status === 404) throw new Error("run_pending_backend");
      if (!res.ok) throw new Error(`run_${res.status}`);
      const data = (await res.json()) as unknown;
      setResult(normalizeResult(data));
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "run_failed");
    } finally {
      setRunning(false);
    }
  };

  if (tools === null || loadingTools) return <Skeleton />;

  return (
    <div
      aria-label="DronaHQ live console"
      className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Live console</p>
        {liveTools === false && (
          <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            offline catalog — live tools pending
          </span>
        )}
      </div>

      {toolsError && (
        <p role="alert" className="text-xs text-amber-600">
          Tool list unreachable ({toolsError}) — showing offline catalog.{" "}
          <button type="button" onClick={() => void loadTools()} className="underline">
            Retry
          </button>
        </p>
      )}

      <label className="text-xs">
        <span className="mb-1 block font-medium uppercase tracking-widest text-zinc-500">Tool</span>
        <select
          value={selected}
          onChange={(e) => onPick(e.target.value)}
          aria-label="DronaHQ tool"
          className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {tools.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {active?.description && <p className="text-xs text-zinc-500">{active.description}</p>}

      <label className="text-xs">
        <span className="mb-1 block font-medium uppercase tracking-widest text-zinc-500">Args (JSON)</span>
        <textarea
          value={argsText}
          onChange={(e) => onArgs(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void doRun();
          }}
          aria-label="Tool arguments as JSON"
          aria-invalid={argsError !== null}
          spellCheck={false}
          rows={4}
          className="mono w-full rounded-md border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      {argsError ? (
        <p role="alert" className="text-xs text-red-600">
          {argsError}
        </p>
      ) : (
        <p className="text-xs text-zinc-500">⌘/Ctrl + Enter to run.</p>
      )}

      <div>
        <button
          type="button"
          onClick={() => void doRun()}
          disabled={running || !selected || argsError !== null}
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {running ? "Running…" : "Run tool"}
        </button>
      </div>

      {runError && (
        <div role="alert" className="rounded-md border border-red-300 p-2 text-xs dark:border-red-900">
          <p className="font-medium text-red-600">
            {runError === "run_pending_backend"
              ? "Run backend not live yet (POST …/dronahq/run pending) — picker + args above are ready."
              : `Run failed: ${runError}`}
          </p>
          <button
            type="button"
            onClick={() => { setRunError(null); void doRun(); }}
            className="mt-1 rounded-md border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700"
          >
            Retry
          </button>
        </div>
      )}

      {running && <Skeleton />}

      {result && (
        <div aria-live="polite" className="flex flex-col gap-2">
          <div className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
            <p className="mb-1 text-xs font-medium uppercase tracking-widest text-zinc-500">Result</p>
            <pre className="mono max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{result.summary}</pre>
          </div>
          {result.toolResultText && (
            <blockquote
              aria-label="What DronaHQ returned"
              className="border-l-2 border-indigo-600 bg-indigo-50 px-2.5 py-1.5 text-xs text-zinc-700 dark:border-indigo-400 dark:bg-indigo-950 dark:text-zinc-300"
            >
              <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-zinc-500">
                What DronaHQ returned
              </p>
              <pre className="mono max-h-48 overflow-auto whitespace-pre-wrap break-words">{result.toolResultText}</pre>
            </blockquote>
          )}
          {result.metered ? (
            <div
              role="status"
              className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs dark:border-emerald-900 dark:bg-emerald-950"
            >
              <p className="font-medium text-emerald-800 dark:text-emerald-200">
                Metered — {result.metered.model}
                {typeof result.metered.statusCode === "number" ? ` · HTTP ${result.metered.statusCode}` : ""}
              </p>
              <p className="mono mt-0.5 text-emerald-700 dark:text-emerald-300">
                {result.metered.tokensIn} in · {result.metered.tokensOut} out · $
                {result.metered.costUsd.toFixed(6)} · {result.metered.latencyMs.toFixed(0)}ms
              </p>
            </div>
          ) : (
            <p role="status" className="text-xs text-amber-600">
              Ran but no metered row settled — check request logs.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
