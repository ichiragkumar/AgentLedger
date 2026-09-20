import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = () =>
  pageMetadata({
    title: "Waitlist",
    description:
      "Join the AgentLedger waitlist for Pro and Enterprise early access. No card, no lock-in, OSS forever.",
    path: "/waitlist",
  });

export default function WaitlistLayout({ children }: { children: React.ReactNode }) {
  return children;
}
