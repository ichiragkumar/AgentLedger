import { Inter, JetBrains_Mono } from "next/font/google";

// Brand type: Inter (sans) + JetBrains Mono (money/code).
// Owner: ledger-web-system. Import in app/layout.tsx and attach
// `sans.variable` + `mono.variable` to <html> — globals.css maps
// --font-sans/--font-mono into Tailwind, `.mono` uses the mono var.

export const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});
