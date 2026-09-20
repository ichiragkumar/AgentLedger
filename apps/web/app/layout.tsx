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
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
