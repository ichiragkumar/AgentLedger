// GET /api/routing/fallback — ordered fallback chain (try order).
// PUT /api/routing/fallback {chain:[model,...]} — reorder/replace.
// Zero-state safe: DB down → seeded default chain, never 500.

import { getFallback, saveFallback } from "../_lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const { chain, source, updatedAt } = await getFallback();
  return Response.json({ chain, source, updatedAt });
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_chain" }, { status: 400 });
  }
  const raw = (body as { chain?: unknown }).chain;
  if (!Array.isArray(raw) || raw.length === 0) {
    return Response.json({ error: "invalid_chain" }, { status: 400 });
  }
  const seen = new Set<string>();
  const chain: string[] = [];
  for (const m of raw) {
    if (typeof m !== "string") return Response.json({ error: "invalid_chain" }, { status: 400 });
    const t = m.trim();
    if (!t || t.length > 120) return Response.json({ error: "invalid_chain" }, { status: 400 });
    const k = t.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      chain.push(t);
    }
  }
  const saved = await saveFallback(chain);
  if (!saved) return Response.json({ error: "unavailable" }, { status: 503 });
  return Response.json({
    chain: saved,
    proxySynced: false,
    note: "fallback persisted to dashboard DB; proxy reload pending (see /WIRING.md)",
  });
}
