import { formatRupiah } from "@/lib/format";

/** Labelled horizontal bars, expected sorted largest first. */
export function BarList({
  items,
}: {
  items: { label: string; total: number }[];
}) {
  const max = items[0]?.total ?? 0;
  const sum = items.reduce((acc, item) => acc + item.total, 0);

  return (
    <ul className="mt-4 space-y-3">
      {items.map((item) => (
        <li key={item.label}>
          <div className="flex justify-between gap-3 text-sm">
            <span>{item.label}</span>
            <span className="text-(--text-secondary) tabular-nums">
              {formatRupiah(item.total)}
            </span>
          </div>
          <div
            className="mt-1 h-2 rounded-r-sm bg-(--series-1)"
            style={{
              width: `${item.total > 0 ? Math.max(1, (item.total / max) * 100) : 0}%`,
            }}
            title={`${sum > 0 ? Math.round((item.total / sum) * 100) : 0}% dari total`}
          />
        </li>
      ))}
    </ul>
  );
}
