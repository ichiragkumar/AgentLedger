// Routing page — live (spec 17 §Routing, spec 06).
// Client component on useRouting: tier config with model dropdown + live
// registry prices, 7d distribution, YAML rules editor with highlight,
// drag-reorder fallback (keyboard + touch-button accessible), savings
// headline. Skeletons while loading; empty states when no traffic/rules;
// toasts confirm saves. Money always .mono (spec 18).

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import RoutingPanel from "@/components/routing-panel";
import StatCard from "@/components/cards/stat-card";
import { useRouting, type RoutingRule } from "@/lib/hooks/use-routing";

export const dynamic = "force-dynamic";

const PIE_COLORS = ["#22c55e", "#38bdf8", "#a78bfa", "#f59e0b", "#ef4444", "#94a3b8"];

const money = (n: number) => `$${n.toFixed(2)}`;

// --- YAML (subset mirrors router.Engine: `rules:` list of flat maps) ---

type ParsedRule = { id: string; agentId: string; taskType: string; model: string; tier: string; priority: number };

function rulesToYaml(rules: RoutingRule[]): string {
  const lines = ["rules:"];
  for (const r of rules) {
    lines.push(`  - id: ${r.id}`);
    if (r.agentId) lines.push(`    agent_id: ${r.agentId}`);
    if (r.taskType) lines.push(`    task_type: ${r.taskType}`);
    lines.push(`    model: ${r.model}`);
    if (r.tier) lines.push(`    tier: ${r.tier}`);
    lines.push(`    priority: ${r.priority}`);
  }
  return lines.join("\n") + "\n";
}

