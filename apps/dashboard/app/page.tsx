import { redirect } from "next/navigation";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

// Dashboard root: the link between / and /overview.
// Logged in → app home. Logged out → login (which offers signup).
export default async function Root() {
  const session = await auth();
  redirect(session?.user ? "/overview" : "/login");
}
