import type { Metadata } from "next";
import { mono, sans } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentLedger — AI spend, explained",
  description: "One proxy. Full visibility. 40–70% less spend. The open-source TokenOps control plane.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
    // attributes like data-gr-ext-installed into <body> before React hydrates.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