function parseRulesYaml(text: string): { rules: ParsedRule[]; error?: string } {
  const rules: ParsedRule[] = [];
  let cur: Record<string, string> | null = null;
  let inRules = false;
  const flush = () => {
    if (!cur) return;
    const model = (cur.model ?? "").trim();
    if (!model) {
      cur = null;
      return;
    }
    const prioRaw = (cur.priority ?? "0").trim();
    if (!/^-?\d+$/.test(prioRaw)) throw new Error(`bad priority ${JSON.stringify(prioRaw)}`);
    rules.push({
      id: (cur.id ?? "").trim(),
      agentId: (cur.agent_id ?? "").trim(),
      taskType: (cur.task_type ?? "").trim(),
      model,
      tier: (cur.tier ?? "").trim(),
      priority: parseInt(prioRaw, 10),
    });
    cur = null;
  };
  try {
    for (const rawLine of text.split("\n")) {
      const hash = rawLine.indexOf("#");
      const line = (hash >= 0 ? rawLine.slice(0, hash) : rawLine).replace(/\s+$/, "");
      if (!line.trim()) continue;
      if (!line.startsWith(" ") && !line.startsWith("\t")) {
        if (line.trim() === "rules:") {
          inRules = true;
          continue;
        }
        return { rules, error: `only top-level "rules:" supported, got ${JSON.stringify(line.trim())}` };
      }
      if (!inRules) return { rules, error: "content before `rules:`" };
      const body = line.trim();
      if (body.startsWith("- ") || body === "-") {
        flush();
        cur = {};
        const rest = body.slice(1).trim();
        if (!rest) continue;
        const kv = rest.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
        if (!kv) return { rules, error: `want \`key: value\`, got ${JSON.stringify(rest)}` };
        cur[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
        continue;
      }
      if (!cur) return { rules, error: "mapping outside list item (start items with `-`)" };
      const kv = body.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
      if (!kv) return { rules, error: `want \`key: value\`, got ${JSON.stringify(body)}` };
      if (!["id", "agent_id", "task_type", "model", "tier", "priority"].includes(kv[1])) {
        return { rules, error: `unknown key ${JSON.stringify(kv[1])}` };
      }
      cur[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
    }
    flush();
  } catch (e) {
    return { rules, error: e instanceof Error ? e.message : "parse error" };
  }
  return { rules };
}

/** Minimal YAML highlight: comments, keys, list markers. Escaped, no deps. */
function highlightYaml(text: string): { __html: string } {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = text
    .split("\n")
    .map((line) => {
      const hash = line.indexOf("#");
      const code = hash >= 0 ? line.slice(0, hash) : line;
      const comment = hash >= 0 ? line.slice(hash) : "";
      const marked = esc(code).replace(
        /(^|\s)(rules:|-\s|(?:id|agent_id|task_type|model|tier|priority)(?=:))/g,
        '$1<span class="text-indigo-500 font-semibold">$2</span>'
      );
      return marked + (comment ? `<span class="text-zinc-400 italic">${esc(comment)}</span>` : "");
    })
    .join("\n");
  return { __html: html + "\n" };
}

// --- Page ---

type Toast = { kind: "ok" | "err"; msg: string } | null;

export default function RoutingPage() {
  const {
    tiers, models, tiersSource, rules, fallback, fallbackSource,
    distribution, loading, error, refresh,
    saveTiers, createRule, updateRule, deleteRule, saveFallback,
  } = useRouting();

  const [toast, setToast] = useState<Toast>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (kind: "ok" | "err", msg: string) => {
    setToast({ kind, msg });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  };
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // Tier drafts
  const [tierDraft, setTierDraft] = useState<Record<string, string>>({});
  const [savingTiers, setSavingTiers] = useState(false);
  useEffect(() => {
    setTierDraft(Object.fromEntries(tiers.map((t) => [t.id, t.model])));
  }, [tiers]);

  // Rules: YAML editor + inline edit + add form
  const [yaml, setYaml] = useState("");
  const [yamlDirty, setYamlDirty] = useState(false);
  const [savingYaml, setSavingYaml] = useState(false);
  useEffect(() => {
    if (!yamlDirty) setYaml(rulesToYaml(rules));
  }, [rules, yamlDirty]);
  const yamlPreRef = useRef<HTMLPreElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ agentId: "", taskType: "", model: "", tier: "", priority: 0 });
  const [newDraft, setNewDraft] = useState({ agentId: "", taskType: "", model: "", tier: "", priority: 10 });
  const [ruleBusy, setRuleBusy] = useState(false);

  // Fallback order
  const [order, setOrder] = useState<string[]>([]);
  const [savingFallback, setSavingFallback] = useState(false);
  const dragFrom = useRef<number | null>(null);
  useEffect(() => {
    setOrder(fallback);
  }, [fallback]);

  const summary = distribution?.summary;
  const hasTraffic = (summary?.requests ?? 0) > 0;

  const dayBars = useMemo(() => {
    if (!distribution) return [];
    const byDay = new Map<string, { model: string; requests: number; spend: number }[]>();
    for (const d of distribution.daily) {
      const list = byDay.get(d.day) ?? [];
      list.push({ model: d.model, requests: d.requests, spend: d.spend });
      byDay.set(d.day, list);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([day, slices]) => {
        const total = slices.reduce((a, s) => a + s.requests, 0);
        return { day, slices, total };
      });
  }, [distribution]);

  const onSaveTiers = async () => {
    setSavingTiers(true);
    try {
      const items = tiers.map((t) => ({ id: t.id, model: (tierDraft[t.id] ?? t.model).trim() }));
      if (items.some((i) => !i.model)) {
        flash("err", "Tier model must not be empty.");
        return;
      }
      await saveTiers(items);
      flash("ok", "Tier map saved ✓ · proxy sync pending (see WIRING).");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "save failed");
    } finally {
      setSavingTiers(false);
    }
  };

  const onSaveYaml = async () => {
    const { rules: parsed, error: perr } = parseRulesYaml(yaml);
    if (perr) {
      flash("err", `YAML: ${perr}`);
      return;
    }
    setSavingYaml(true);
    try {
      const current = new Map(rules.map((r) => [r.id, r]));
      const seen = new Set<string>();
      for (const p of parsed) {
        if (p.id && current.has(p.id)) {
          seen.add(p.id);
          const c = current.get(p.id)!;
          if (c.agentId !== p.agentId || c.taskType !== p.taskType || c.model !== p.model || c.tier !== p.tier || c.priority !== p.priority) {
            await updateRule(p.id, { agentId: p.agentId, taskType: p.taskType, model: p.model, tier: p.tier, priority: p.priority });
          }
        } else {
          const res = await createRule({ agentId: p.agentId || undefined, taskType: p.taskType || undefined, model: p.model, tier: p.tier || undefined, priority: p.priority });
          if (p.id) seen.add(res.rule.id);
        }
      }
      for (const c of rules) {
        if (c.id && !parsed.some((p) => p.id === c.id) && !seen.has(c.id) && parsed.some((p) => p.id)) {
          // Only delete when the YAML carries ids (otherwise ids are absent by construction).
          await deleteRule(c.id);
        }
      }
      setYamlDirty(false);
      await refresh();
      flash("ok", `Rules saved ✓ · ${parsed.length} rule(s) · hot-reload on proxy sync (see WIRING).`);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "save failed");
    } finally {
      setSavingYaml(false);
    }
  };

  const moveFallback = (i: number, dir: -1 | 1) => {
    setOrder((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const onSaveFallback = async () => {
    setSavingFallback(true);
    try {
      await saveFallback(order);
      flash("ok", "Fallback chain saved ✓ · proxy sync pending (see WIRING).");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "save failed");
    } finally {
      setSavingFallback(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading routing">
        <div className="h-16 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
          ))}
        </div>
      </div>
    );
  }

  if (error && !distribution) {
    return (
      <div className="flex flex-col gap-5">
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950">
          Routing API unavailable ({error}).{" "}
          <button type="button" onClick={() => void refresh()} className="font-medium underline">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {toast && (
        <div
          role="status"
          className={`rounded-xl border p-3 text-sm ${
            toast.kind === "ok"
              ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950"
              : "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950"
          }`}
        >
          {toast.msg}
        </div>
      )}

      <div
        role="status"
        className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950"
      >
        <strong>ACTIVE — saving avg {(summary?.savedPct ?? 0).toFixed(1)}%.</strong>{" "}
        <span className="text-zinc-600 dark:text-zinc-400">
          {hasTraffic ? (
            <>
              Saved <span className="mono font-semibold">{money(summary!.saved)}</span> this week vs always-frontier baseline.
            </>
          ) : (
            "No routed traffic in the last 7d — send a request through the proxy to warm up."
          )}
        </span>
      </div>

      <header>
        <h1 className="text-2xl font-bold tracking-tight">Routing</h1>
        <p className="text-sm text-zinc-500">Right model, right price — tiers, rules, fallback.</p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          label="Saved this week"
          value={money(summary?.saved ?? 0)}
          sub={`${(summary?.savedPct ?? 0).toFixed(1)}% vs frontier`}
          invert={false}
        />
        <StatCard label="Escalation rate" value="n/a" sub="guard export pending — budget 10%" invert={false} />
      </div>

      <section aria-label="Tier configuration">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Tier configuration</h2>
          <div className="flex items-center gap-2">
            {tiersSource === "default" && <span className="text-xs text-zinc-500">defaults — save to pin</span>}
            <button
              type="button"
              onClick={() => void onSaveTiers()}
              disabled={savingTiers}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {savingTiers ? "Saving…" : "Save tiers"}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tiers.map((t) => (
            <div key={t.id} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">{t.id}</p>
              <p className="mono mt-1 text-sm font-bold">{tierDraft[t.id] ?? t.model}</p>
              <p className="mono text-xs text-emerald-600">
                ${t.blendedPer1M.toFixed(t.blendedPer1M < 0.1 ? 3 : 2)} / 1M
                {!t.known && <span className="text-amber-600"> · unpriced</span>}
              </p>
              <p className="mt-1 text-xs text-zinc-500">{t.description}</p>
              <label className="mt-2 block text-xs text-zinc-500">
                Model
                <select
                  aria-label={`${t.id} model`}
                  value={tierDraft[t.id] ?? t.model}
                  onChange={(e) => setTierDraft((prev) => ({ ...prev, [t.id]: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  {!models.some((m) => m.model === (tierDraft[t.id] ?? t.model)) && (
                    <option value={tierDraft[t.id] ?? t.model}>{tierDraft[t.id] ?? t.model} (custom)</option>
                  )}
                  {models.map((m) => (
                    <option key={m.model} value={m.model}>
                      {m.model} · ${m.inputPer1M}/in ${m.outputPer1M}/out
                    </option>
                  ))}
                </select>
              </label>
              <p className="mono mt-1 text-[11px] text-zinc-500">
                live: ${t.inputPer1M ?? "—"}/in · ${t.outputPer1M ?? "—"}/out per 1M
              </p>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Model distribution, last 7 days" className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-1 text-lg font-semibold tracking-tight">Distribution · 7d</h2>
        {!hasTraffic ? (
          <p className="text-sm text-zinc-500">
            No routed traffic yet. Requests flowing through the proxy appear here within seconds — see the onboarding guide to connect an agent.
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {dayBars.map((d) => (
                <li key={d.day}>
                  <div className="mb-0.5 flex justify-between text-xs text-zinc-500">
                    <span className="mono">{d.day}</span>
                    <span className="mono">{d.total} req</span>
                  </div>
                  <div className="flex h-4 w-full overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-900" role="img" aria-label={`${d.day}: ${d.total} requests`}>
                    {d.slices.map((s, i) => (
                      <div
                        key={s.model}
                        title={`${s.model}: ${s.requests} req · $${s.spend.toFixed(4)}`}
                        style={{ width: `${d.total > 0 ? (s.requests / d.total) * 100 : 0}%`, background: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
              {(distribution?.byModel ?? []).map((s, i) => (
                <li key={s.model} title={`${s.requests} requests · $${s.spend.toFixed(4)} · ${s.tokens} tokens`}>
                  <span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span className="mono">{s.model}</span> — {(s.share * 100).toFixed(1)}% · <span className="mono">{s.requests}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {distribution && (
        <RoutingPanel
          distribution={distribution.byModel.map((s) => ({ model: s.model, share: s.share }))}
          wouldHaveSpent={distribution.summary.wouldHaveSpent}
          spent={distribution.summary.spent}
          qualityPerModel={[]}
          escalationRate={0}
          windowLabel="last 7d"
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section aria-label="Custom routing rules" className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-1 text-lg font-semibold tracking-tight">Custom rules</h2>
          <p className="mb-2 text-xs text-zinc-500">IF agent AND task THEN model · YAML · save hot-reloads (proxy sync pending).</p>
          <div className="relative">
            <pre
              aria-hidden="true"
              ref={yamlPreRef}
              dangerouslySetInnerHTML={highlightYaml(yaml || "\n")}
              className="mono pointer-events-none h-48 overflow-auto whitespace-pre rounded-md border border-zinc-300 bg-zinc-50 p-3 text-xs leading-5 dark:border-zinc-700 dark:bg-zinc-900"
            />
            <textarea
              aria-label="Routing rules YAML"
              value={yaml}
              onChange={(e) => {
                setYaml(e.target.value);
                setYamlDirty(true);
              }}
              onScroll={(e) => {
                const el = yamlPreRef.current;
                if (el) {
                  el.scrollTop = e.currentTarget.scrollTop;
                  el.scrollLeft = e.currentTarget.scrollLeft;
                }
              }}
              spellCheck={false}
              rows={10}
              className="mono absolute inset-0 h-48 w-full resize-none overflow-auto whitespace-pre rounded-md border border-transparent bg-transparent p-3 text-xs leading-5 text-transparent caret-zinc-900 selection:bg-indigo-200 dark:caret-zinc-100 dark:selection:bg-indigo-900"
            />
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void onSaveYaml()}
              disabled={savingYaml}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {savingYaml ? "Saving…" : "Save rules"}
            </button>
            <button
              type="button"
              onClick={() => {
                setYaml(rulesToYaml(rules));
                setYamlDirty(false);
              }}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            >
              Reset
            </button>
          </div>

          <h3 className="mb-2 mt-4 text-sm font-semibold">Rules ({rules.length})</h3>
          {rules.length === 0 ? (
            <p className="text-xs text-zinc-500">No custom rules yet — add one below, or paste YAML above. Empty agent/task acts as a wildcard.</p>
          ) : (
            <ul className="space-y-2">
              {rules.map((r) => (
                <li key={r.id} className="rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
                  {editingId === r.id ? (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs">Agent<input aria-label="Edit agent" value={editDraft.agentId} onChange={(e) => setEditDraft({ ...editDraft, agentId: e.target.value })} className="mono mt-0.5 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" /></label>
                      <label className="text-xs">Task<input aria-label="Edit task" value={editDraft.taskType} onChange={(e) => setEditDraft({ ...editDraft, taskType: e.target.value })} className="mono mt-0.5 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" /></label>
                      <label className="text-xs">Model<input aria-label="Edit model" value={editDraft.model} onChange={(e) => setEditDraft({ ...editDraft, model: e.target.value })} className="mono mt-0.5 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" /></label>
                      <label className="text-xs">Priority<input aria-label="Edit priority" type="number" value={editDraft.priority} onChange={(e) => setEditDraft({ ...editDraft, priority: Number(e.target.value) })} className="mono mt-0.5 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" /></label>
                      <div className="col-span-2 flex gap-2">
                        <button
                          type="button"
                          disabled={ruleBusy}
                          onClick={() => {
                            if (!editDraft.model.trim()) {
                              flash("err", "Rule model must not be empty.");
                              return;
                            }
                            setRuleBusy(true);
                            updateRule(r.id, { agentId: editDraft.agentId, taskType: editDraft.taskType, model: editDraft.model.trim(), tier: editDraft.tier, priority: editDraft.priority })
                              .then(() => {
                                setEditingId(null);
                                setYamlDirty(false);
                                flash("ok", "Rule updated ✓ · hot-reload on proxy sync.");
                              })
                              .catch((e: unknown) => flash("err", e instanceof Error ? e.message : "update failed"))
                              .finally(() => setRuleBusy(false));
                          }}
                          className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button type="button" onClick={() => setEditingId(null)} className="rounded-md border border-zinc-300 px-3 py-1 text-xs dark:border-zinc-700">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 text-xs">
                        <span className="font-medium">IF</span> <span className="mono">{r.agentId || "*"}</span> + <span className="mono">{r.taskType || "*"}</span>{" "}
                        <span className="font-medium">THEN</span> <span className="mono font-semibold">{r.model}</span>{" "}
                        <span className="text-zinc-500">(prio {r.priority})</span>
                      </p>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(r.id);
                            setEditDraft({ agentId: r.agentId, taskType: r.taskType, model: r.model, tier: r.tier, priority: r.priority });
                          }}
                          className="rounded border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!window.confirm(`Delete rule ${r.id}?`)) return;
                            deleteRule(r.id)
                              .then(() => {
                                setYamlDirty(false);
                                flash("ok", "Rule deleted ✓.");
                              })
                              .catch((e: unknown) => flash("err", e instanceof Error ? e.message : "delete failed"));
                          }}
                          className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 dark:border-red-900"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <h3 className="mb-2 mt-4 text-sm font-semibold">Add rule</h3>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">Agent (blank = any)<input aria-label="New rule agent" value={newDraft.agentId} onChange={(e) => setNewDraft({ ...newDraft, agentId: e.target.value })} placeholder="support_bot" className="mono mt-0.5 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" /></label>
            <label className="text-xs">Task (blank = any)<input aria-label="New rule task" value={newDraft.taskType} onChange={(e) => setNewDraft({ ...newDraft, taskType: e.target.value })} placeholder="faq" className="mono mt-0.5 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" /></label>
            <label className="text-xs">Model<input aria-label="New rule model" value={newDraft.model} onChange={(e) => setNewDraft({ ...newDraft, model: e.target.value })} placeholder="claude-3-5-haiku" className="mono mt-0.5 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" /></label>
            <label className="text-xs">Priority<input aria-label="New rule priority" type="number" value={newDraft.priority} onChange={(e) => setNewDraft({ ...newDraft, priority: Number(e.target.value) })} className="mono mt-0.5 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" /></label>
          </div>
          <button
            type="button"
            disabled={ruleBusy}
            onClick={() => {
              if (!newDraft.model.trim()) {
                flash("err", "Rule model must not be empty.");
                return;
              }
              setRuleBusy(true);
              createRule({ agentId: newDraft.agentId || undefined, taskType: newDraft.taskType || undefined, model: newDraft.model.trim(), priority: newDraft.priority })
                .then(() => {
                  setNewDraft({ agentId: "", taskType: "", model: "", tier: "", priority: 10 });
                  setYamlDirty(false);
                  flash("ok", "Rule added ✓ · hot-reload on proxy sync.");
                })
                .catch((e: unknown) => flash("err", e instanceof Error ? e.message : "create failed"))
                .finally(() => setRuleBusy(false));
            }}
            className="mt-2 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Add rule
          </button>
        </section>

        <section aria-label="Fallback chain" className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Fallback chain</h2>
            <button
              type="button"
              onClick={() => void onSaveFallback()}
              disabled={savingFallback}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {savingFallback ? "Saving…" : "Save order"}
            </button>
          </div>
          <p className="mb-2 text-xs text-zinc-500">
            Drag to reorder, or use ↑/↓ (keyboard + touch). {fallbackSource === "default" ? "Showing defaults — save to pin." : "Pinned order."}
          </p>
          <ol className="space-y-1.5">
            {order.map((m, i) => (
              <li
                key={`${m}-${i}`}
                draggable
                onDragStart={() => {
                  dragFrom.current = i;
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  const from = dragFrom.current;
                  dragFrom.current = null;
                  if (from === null || from === i) return;
                  setOrder((prev) => {
                    const next = [...prev];
                    const [moved] = next.splice(from, 1);
                    next.splice(i, 0, moved);
                    return next;
                  });
                }}
                className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
              >
                <span aria-hidden className="cursor-grab text-zinc-400">
                  ⠿
                </span>
                <span className="mono text-zinc-500">{i + 1}.</span>
                <span className="mono min-w-0 flex-1 truncate">{m}</span>
                <button type="button" aria-label={`Move ${m} up`} disabled={i === 0} onClick={() => moveFallback(i, -1)} className="rounded border border-zinc-300 px-1.5 text-xs disabled:opacity-40 dark:border-zinc-700">
                  ↑
                </button>
                <button type="button" aria-label={`Move ${m} down`} disabled={i === order.length - 1} onClick={() => moveFallback(i, 1)} className="rounded border border-zinc-300 px-1.5 text-xs disabled:opacity-40 dark:border-zinc-700">
                  ↓
                </button>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
