// GET /api/routing/tiers — tier → model map with live registry prices.
// PUT /api/routing/tiers {tiers:[{id,model}]} — rebind tiers (dashboard
// system-of-record; proxy sync is a coordinator step, see /WIRING.md).
// Zero-state safe: DB down → compiled spec-17 defaults, never 500.

import { getTiers, REGISTRY_MODELS, REGISTRY_RATES, saveTiers, TIER_ORDER } from "../_lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const { tiers, source, updatedAt } = await getTiers();
  return Response.json({
    tiers,
    models: REGISTRY_MODELS.map((m) => ({ model: m, ...REGISTRY_RATES[m] })),
    source,
    updatedAt,
  });
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_tiers" }, { status: 400 });
  }
  const items = (body as { tiers?: unknown }).tiers;
  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ error: "invalid_tiers" }, { status: 400 });
  }
  const clean: { id: string; model: string }[] = [];
  for (const t of items as { id?: unknown; model?: unknown }[]) {
    const id = String(t.id ?? "");
    const model = String(t.model ?? "").trim();
    if (!(TIER_ORDER as string[]).includes(id) || !model || model.length > 120) {
      return Response.json({ error: "invalid_tiers" }, { status: 400 });
    }
    clean.push({ id, model });
  }
  const tiers = await saveTiers(clean);
  if (!tiers) return Response.json({ error: "unavailable" }, { status: 503 });
  return Response.json({
    tiers,
    // No proxy /v1/routing mgmt endpoint yet — durable write won; the proxy
    // picks this up via the WIRING.md reload step (coordinator).
    proxySynced: false,
    note: "tiers persisted to dashboard DB; proxy reload pending (see /WIRING.md)",
  });
}
