// Money + usage formatting shared by web + dashboard.
// Owner: ledger-web-system. Always pair money output with `.mono`.

/** $1,234.56 / −$12.30 (minus sign, never parentheses). */
export function formatUSD(amount: number): string {
  const sign = amount < 0 ? "−" : "";
  const abs = Math.abs(amount);
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Compact axis/legend form: $1.2k, $3.4M. */
export function formatUSDCompact(amount: number): string {
  const sign = amount < 0 ? "−" : "";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(abs >= 100 ? 0 : 2)}`;
}

/** 1.5M / 12.3k token counts. */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${tokens}`;
}

/** 0.42 → "42.0%". */
export function formatPct(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}
