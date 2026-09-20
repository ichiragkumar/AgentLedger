import { redirect } from "next/navigation";
import { auth } from "@/auth";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

// Logged-in users never see the form — straight to the app home.
export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/overview");
  return <LoginForm />;
}
