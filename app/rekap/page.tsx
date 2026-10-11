import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BarList } from "@/app/bar-list";
import { Nav } from "@/app/nav";
import { formatMonth } from "@/lib/dates";
import { getAllTimeByCategory, getMonthlyTotalsByOwner } from "@/lib/expenses";
import { formatRupiah } from "@/lib/format";
import { UNASSIGNED, visiblePeople } from "@/lib/people";
import { requireViewer } from "@/lib/session";

export const metadata: Metadata = { title: "Rekap · MyCashflow" };

export default function RekapPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Rekap</h1>
        <Nav current="/rekap" />
      </header>
      <Suspense
        fallback={<p className="mt-6 text-(--text-secondary)">Memuat data…</p>}
      >
        <Rekap />
      </Suspense>
    </main>
  );
}

async function Rekap() {
  const viewer = await requireViewer();
  const [cells, byCategory] = await Promise.all([
    getMonthlyTotalsByOwner(viewer),
    getAllTimeByCategory(viewer),
  ]);

  if (cells.length === 0) {
    return (
      <p className="card mt-6 p-8 text-center text-(--text-secondary)">
        Belum ada pengeluaran yang tercatat.
      </p>
    );
  }

  // Only show the "not picked yet" column while something is still unassigned.
  const owners = [
    ...visiblePeople(viewer),
    ...(cells.some((cell) => cell.owner === null) ? [UNASSIGNED] : []),
  ];
  const ownerTotals = new Map<string, number>();
  const months = new Map<
    string,
    { total: number; count: number; byOwner: Map<string, number> }
  >();
  for (const cell of cells) {
    const owner = cell.owner ?? UNASSIGNED;
    const month = months.get(cell.month) ?? {
      total: 0,
      count: 0,
      byOwner: new Map<string, number>(),
    };
    month.total += cell.total;
    month.count += cell.count;
    month.byOwner.set(owner, cell.total);
    months.set(cell.month, month);
    ownerTotals.set(owner, (ownerTotals.get(owner) ?? 0) + cell.total);
  }

  const monthRows = [...months];
  const total = monthRows.reduce((sum, [, m]) => sum + m.total, 0);
  const count = monthRows.reduce((sum, [, m]) => sum + m.count, 0);

  return (
    <>
      <section className="mt-6 grid gap-4 sm:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="card p-5">
          <div className="text-sm text-(--text-secondary)">
            Total keseluruhan
          </div>
          <div className="mt-1 text-4xl font-semibold sm:text-5xl">
            {formatRupiah(total)}
          </div>
        </div>
        <Stat label="Transaksi" value={String(count)} />
        <Stat label="Bulan tercatat" value={String(monthRows.length)} />
        <Stat
          label="Rata-rata per bulan"
          value={formatRupiah(Math.round(total / monthRows.length))}
        />
      </section>

      <section className="card mt-4 overflow-x-auto">
        <h2 className="px-5 pt-5 text-sm font-medium">Rekap per bulan</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-(--text-muted)">
            <tr className="border-b border-(--grid)">
              <th className="px-5 py-2 font-normal">Bulan</th>
              {owners.map((owner) => (
                <th key={owner} className="px-2 py-2 text-right font-normal">
                  {owner}
                </th>
              ))}
              <th className="px-5 py-2 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody>
            {monthRows.map(([month, m]) => (
              <tr key={month} className="border-b border-(--grid)">
                <td className="px-5 py-3 whitespace-nowrap">
                  <Link
                    href={`/?m=${month}`}
                    className="underline decoration-(--axis) underline-offset-4 hover:decoration-(--series-1)"
                  >
                    {formatMonth(month)}
                  </Link>
                  <div className="text-xs text-(--text-muted)">
                    {m.count} transaksi
                  </div>
                </td>
                {owners.map((owner) => (
                  <td
                    key={owner}
                    className="px-2 py-3 text-right whitespace-nowrap text-(--text-secondary) tabular-nums"
                  >
                    {formatRupiah(m.byOwner.get(owner) ?? 0)}
                  </td>
                ))}
                <td className="px-5 py-3 text-right font-medium whitespace-nowrap tabular-nums">
                  {formatRupiah(m.total)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td className="px-5 py-3">Keseluruhan</td>
              {owners.map((owner) => (
                <td
                  key={owner}
                  className="px-2 py-3 text-right whitespace-nowrap tabular-nums"
                >
                  {formatRupiah(ownerTotals.get(owner) ?? 0)}
                </td>
              ))}
              <td className="px-5 py-3 text-right whitespace-nowrap tabular-nums">
                {formatRupiah(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="text-sm font-medium">Per orang, keseluruhan</h2>
          <BarList
            items={owners
              .map((owner) => ({
                label: owner,
                total: ownerTotals.get(owner) ?? 0,
              }))
              .sort((a, b) => b.total - a.total)}
          />
        </div>
        <div className="card p-5">
          <h2 className="text-sm font-medium">Per kategori, keseluruhan</h2>
          <BarList
            items={byCategory.map((c) => ({
              label: c.category,
              total: c.total,
            }))}
          />
        </div>
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-5">
      <div className="text-sm text-(--text-secondary)">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}
