"use client";

// Topbar — ledger-web-dashboard owner (spec 17 §Sidebar shell).
// Workspace dropdown (mock) + decorative search. No fetching:
// workspaces/search state lifts to dashboard.store + filter.store (backend).
// TODO(API): workspaces list via auth/session (ledger-web-backend).

import { useEffect, useState } from "react";
import ProfileMenu from "@/components/layout/profile-menu";
import { useDashboardStore, type Workspace } from "@/lib/stores/dashboard.store";

const FALLBACK_WORKSPACES = ["acme-prod", "acme-staging"];

export default function Topbar() {
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<string[]>(FALLBACK_WORKSPACES);
  const { workspaceName, setWorkspace } = useDashboardStore();
  const workspace = workspaceName ?? names[0];

  useEffect(() => {
    let cancelled = false;
    fetch("/api/onboarding/workspace", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (cancelled) return;
        const list = (b?.workspaces ?? []) as Workspace[];
        if (list.length > 0) {
          setNames(list.map((w) => w.name));
          if (!workspaceName) setWorkspace(list[0].id, list[0].name);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <header className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="relative">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium dark:border-zinc-700"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded bg-indigo-600 text-[10px] font-bold text-white">
            {workspace.slice(0, 1).toUpperCase()}
          </span>
          {workspace}
          <span aria-hidden>▾</span>
        </button>
        {open && (
          <ul role="listbox" aria-label="Workspace" className="absolute left-0 z-30 mt-1 w-48 rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {names.map((w) => (
              <li key={w}>
                <button
                  type="button"
                  role="option"
                  aria-selected={w === workspace}
                  onClick={() => {
                    setWorkspace(null, w);
                    setOpen(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {w}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="hidden min-w-0 flex-1 items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-500 sm:flex dark:border-zinc-700">
        <span aria-hidden>⌕</span>
        <input
          type="search"
          placeholder="Search agents, models, requests… (filter.store)"
          aria-label="Search dashboard"
          className="w-full bg-transparent outline-none placeholder:text-zinc-400"
        />
      </label>

      <span
        title="Live proxy status arrives via SSE (use-realtime, backend). Static mock."
        className="hidden items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 sm:inline-flex dark:bg-zinc-800 dark:text-zinc-300"
      >
        <span aria-hidden className="h-2 w-2 rounded-full bg-zinc-400" />
        Proxy: mock
      </span>

      <ProfileMenu />
    </header>
  );
}
