"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const TOTAL_BUDGET_MS = 2600;

export default function Typewriter({
  lines,
  copyText,
  className,
  startDelayMs = 600,
}: {
  lines: string[];
  copyText?: string;
  className?: string;
  startDelayMs?: number;
}) {
  const [doneChars, setDoneChars] = useState(0);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const full = lines.join("\n");
  const total = full.length;

  useEffect(() => {
    if (total === 0) return;
    const perChar = Math.max(8, Math.floor((TOTAL_BUDGET_MS - startDelayMs) / total));
    let count = 0;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    timeout = setTimeout(() => {
      timer.current = setInterval(() => {
        count += 1;
        setDoneChars(count);
        if (count >= total && timer.current) {
          clearInterval(timer.current);
          timer.current = null;
        }
      }, perChar);
    }, startDelayMs);
    return () => {
      if (timeout) clearTimeout(timeout);
      if (timer.current) clearInterval(timer.current);
    };
  }, [total, startDelayMs]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const visible = full.slice(0, doneChars);
  const visibleLines = visible.split("\n");

  async function copy() {
    const text = copyText ?? full;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
  }

  return (
    <div className={cn("relative", className)}>
      <div
        aria-label={full}
        role="status"
        className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[13px] leading-6"
      >
        {visibleLines.map((line, i) => (
          <div key={i} className="min-h-6">
            <span>{line}</span>
            {i === visibleLines.length - 1 && doneChars < total && (
              <span aria-hidden="true" className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 animate-pulse bg-emerald-400" />
            )}
          </div>
        ))}
        <span className="sr-only">{full}</span>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy install command"}
        className="absolute right-2 top-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700 hover:text-white"
      >
        {copied ? (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Copied
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copy
          </>
        )}
      </button>
    </div>
  );
}
