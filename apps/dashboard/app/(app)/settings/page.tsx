// Settings page — ledger-web-dashboard owner (spec 17 §Settings).
// Async Server Component, mock controls. Reuses ThemeToggle.
// Auth/workspace members, onboarding replay target, purge/reset mutations = backend.
// TODO(API): workspace + defaults from settings API; danger-zone via management plane.

import Link from "next/link";
import ThemeToggle from "@/components/theme-toggle";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-zinc-500">Workspace, theme, defaults, danger zone.</p>
      </header>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Workspace</h2>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Workspace name</span>
          <input defaultValue="acme-prod" aria-label="Workspace name" className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
        <p className="mt-2 text-xs text-zinc-500">Members management deferred — lands with auth (backend).</p>
        <Link href="/onboarding" title="Replay the 3-step onboarding (workspace → key → connection test)" className="mt-2 inline-block text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          Replay onboarding →
        </Link>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Appearance</h2>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Theme (localStorage + prefers-color-scheme init)</span>
          <ThemeToggle />
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Defaults</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Default TTL (seconds)</span>
            <input type="number" defaultValue={3600} aria-label="Default TTL seconds" className="w-full rounded-md border border-zinc-300 px-3 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Semantic threshold</span>
            <input type="number" step={0.01} min={0.8} max={0.99} defaultValue={0.92} aria-label="Semantic threshold" className="w-full rounded-md border border-zinc-300 px-3 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-red-300 bg-white p-5 dark:border-red-900 dark:bg-zinc-950">
        <h2 className="mb-1 text-lg font-semibold tracking-tight text-red-600">Danger zone</h2>
        <p className="mb-3 text-xs text-zinc-500">Both actions require confirmation and land with the management plane.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" title="Purge cache (mock — backend purge)" className="rounded-md border border-red-300 px-4 py-1.5 text-sm text-red-600 dark:border-red-900">
            Purge cache…
          </button>
          <button type="button" title="Reset demo data (mock — backend reset)" className="rounded-md border border-red-300 px-4 py-1.5 text-sm text-red-600 dark:border-red-900">
            Reset demo data…
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Resources</h2>
        <ul className="flex gap-4 text-sm text-indigo-600 dark:text-indigo-400">
          <li><a href="#" className="hover:underline">Docs</a></li>
          <li><a href="#" className="hover:underline">Changelog</a></li>
        </ul>
      </section>
    </div>
  );
}
