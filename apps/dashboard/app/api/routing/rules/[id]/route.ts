// PUT /api/routing/rules?id= — update a rule (partial).
// DELETE /api/routing/rules?id= — delete a rule.

import { queryOrNull } from "@/lib/db";
import { ensureRoutingTables } from "../../_lib/db";

export const dynamic = "force-dynamic";

const toRule = (r: Record<string, unknown>) => ({
  id: r.id,
  agentId: r.agent_id,
  taskType: r.task_type,
  model: r.model,
  tier: r.tier,
  priority: Number(r.priority),
  updatedAt: r.updated_at,
});

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_rule" }, { status: 400 });
  }
  if (body.model !== undefined) {
    const m = String(body.model).trim();
    if (!m || m.length > 120) return Response.json({ error: "invalid_rule" }, { status: 400 });
  }
  if (body.priority !== undefined && !Number.isInteger(Number(body.priority))) {
    return Response.json({ error: "invalid_rule" }, { status: 400 });
  }

  await ensureRoutingTables();
  const rows = await queryOrNull(
    `UPDATE routing_rules SET
       agent_id = COALESCE($2, agent_id),
       task_type = COALESCE($3, task_type),
       model = COALESCE($4, model),
       tier = COALESCE($5, tier),
       priority = COALESCE($6, priority),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      id,
      body.agentId === undefined ? null : String(body.agentId),
      body.taskType === undefined ? null : String(body.taskType),
      body.model === undefined ? null : String(body.model).trim(),
      body.tier === undefined ? null : String(body.tier),
      body.priority === undefined ? null : Number(body.priority),
    ]
  );
  const r = (rows as Record<string, unknown>[] | null)?.[0];
  if (!r) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ rule: toRule(r), proxySynced: false });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });
  await ensureRoutingTables();
  const rows = await queryOrNull(`DELETE FROM routing_rules WHERE id = $1 RETURNING id`, [id]);
  if (!(rows as { id: string }[] | null)?.[0]) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ deleted: id, proxySynced: false });
}
