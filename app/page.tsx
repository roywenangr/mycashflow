import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { changeOwner, changeWallet, removeExpense } from "@/app/actions";
import { BarList } from "@/app/bar-list";
import { DailyChart } from "@/app/daily-chart";
import { InlineSelect } from "@/app/inline-select";
import { Nav } from "@/app/nav";
import {
  currentMonth,
  daysInMonth,
  formatDay,
  formatMonth,
  isMonth,
  monthRange,
  shiftMonth,
  today,
} from "@/lib/dates";
import {
  getMonthByCategory,
  getMonthByDay,
  getMonthByOwner,
  getMonthByWallet,
  getMonthExpenses,
  type WalletFilter,
  getTotal,
} from "@/lib/expenses";
import { formatRupiah } from "@/lib/format";
import { UNASSIGNED, visiblePeople } from "@/lib/people";
import { requireViewer } from "@/lib/session";
import { getWallets } from "@/lib/wallets";

export default function Page({ searchParams }: PageProps<"/">) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <Suspense
        fallback={<p className="text-(--text-secondary)">Memuat data…</p>}
      >
        <Dashboard searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Dashboard({
  searchParams,
}: Pick<PageProps<"/">, "searchParams">) {
  const { m, d } = await searchParams;
  // "Today" must be read per request, never baked into the prerendered shell.
  await connection();
  const thisMonth = currentMonth();
  const month = isMonth(m) ? m : thisMonth;
  const date = today();
  const { start, end } = monthRange(month);

  const viewer = await requireViewer();
  const wallets = await getWallets(viewer);
  // ?d=<wallet id> or ?d=none narrows everything to one wallet.
  const filter: WalletFilter =
    d === "none"
      ? "none"
      : wallets.find((wallet) => String(wallet.id) === d)?.id;
  const [monthTotal, byCategory, byOwner, byWallet, byDay, rows] =
    await Promise.all([
      getTotal(start, end, viewer, filter),
      getMonthByCategory(month, viewer, filter),
      getMonthByOwner(month, viewer, filter),
      getMonthByWallet(month, viewer),
      getMonthByDay(month, viewer, filter),
      getMonthExpenses(month, viewer, filter),
    ]);
  /** Link to the dashboard keeping the month and wallet unless overridden. */
  const href = (next: { month?: string; wallet?: string | null }) => {
    const params = new URLSearchParams({ m: next.month ?? month });
    const wallet =
      next.wallet === undefined ? (filter?.toString() ?? null) : next.wallet;
    if (wallet) params.set("d", wallet);
    return `/?${params}`;
  };
  const filterOptions = [
    { value: null, label: "Semua dompet" },
    ...wallets.map((wallet) => ({
      value: String(wallet.id),
      label: `${wallet.name} (${wallet.owner})`,
    })),
    { value: "none", label: "Tanpa dompet" },
  ];

  const todayTotal = rows
    .filter((row) => row.spentOn === date)
    .reduce((sum, row) => sum + row.amount, 0);
  // Average over the days that have happened so far, not the whole month.
  const elapsedDays =
    month === thisMonth ? Number(date.slice(8)) : daysInMonth(month);

  const dayTotals = new Map(byDay.map((d) => [d.date, d.total]));
  const daily = Array.from({ length: daysInMonth(month) }, (_, i) => {
    const day = String(i + 1).padStart(2, "0");
    return {
      day: i + 1,
      label: formatDay(`${month}-${day}`),
      total: dayTotals.get(`${month}-${day}`) ?? 0,
    };
  });

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">MyCashflow</h1>
        <div className="flex items-center gap-3">
          <nav
            aria-label="Pilih bulan"
            className="flex items-center gap-1 text-sm"
          >
            <Link
              href={href({ month: shiftMonth(month, -1) })}
              aria-label="Bulan sebelumnya"
              className="rounded-md px-2 py-1 text-(--text-secondary) hover:bg-(--series-1-wash)"
            >
              ←
            </Link>
            <span className="min-w-32 text-center font-medium">
              {formatMonth(month)}
            </span>
            {month < thisMonth ? (
              <Link
                href={href({ month: shiftMonth(month, 1) })}
                aria-label="Bulan berikutnya"
                className="rounded-md px-2 py-1 text-(--text-secondary) hover:bg-(--series-1-wash)"
              >
                →
              </Link>
            ) : (
              <span aria-hidden className="px-2 py-1 text-(--axis)">
                →
              </span>
            )}
          </nav>
          <Nav current="/" />
        </div>
      </header>

      {wallets.length > 0 && (
        <nav
          aria-label="Saring per dompet"
          className="mt-4 flex flex-wrap items-center gap-2 text-sm"
        >
          {filterOptions.map((option) => {
            const active = (filter?.toString() ?? null) === option.value;
            return active ? (
              <span
                key={option.label}
                aria-current="true"
                className="rounded-full bg-(--series-1) px-3 py-1 font-medium text-white"
              >
                {option.label}
              </span>
            ) : (
              <Link
                key={option.label}
                href={href({ wallet: option.value })}
                className="rounded-full border border-(--axis) px-3 py-1 text-(--text-secondary) hover:bg-(--series-1-wash)"
              >
                {option.label}
              </Link>
            );
          })}
        </nav>
      )}

      <section className="mt-6 grid gap-4 sm:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="card p-5">
          <div className="text-sm text-(--text-secondary)">
            Total pengeluaran
          </div>
          <div className="mt-1 text-4xl font-semibold sm:text-5xl">
            {formatRupiah(monthTotal.total)}
          </div>
        </div>
        <Stat
          label={month === thisMonth ? "Hari ini" : "Transaksi terbesar"}
          value={formatRupiah(
            month === thisMonth
              ? todayTotal
              : Math.max(0, ...rows.map((row) => row.amount)),
          )}
        />
        <Stat
          label="Rata-rata per hari"
          value={formatRupiah(Math.round(monthTotal.total / elapsedDays))}
        />
        <Stat label="Transaksi" value={String(monthTotal.count)} />
      </section>

      {rows.length === 0 ? (
        <p className="card mt-4 p-8 text-center text-(--text-secondary)">
          {filter === undefined
            ? `Belum ada pengeluaran di ${formatMonth(month)}. Kirim pesan ke bot Telegram-mu untuk mulai mencatat.`
            : `Belum ada pengeluaran dari dompet ini di ${formatMonth(month)}.`}
        </p>
      ) : (
        <>
          <section className="mt-4 grid gap-4 lg:grid-cols-[3fr_2fr]">
            <div className="card p-5">
              <h2 className="text-sm font-medium">Pengeluaran per hari</h2>
              <div className="mt-4">
                <DailyChart data={daily} />
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="card p-5">
                <h2 className="text-sm font-medium">Per orang</h2>
                <BarList
                  items={byOwner.map((o) => ({
                    label: o.owner ?? UNASSIGNED,
                    total: o.total,
                  }))}
                />
              </div>
              {wallets.length > 0 && filter === undefined && (
                <div className="card p-5">
                  <h2 className="text-sm font-medium">Per dompet</h2>
                  <BarList
                    items={byWallet.map((w) => ({
                      label: w.wallet ? `${w.wallet} (${w.owner})` : UNASSIGNED,
                      total: w.total,
                    }))}
                  />
                </div>
              )}
              <div className="card flex-1 p-5">
                <h2 className="text-sm font-medium">Per kategori</h2>
                <BarList
                  items={byCategory.map((c) => ({
                    label: c.category,
                    total: c.total,
                  }))}
                />
              </div>
            </div>
          </section>

          <section className="card mt-4 overflow-hidden">
            <h2 className="px-5 pt-5 text-sm font-medium">Transaksi</h2>
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-(--text-muted)">
                <tr className="border-b border-(--grid)">
                  <th className="px-5 py-2 font-normal">Tanggal</th>
                  <th className="px-2 py-2 font-normal">Deskripsi</th>
                  <th className="hidden px-2 py-2 font-normal sm:table-cell">
                    Kategori
                  </th>
                  <th className="px-2 py-2 font-normal">Pemilik / dompet</th>
                  <th className="px-2 py-2 text-right font-normal">Jumlah</th>
                  <th className="w-10 px-2 py-2">
                    <span className="sr-only">Hapus</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-(--grid) last:border-0"
                  >
                    <td className="px-5 py-3 whitespace-nowrap text-(--text-secondary)">
                      {formatDay(row.spentOn)}
                    </td>
                    <td className="px-2 py-3">
                      <div className="break-words">{row.description}</div>
                      <div className="text-xs text-(--text-muted)">
                        {[row.merchant, row.source === "receipt" && "Struk"]
                          .filter(Boolean)
                          .join(" · ")}
                        <span className="sm:hidden">
                          {row.merchant || row.source === "receipt"
                            ? " · "
                            : ""}
                          {row.category}
                        </span>
                      </div>
                    </td>
                    <td className="hidden px-2 py-3 text-(--text-secondary) sm:table-cell">
                      {row.category}
                    </td>
                    <td className="px-2 py-3">
                      <InlineSelect
                        value={row.owner ?? ""}
                        options={visiblePeople(viewer).map((person) => ({
                          value: person,
                          label: person,
                        }))}
                        emptyLabel={UNASSIGNED}
                        label={`Pemilik ${row.description}`}
                        action={changeOwner.bind(null, row.id)}
                      />
                      {/* Only the owner's own wallets, as in the bot. */}
                      {wallets.some((w) => w.owner === row.owner) && (
                        <div className="mt-1">
                          <InlineSelect
                            value={String(row.walletId ?? "")}
                            options={wallets
                              .filter((wallet) => wallet.owner === row.owner)
                              .map((wallet) => ({
                                value: String(wallet.id),
                                label: wallet.name,
                              }))}
                            emptyLabel="Tanpa dompet"
                            label={`Dompet ${row.description}`}
                            action={changeWallet.bind(null, row.id)}
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-3 text-right whitespace-nowrap tabular-nums">
                      {formatRupiah(row.amount)}
                    </td>
                    <td className="px-2 py-3 text-right">
                      <form action={removeExpense}>
                        <input type="hidden" name="id" value={row.id} />
                        <button
                          type="submit"
                          aria-label={`Hapus ${row.description}`}
                          className="rounded-md px-2 py-1 text-(--text-muted) hover:bg-(--series-1-wash) hover:text-(--critical)"
                        >
                          ×
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
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
