import { randomBytes } from "node:crypto";
import { queryOrNull } from "@/lib/db";
import { ensureAppTables } from "../../_lib/ensure";

export const dynamic = "force-dynamic";

type Workspace = { id: string; name: string; created_at: string };

// Onboarding step 1: workspace create/select. Public by design (pre-auth).
// GET /api/onboarding/workspace — list (empty when DB down: zero-state).
export async function GET() {
  await ensureAppTables();
  const rows = await queryOrNull<Workspace>(`SELECT id, name, created_at FROM workspaces ORDER BY created_at LIMIT 50`);
  return Response.json({ workspaces: rows ?? [] });
}

// POST /api/onboarding/workspace {name} — idempotent on name.
export async function POST(req: Request) {
  let body: { name?: string };
  try {
    body = (await req.json()) as { name?: string };
  } catch {
    return Response.json({ error: "invalid_workspace" }, { status: 400 });
  }
  const name = (body.name ?? "").trim().slice(0, 80);
  if (!name) return Response.json({ error: "missing_name" }, { status: 400 });

  await ensureAppTables();
  const rows = await queryOrNull<Workspace>(
    `INSERT INTO workspaces (id, name) VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING
     RETURNING id, name, created_at`,
    [`ws_${randomBytes(6).toString("hex")}`, name]
  );
  if (!rows?.[0]) {
    // Name retry path: surface existing workspace with the same name.
    const existing = await queryOrNull<Workspace>(`SELECT id, name, created_at FROM workspaces WHERE name = $1 LIMIT 1`, [
      name,
    ]);
    if (existing?.[0]) return Response.json({ workspace: existing[0], reused: true });
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  return Response.json({ workspace: rows[0] }, { status: 201 });
}
