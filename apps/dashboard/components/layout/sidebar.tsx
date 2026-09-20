"use client";

// Sidebar — ledger-web-dashboard owner (spec 17 §Sidebar).
// Sections MONITOR / OPTIMIZE / CONTROL / ADVANCED + Coming badges,
// collapsible icon-only, mobile overlay + outside-click close, Tab/Enter
// via native links, auto-collapse <1024px.
// TODO(store): lift collapsed/mobileOpen into dashboard.store (backend owner).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

type NavItem = { href: string; label: string; badge?: string };
type NavSection = { title: string; items: NavItem[] };

const SECTIONS: NavSection[] = [
  {
    title: "MONITOR",
    items: [
      { href: "/overview", label: "Overview" },
      { href: "/agents", label: "Agents" },
      { href: "/requests", label: "Requests" },
    ],
  },
  {
    title: "OPTIMIZE",
    items: [
      { href: "/cache", label: "Cache" },
      { href: "/routing", label: "Routing" },
    ],
  },
  {
    title: "CONTROL",
    items: [
      { href: "/budgets", label: "Budgets" },
      { href: "/policies", label: "Policies" },
      { href: "/keys", label: "Keys" },
    ],
  },
  {
    title: "ADVANCED",
    items: [{ href: "/topology", label: "Topology", badge: "Phase 5" }],
  },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setCollapsed(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const width = collapsed ? "lg:w-16" : "lg:w-60";

  return (
    <>
      {/* Mobile hamburger (drawer state lives here until dashboard.store lands). */}
      <button
        type="button"
        aria-label="Open navigation"
        onClick={() => setMobileOpen(true)}
        className="fixed bottom-4 left-4 z-40 inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium shadow-lg lg:hidden dark:border-zinc-700 dark:bg-zinc-950"
      >
        <Menu size={16} aria-hidden /> Menu
      </button>

      {/* Mobile overlay: outside-click close. */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      )}

      <aside
        aria-label="Dashboard navigation"
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-zinc-200 bg-white transition-transform dark:border-zinc-800 dark:bg-zinc-950 ${mobileOpen ? "translate-x-0" : "-translate-x-full"} lg:static lg:translate-x-0 ${width}`}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-4 dark:border-zinc-800">
          <Link href="/overview" className="font-bold tracking-tight">
            {collapsed ? <span className="hidden lg:inline">AL</span> : "AgentLedger"}
            <span className="lg:hidden">AgentLedger</span>
          </Link>
          <button
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed((c) => !c)}
            className="hidden rounded-md border border-zinc-300 px-2 py-1 text-xs lg:inline-block dark:border-zinc-700"
          >
            {collapsed ? "»" : "«"}
          </button>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs lg:hidden dark:border-zinc-700"
          >
            <X size={14} aria-hidden />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {SECTIONS.map((section) => (
            <div key={section.title} className="mb-4">
              {!collapsed && (
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                  {section.title}
                </p>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        title={item.label}
                        className={`flex items-center gap-2 rounded-md border-l-2 px-2 py-2 text-sm transition-colors ${
                          active
                            ? "border-indigo-600 bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                            : "border-transparent text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                        }`}
                      >
                        <span
                          aria-hidden
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-zinc-100 text-xs font-bold dark:bg-zinc-800"
                        >
                          {item.label.slice(0, 1)}
                        </span>
                        <span className={`${collapsed ? "hidden lg:hidden" : ""} truncate`}>{item.label}</span>
                        {item.badge && !collapsed && (
                          <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-zinc-200 px-2 py-3 dark:border-zinc-800">
          <ul className="space-y-0.5">
            <li>
              <Link
                href="/settings"
                className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded bg-zinc-100 text-xs font-bold dark:bg-zinc-800">
                  S
                </span>
                {!collapsed && "Settings"}
              </Link>
            </li>
            {!collapsed && (
              <>
                <li>
                  <a href="#" className="block rounded-md px-2 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                    Docs
                  </a>
                </li>
                <li>
                  <a href="#" className="block rounded-md px-2 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                    Changelog
                  </a>
                </li>
              </>
            )}
          </ul>
          {/* Account + preferences (theme, workspace, sign out) live in the
              profile menu, top-right in the topbar. */}
          {!collapsed && (
            <p className="mt-2 px-2 text-[11px] text-zinc-400">v0.1.0 · Apache 2.0</p>
          )}
        </div>
      </aside>
    </>
  );
}
