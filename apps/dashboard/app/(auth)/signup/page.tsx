import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function SignupPage() {
  const session = await auth();
  if (session?.user) redirect("/overview");
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-5 px-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Create your workspace</h1>
        <p className="text-sm text-zinc-500">Sign in to start the 3-step onboarding.</p>
      </div>
      <Link
        href="/login"
        className="rounded-lg bg-indigo-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-indigo-500"
      >
        Continue to sign in
      </Link>
      <p className="text-xs text-zinc-500">GitHub OAuth and email onboarding land with your credentials (see .env.local).</p>
    </main>
  );
}
