const ITEMS = [
  "1,200+ GitHub Stars",
  "400+ Agents Connected",
  "40–70% Spend Reduction",
  "Sub-ms Proxy Overhead",
  "Apache 2.0 Open Source",
  "Self-Hosted, Data Never Leaves",
];

export default function SocialProofBar() {
  const row = [...ITEMS, ...ITEMS];
  return (
    <section aria-label="Social proof" className="border-y border-zinc-200 dark:border-zinc-800">
      <div className="group relative overflow-hidden py-3.5">
        <div className="flex w-max animate-[ticker_28s_linear_infinite] gap-10 group-hover:[animation-play-state:paused]">
          {row.map((item, i) => (
            <span
              key={i}
              aria-hidden={i >= ITEMS.length}
              className="flex shrink-0 items-center gap-10 text-sm font-medium whitespace-nowrap text-zinc-500 dark:text-zinc-400"
            >
              <span className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="text-amber-500">
                  <path d="M12 2l2.9 6.26 6.6.56-5 4.36 1.5 6.45L12 16.9 5.99 19.63l1.5-6.45-5-4.36 6.6-.56L12 2z" />
                </svg>
                {item}
              </span>
              <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">·</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
