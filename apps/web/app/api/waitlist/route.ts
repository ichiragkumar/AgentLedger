/**
 * Waitlist capture stub — `POST /api/waitlist` (owner: ledger-web-journey).
 *
 * HANDOFF NOTE (ledger-web-backend): this stub is additive and yours to
 * adopt — replace the in-memory Set with Postgres persistence (idempotent
 * by email) + rate limiting. Until then the waitlist form works end to end.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// In-memory stub — lost on restart. Backend replaces with Postgres.
const EMAILS = new Set<string>();

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const email =
    typeof body === "object" && body !== null
      ? String((body as Record<string, unknown>).email ?? "").trim().toLowerCase()
      : "";
  if (!EMAIL_RE.test(email)) {
    return Response.json({ ok: false, error: "Please enter a valid email address." }, { status: 400 });
  }
  EMAILS.add(email);
  return Response.json({ ok: true });
}
