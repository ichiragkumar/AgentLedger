// GET /api/routing/rules — custom routing rules (priority desc).
// POST /api/routing/rules {agentId?,taskType?,model,tier?,priority?} — create.
// Empty agentId/taskType act as wildcards (mirrors router.Engine.Matches).
// Zero-state safe: DB down → empty list, never 500.

import { randomBytes } from "node:crypto";
import { queryOrNull } from "@/lib/db";
import { ensureRoutingTables, getRules } from "../_lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const { rules, source } = await getRules();
  return Response.json({ rules, source });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_rule" }, { status: 400 });
  }
  const model = String(body.model ?? "").trim();
  if (!model || model.length > 120) return Response.json({ error: "invalid_rule" }, { status: 400 });
  const priority = body.priority === undefined ? 0 : Number(body.priority);
  if (!Number.isInteger(priority)) return Response.json({ error: "invalid_rule" }, { status: 400 });

  await ensureRoutingTables();
  const id = `r_${randomBytes(6).toString("hex")}`;
  const rows = await queryOrNull(
    `INSERT INTO routing_rules (id, agent_id, task_type, model, tier, priority, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,now()) RETURNING *`,
    [id, String(body.agentId ?? ""), String(body.taskType ?? ""), model, String(body.tier ?? ""), priority]
  );
  const r = (rows as Record<string, unknown>[] | null)?.[0];
  if (!r) return Response.json({ error: "unavailable" }, { status: 503 });
  return Response.json(
    {
      rule: {
        id: r.id,
        agentId: r.agent_id,
        taskType: r.task_type,
        model: r.model,
        tier: r.tier,
        priority: Number(r.priority),
        updatedAt: r.updated_at,
      },
      proxySynced: false,
      note: "rule persisted to dashboard DB; proxy hot-reload pending (see /WIRING.md)",
    },
    { status: 201 }
  );
}
