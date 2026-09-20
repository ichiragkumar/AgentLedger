"use client";

// Profile menu — account + preferences live here (theme, workspace, links,
// sign out). Avatar button sits top-right in the topbar; the sidebar no
// longer carries a separate avatar or theme toggle.

import Link from "next/link";
import { signOut } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, LogOut, Monitor, Moon, Sun, User } from "lucide-react";
import { useDashboardStore, type Workspace } from "@/lib/stores/dashboard.store";

type Theme = "light" | "dark" | "system";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const dark = theme === "dark" || (theme === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", !!dark);
  try {
    localStorage.setItem("al-theme", theme);
  } catch {
    /* private mode */
  }
}

export default function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const { workspaceId, workspaceName, theme, setWorkspace, setTheme } = useDashboardStore();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!cancelled) setEmail((s?.user?.email as string | undefined) ?? null);
      })
      .catch(() => {});
    fetch("/api/onboarding/workspace", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (cancelled) return;
        const list = (b?.workspaces ?? []) as Workspace[];
        setWorkspaces(list);
        if (!workspaceId && list.length > 0) setWorkspace(list[0].id, list[0].name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open ]);

  const pickTheme = useCallback(
    (t: Theme) => {
      setTheme(t);
      applyTheme(t);
    },
    [setTheme]
  );

  const initial = (email?.slice(0, 1) ?? "?").toUpperCase();
  const themes: { id: Theme; label: string; Icon: typeof Sun }[] = [
    { id: "light", label: "Light", Icon: Sun },
    { id: "dark", label: "Dark", Icon: Moon },
    { id: "system", label: "System", Icon: Monitor },
  ];

  return (
    <div ref={ref} className="relative ml-auto">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account and preferences"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white hover:bg-indigo-500"
      >
        {initial}
      </button>
      {open && (
        <div role="menu" aria-label="Account" className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-zinc-200 bg-white py-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center gap-2 px-3 pb-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
              {initial}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{email ?? "Signed in"}</p>
              <p className="truncate text-xs text-zinc-500">{workspaceName ?? "No workspace selected"}</p>
            </div>
          </div>

          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Workspace</p>
          <ul className="max-h-40 overflow-y-auto pb-1">
            {workspaces.length === 0 && <li className="px-3 py-1.5 text-sm text-zinc-500">No workspaces yet</li>}
            {workspaces.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={w.id === workspaceId}
                  onClick={() => {
                    setWorkspace(w.id, w.name);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className="w-4">{w.id === workspaceId && <Check size={14} aria-hidden />}</span>
                  <span className="truncate">{w.name}</span>
                </button>
              </li>
            ))}
          </ul>

          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Theme</p>
          <div role="group" aria-label="Theme" className="mx-3 mb-1 grid grid-cols-3 gap-1 rounded-lg border border-zinc-200 p-1 dark:border-zinc-700">
            {themes.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={theme === id}
                onClick={() => pickTheme(id)}
                className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium ${
                  theme === id ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                <Icon size={13} aria-hidden /> {label}
              </button>
            ))}
          </div>

          <div className="mt-1 border-t border-zinc-200 pt-1 dark:border-zinc-800">
            <Link href="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <User size={14} aria-hidden /> Settings
            </Link>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <LogOut size={14} aria-hidden /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
