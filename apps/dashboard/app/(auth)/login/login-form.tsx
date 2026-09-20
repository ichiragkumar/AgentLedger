"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

// Default-filled DEV login. Credentials come from env (see .env.local:
// DEV_LOGIN_EMAIL / DEV_LOGIN_PASSWORD). Disabled in production unless
// ALLOW_DEV_LOGIN=true — the provider itself stays fail-closed.
export default function LoginForm() {
  return (
    <Suspense fallback={null}>
      <Form />
    </Suspense>
  );
}

function Form() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/overview";
  const [email, setEmail] = useState("admin@agentledger.local");
  const [password, setPassword] = useState("ledger-dev");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const res = await signIn("dev-login", { email, password, redirect: false, callbackUrl });
    if (res?.error) {
      setError("Invalid email or password (dev stub — check .env.local).");
      return;
    }
    window.location.href = res?.url ?? callbackUrl;
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-5 px-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Sign in to AgentLedger</h1>
        <p className="text-sm text-zinc-500">Local dev defaults are pre-filled.</p>
      </div>
      <button
        type="button"
        onClick={() => signIn("github", { callbackUrl })}
        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        Continue with GitHub
      </button>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="text-sm">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
          />
        </label>
        <label className="text-sm">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
          Sign in
        </button>
      </form>
      <p className="text-xs text-zinc-500">
        No account? <a className="underline" href="/signup">Sign up</a>
        {" · "}
        <a
          className="underline"
          href={process.env.NEXT_PUBLIC_WEB_URL ?? "http://localhost:3001/"}
        >
          Back to site
        </a>
      </p>
    </main>
  );
}
