// LiveTranscript — chat transcript for demo-agent runs (ledger-fix-transcript).
//
// Shared by ALL 5 demo agents: each `[agent]` detail page renders the latest
// run's transcript through this one component (research + ticket-classifier
// first is automatic — same component, same contract).
//
// Backend contract (POST /api/demo/run, both modes — sibling lands it in
// parallel, so EVERYTHING here is defensive):
//   transcript: [{agent, model, prompt, completion, ms, ok, error?}]
// (600-char truncated server-side). Optional extras (tokensIn/tokensOut/
// tokens) render when present but are never required. Absent transcript
// degrades to the empty state, never a crash.
//
// Tokens: spec 18 — zinc/indigo/emerald/red/amber classes only, `.mono` for
// model/ms/token figures. No new colors, no raw hex.

export type TranscriptEntry = {
  agent: string;
  model: string;
  prompt: string;
  completion: string;
  ms: number;
  ok: boolean;
  error?: string;
  tokensIn?: number;
  tokensOut?: number;
  tokens?: number;
};

/** Coerce unknown run-response payloads to TranscriptEntry[] (null when absent). */
export function normalizeTranscript(data: unknown): TranscriptEntry[] | null {
  if (!Array.isArray(data)) return null;
  const out: TranscriptEntry[] = [];
  for (const t of data) {
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    if (typeof o.agent !== "string" || typeof o.completion !== "string") continue;
    const num = (v: unknown): number | undefined =>
      typeof v === "number" && Number.isFinite(v) ? v : undefined;
    const entry: TranscriptEntry = {
      agent: o.agent,
      model: typeof o.model === "string" ? o.model : "unknown",
      prompt: typeof o.prompt === "string" ? o.prompt : "",
      completion: o.completion,
      ms: num(o.ms) ?? 0,
      ok: o.ok !== false,
    };
    if (typeof o.error === "string" && o.error) entry.error = o.error;
    const ti = num(o.tokensIn ?? o.tokens_in);
    const to = num(o.tokensOut ?? o.tokens_out);
    const tt = num(o.tokens);
    if (ti !== undefined) entry.tokensIn = ti;
    if (to !== undefined) entry.tokensOut = to;
    if (tt !== undefined) entry.tokens = tt;
    out.push(entry);
  }
  return out;
}

// planner → researcher → writer chain steps (research-agent) render grouped.
const CHAIN_STEPS = ["planner", "researcher", "writer"];

function isChainStep(agent: string): boolean {
  return CHAIN_STEPS.includes(agent);
}

function tokensLabel(e: TranscriptEntry): string | null {
  if (e.tokensIn !== undefined || e.tokensOut !== undefined) {
    return `${e.tokensIn ?? 0} in / ${e.tokensOut ?? 0} out`;
  }
  if (e.tokens !== undefined) return `${e.tokens} tokens`;
  return null;
}

function BubbleMeta({ entry }: { entry: TranscriptEntry }) {
  const tokens = tokensLabel(entry);
  return (
    <p className="mono mt-1 text-[11px] text-zinc-500">
      {entry.model} · {entry.ms.toFixed(0)}ms{tokens ? ` · ${tokens}` : ""} ·{" "}
      <span className={entry.ok ? "text-savings" : "text-overspend"}>
        {entry.ok ? "ok" : "failed"}
      </span>
    </p>
  );
}

function EntryBubbles({ entry, step }: { entry: TranscriptEntry; step: string | null }) {
  return (
    <li className="flex flex-col gap-1.5" aria-label={`${entry.agent} transcript turn`}>
      {entry.prompt ? (
        <div className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-indigo-600 px-3 py-2 text-sm text-white">
          <p className="mb-0.5 text-[11px] font-medium uppercase tracking-widest text-indigo-200">
            You → <span className="mono normal-case">{entry.agent}</span>
            {step ? ` · ${step}` : ""}
          </p>
          <p className="whitespace-pre-wrap break-words">{entry.prompt}</p>
        </div>
      ) : null}
      <div
        className={`mr-auto max-w-[85%] rounded-xl rounded-bl-sm border px-3 py-2 text-sm ${
          entry.ok
            ? "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
            : "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950"
        }`}
      >
        <p className="mb-0.5 text-[11px] font-medium uppercase tracking-widest text-zinc-500">
          <span className="mono normal-case">{entry.agent}</span>
          {step ? ` · ${step}` : ""}
        </p>
        <p className="whitespace-pre-wrap break-words text-zinc-800 dark:text-zinc-200">
          {entry.completion || "(empty completion)"}
        </p>
        {!entry.ok && entry.error ? (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {entry.error}
          </p>
        ) : null}
        <BubbleMeta entry={entry} />
      </div>
    </li>
  );
}

export default function Transcript({ entries }: { entries: TranscriptEntry[] | null | undefined }) {
  if (!entries || entries.length === 0) {
    return (
      <div aria-label="Empty transcript" className="rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
        <p className="text-sm text-zinc-500">
          No transcript yet — run the agent to see the chat.
        </p>
      </div>
    );
  }

  // Group consecutive planner → researcher → writer steps; everything else
  // renders as a singleton group in run order.
  const groups: { chain: boolean; items: { entry: TranscriptEntry; idx: number }[] }[] = [];
  entries.forEach((entry, idx) => {
    const last = groups[groups.length - 1];
    if (isChainStep(entry.agent) && last?.chain) {
      last.items.push({ entry, idx });
    } else if (isChainStep(entry.agent)) {
      groups.push({ chain: true, items: [{ entry, idx }] });
    } else {
      groups.push({ chain: false, items: [{ entry, idx }] });
    }
  });

  return (
    <ol aria-label="Run transcript" className="flex flex-col gap-4">
      {groups.map((g, gi) =>
        g.chain ? (
          <li
            key={`chain-${gi}`}
            aria-label={`Chain run: ${g.items.map((i) => i.entry.agent).join(" to ")}`}
            className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <p className="mb-2 text-xs font-medium uppercase tracking-widest text-zinc-500">
              Chain run · {g.items.map((i) => i.entry.agent).join(" → ")}
            </p>
            <ol className="flex flex-col gap-3">
              {g.items.map(({ entry, idx }) => (
                <EntryBubbles
                  key={`${entry.agent}-${idx}`}
                  entry={entry}
                  step={`step ${g.items.findIndex((i) => i.idx === idx) + 1} of ${g.items.length}`}
                />
              ))}
            </ol>
          </li>
        ) : (
          <EntryBubbles key={`${g.items[0].entry.agent}-${g.items[0].idx}`} entry={g.items[0].entry} step={null} />
        )
      )}
    </ol>
  );
}
