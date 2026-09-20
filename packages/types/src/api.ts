export type ApiError = { error: string; message: string };

export type Paginated<T> = { rows: T[]; total: number; page: number; pageSize: number };

// --- Additive (ledger-web-system): shared handler/client shapes. ---

/** GET /health (Go proxy) + dashboard /api/health conform to this. */
export type HealthResponse = { ok: boolean; service: "proxy" | "dashboard"; ts: string };

/** Common spend query params for /api/spend + /api/requests. */
export type SpendQuery = {
  range?: "24h" | "7d" | "30d";
  agent?: string;
  team?: string;
  model?: string;
  page?: number;
  pageSize?: number;
};
