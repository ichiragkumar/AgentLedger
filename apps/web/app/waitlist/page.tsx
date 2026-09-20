"use client";

/**
 * Waitlist capture page (owner: ledger-web-journey).
 * No auth. POSTs to the co-located `./route.ts` stub; backend wires
 * persistent storage (Postgres) when ready — see integration note below.
 */

import { useState } from "react";

type Status = "idle" | "sending" | "success" | "error";

export default function WaitlistPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setMessage("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Signup failed");
      setStatus("success");
      setMessage("You're on the list. We'll email you when your phase ships.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-16">
      <a href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← AgentLedger
      </a>
      <h1 className="mt-4 text-3xl font-bold tracking-tight text-balance">
        Stop guessing. Start seeing.
      </h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Join the waitlist for Pro and Enterprise early access. No card, no lock-in, OSS forever.
      </p>
      {status === "success" ? (
        <p role="status" className="mt-6 rounded-xl border border-green-500/40 bg-green-50 p-4 text-sm dark:bg-green-950/30">
          {message}
        </p>
      ) : (
        <form onSubmit={submit} className="mt-6 flex flex-col gap-3 sm:flex-row">
          <label htmlFor="waitlist-email" className="sr-only">
            Email address
          </label>
          <input
            id="waitlist-email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded-full border border-zinc-300 px-5 py-2.5 text-sm focus:border-green-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            disabled={status === "sending"}
            className="rounded-full bg-green-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
          >
            {status === "sending" ? "Joining…" : "Join waitlist"}
          </button>
        </form>
      )}
      {status === "error" && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {message}
        </p>
      )}
    </main>
  );
}
