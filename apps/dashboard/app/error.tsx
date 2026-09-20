"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Branded 500 (F5 ship plumbing, owner: ledger-finish-proof).
 * Spec-18 tokens only. Links: /overview + docs. `reset` retries the segment.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("dashboard segment error:", error);
  }, [error]);

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center bg-background px-6 py-24 text-center">
      <p className="font-mono text-sm tabular-nums text-muted-foreground">
        500 · something broke
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-foreground">
        This view failed to load
      </h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
        Your spend data is safe — this is a rendering error, not a metering
        error. Try again, or head back to your overview.
        {error.digest ? (
          <span className="mt-2 block font-mono text-xs tabular-nums">
            ref: {error.digest}
          </span>
        ) : null}
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={reset}
          className="rounded-[var(--radius)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Try again
        </button>
        <Link
          href="/overview"
          className="rounded-[var(--radius)] border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground hover:bg-secondary"
        >
          Back to overview
        </Link>
        <a
          href="https://agentledger.io/docs"
          className="rounded-[var(--radius)] px-4 py-2 text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
        >
          Docs
        </a>
      </div>
    </main>
  );
}
