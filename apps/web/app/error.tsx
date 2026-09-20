"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Branded 500 (F5 ship plumbing, owner: ledger-finish-proof).
 * Spec-18 tokens only. `reset` retries the segment.
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
    console.error("web segment error:", error);
  }, [error]);

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center bg-background px-6 py-24 text-center">
      <p className="font-mono text-sm tabular-nums text-muted-foreground">
        500 · something broke
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
        The ledger hiccuped
      </h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
        This page failed to render. Try again, or head home — nothing was
        charged for this error.
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
          href="/"
          className="rounded-[var(--radius)] border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground hover:bg-secondary"
        >
          Go home
        </Link>
        <Link
          href="/docs"
          className="rounded-[var(--radius)] px-4 py-2 text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
        >
          Docs
        </Link>
      </div>
    </main>
  );
}
