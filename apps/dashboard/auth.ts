import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";

// NextAuth v5 (Auth.js) — GitHub first, email stub second, SSO stub for Phase 6.
//
// Edge-safe: no node:* imports (this module also runs in proxy.ts).
// Secrets live in env only (see REQUIRED_ENV in the return message) and are
// never logged. Provider keys are NEVER requested, stored, or returned here.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  // All sign-in flows land on our custom /login (which itself redirects
  // logged-in users to /overview). The built-in Auth.js signin page — which
  // would list every stub provider — is never shown.
  pages: { signIn: "/login" },
  providers: [
    GitHub,
    // Dev login (LOCAL ONLY, never production): email+password from env,
    // gated behind ALLOW_DEV_LOGIN=true. Defaults are documented in
    // .env.local.example — change them, this is a stub, not a user DB.
    Credentials({
      id: "dev-login",
      name: "Dev login",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        if (process.env.ALLOW_DEV_LOGIN !== "true") return null;
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        const wantEmail = (process.env.DEV_LOGIN_EMAIL ?? "admin@agentledger.local").toLowerCase();
        const wantPass = process.env.DEV_LOGIN_PASSWORD ?? "ledger-dev";
        if (!EMAIL_RE.test(email) || email !== wantEmail || password !== wantPass) return null;
        return { id: `dev:${email}`, email };
      },
    }),
    // Email stub: dev-only passwordless stand-in until a real Email provider
    // (SMTP) lands. Gated behind ALLOW_EMAIL_STUB_DEV=true; fail-closed
    // otherwise. Issues a session for any well-formed email — never a secret.
    Credentials({
      id: "email-stub",
      name: "Email (dev stub)",
      credentials: { email: { label: "Email", type: "email" } },
      authorize: async (credentials) => {
        if (process.env.ALLOW_EMAIL_STUB_DEV !== "true") return null;
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        if (!EMAIL_RE.test(email)) return null;
        return { id: `email:${email}`, email };
      },
    }),
    // SSO stub (Phase 6, spec 09): visible but always denies until an OIDC
    // provider is wired. Fail-closed by construction.
    Credentials({
      id: "sso-stub",
      name: "SSO (Phase 6)",
      credentials: {},
      authorize: async () => null,
    }),
  ],
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
