import { create } from "zustand";

export type Workspace = { id: string; name: string; created_at: string };

type DashboardState = {
  workspaceId: string | null;
  workspaceName: string | null;
  theme: "light" | "dark" | "system";
  sidebarCollapsed: boolean;
  setWorkspace: (id: string | null, name: string | null) => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
};

/**
 * Dashboard shell state: workspace + theme + sidebar.
 * In-memory only (no persist middleware): theme is applied by the existing
 * ThemeToggle/localStorage script, so this store never fights hydration.
 */
export const useDashboardStore = create<DashboardState>()((set) => ({
  workspaceId: null,
  workspaceName: null,
  theme: "system",
  sidebarCollapsed: false,
  setWorkspace: (workspaceId, workspaceName) => set({ workspaceId, workspaceName }),
  setTheme: (theme) => set({ theme }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
}));
