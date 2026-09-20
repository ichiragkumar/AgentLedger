export type BreakdownRow = { key: string; spend: number; requests: number };

export default function BreakdownTable({ title, rows, emptyHint }: { title: string; rows: BreakdownRow[]; emptyHint: string }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">{emptyHint}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
              <th className="py-1 pr-2 font-medium">Name</th>
              <th className="py-1 pr-2 text-right font-medium">Spend</th>
              <th className="py-1 text-right font-medium">Requests</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-1 pr-2 font-mono text-xs">{r.key || "(untagged)"}</td>
                <td className="py-1 pr-2 text-right">${r.spend.toFixed(4)}</td>
                <td className="py-1 text-right">{r.requests}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
