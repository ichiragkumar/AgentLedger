import { cn } from "@/lib/utils";
import { Badge, type BadgeVariant } from "@/components/ui/badge";

// Brand primitive — owner: ledger-web-system (spec 18).
// Per-provider chip. Tokens only — no raw hex, no hardcoded brand colors.

const PROVIDER_TONES: Array<{ match: RegExp; variant: BadgeVariant }> = [
  { match: /gpt|openai|o1|o3/i, variant: "default" },
  { match: /claude|anthropic/i, variant: "warning" },
  { match: /gemini|gemma|palm/i, variant: "secondary" },
  { match: /llama|mistral|mixtral|qwen|deepseek/i, variant: "savings" },
];

export interface ModelChipProps {
  model: string;
  className?: string;
}

export default function ModelChip({ model, className }: ModelChipProps) {
  const tone = PROVIDER_TONES.find((p) => p.match.test(model))?.variant ?? "outline";
  return (
    <Badge variant={tone} className={cn("mono font-normal", className)} title={model}>
      {model}
    </Badge>
  );
}
