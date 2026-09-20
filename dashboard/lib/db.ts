import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import path from "node:path";

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://agentledger:agentledger@localhost:5432/agentledger?sslmode=disable";

export const pool = new Pool({ connectionString, max: 5 });

const SCHEMA_FILES = [
  "../db/schema.sql",
  "../db/migrations/001_mirror_hardening.sql",
  "../db/migrations/002_budgets.sql",
  "../db/migrations/003_brain.sql",
];

let ensured: Promise<void> | null = null;

/** Apply repo SQL files idempotently (all use IF NOT EXISTS / guards). Best-effort: logs and continues on failure. */
export function ensureSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      for (const rel of SCHEMA_FILES) {
        try {
          const sql = await readFile(path.join(process.cwd(), rel), "utf8");
          await pool.query(sql);
        } catch (err) {
          console.warn(`[db] schema file ${rel} skipped:`, (err as Error).message);
        }
      }
    })();
  }
  return ensured;
}

/** Run a query, returning null when Postgres is unreachable (panels render zero-state). */
export async function queryOrNull<T>(text: string, params: unknown[] = []): Promise<T[] | null> {
  try {
    await ensureSchema();
    const res = await pool.query(text, params as unknown[]);
    return res.rows as T[];
  } catch (err) {
    console.warn("[db] query failed, zero-state:", (err as Error).message);
    return null;
  }
}
