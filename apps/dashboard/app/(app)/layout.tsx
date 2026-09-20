// Authenticated app shell — ledger-web-dashboard owner (spec 17).
// Route-group layout: wraps (app)/* pages with sidebar + topbar + breadcrumb.
// Auth/middleware itself is ledger-web-backend (do NOT add here).

import Sidebar from "@/components/layout/sidebar";
import Topbar from "@/components/layout/topbar";
import Breadcrumb from "@/components/layout/breadcrumb";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <Breadcrumb />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
