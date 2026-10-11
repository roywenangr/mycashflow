import type { Metadata } from "next";
import { Suspense } from "react";
import {
  addWallet,
  editWallet,
  moveFunds,
  placeIncoming,
  recordIncome,
  removeEntry,
  removeWallet,
  sendFunds,
} from "@/app/actions";
import { Nav } from "@/app/nav";
import { TIMEZONE } from "@/lib/dates";
import { formatRupiah } from "@/lib/format";
import { othersOf, type Person, visiblePeople } from "@/lib/people";
import { requireViewer } from "@/lib/session";
import { getRecentEntries, getWaitingFor, getWallets } from "@/lib/wallets";

export const metadata: Metadata = { title: "Dompet · MyCashflow" };

const field =
  "mt-1 w-full rounded-md border border-(--axis) bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-(--series-1) focus-visible:ring-2 focus-visible:ring-(--series-1)/30";
const primaryButton =
  "mt-4 rounded-md bg-(--text-primary) px-3 py-2 text-sm font-medium text-(--surface)";

export default function DompetPage({ searchParams }: PageProps<"/dompet">) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Dompet</h1>
        <Nav current="/dompet" />
      </header>
      <Suspense
        fallback={<p className="mt-6 text-(--text-secondary)">Memuat data…</p>}
      >
        <Dompet searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Dompet({
  searchParams,
}: Pick<PageProps<"/dompet">, "searchParams">) {
  const { pesan } = await searchParams;
  const viewer = await requireViewer();
  const people = visiblePeople(viewer);
  const others = othersOf(viewer);
  const [wallets, entries, waiting, everyWallet] = await Promise.all([
    getWallets(viewer),
    getRecentEntries(viewer),
    getWaitingFor(viewer),
    getWallets(),
  ]);
  // Where money can be sent: other people's wallets, by name only.
  const theirWallets = everyWallet.filter((wallet) =>
    others.includes(wallet.owner as Person),
  );
  const total = wallets.reduce((sum, wallet) => sum + wallet.balance, 0);
  const walletOptions = wallets.map((wallet) => (
    <option key={wallet.id} value={wallet.id}>
      {wallet.name} ({wallet.owner})
    </option>
  ));
  const entryTime = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE,
  });

  return (
    <>
      {typeof pesan === "string" && (
        <p
          role="alert"
          className="card mt-6 border-(--critical) p-4 text-sm text-(--critical)"
        >
          {pesan}
        </p>
      )}

      {waiting.length > 0 && (
        <section className="card mt-6 p-5">
          <h2 className="text-sm font-medium">Kiriman menunggu dompet</h2>
          <ul className="mt-3 space-y-3">
            {waiting.map((entry) => (
              <li key={entry.id}>
                <form
                  action={placeIncoming}
                  className="flex flex-wrap items-center gap-3 text-sm"
                >
                  <input type="hidden" name="id" value={entry.id} />
                  <span className="font-medium tabular-nums">
                    {formatRupiah(entry.amount)}
                  </span>
                  <span className="text-(--text-secondary)">{entry.note}</span>
                  <select
                    name="dompet"
                    required
                    aria-label="Dompet tujuan"
                    className="rounded-md border border-(--axis) bg-(--surface) px-2 py-1.5"
                  >
                    {walletOptions}
                  </select>
                  <button
                    type="submit"
                    disabled={wallets.length === 0}
                    className="rounded-md bg-(--text-primary) px-3 py-1.5 font-medium text-(--surface) disabled:opacity-50"
                  >
                    Masukkan
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <div className="card p-5">
          <div className="text-sm text-(--text-secondary)">Total saldo</div>
          <div className="mt-1 text-4xl font-semibold sm:text-5xl">
            {formatRupiah(total)}
          </div>
        </div>
        {people.map((person) => (
          <div key={person} className="card p-5">
            <div className="text-sm text-(--text-secondary)">{person}</div>
            <div className="mt-1 text-xl font-semibold">
              {formatRupiah(
                wallets
                  .filter((wallet) => wallet.owner === person)
                  .reduce((sum, wallet) => sum + wallet.balance, 0),
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="card mt-4 overflow-x-auto">
        <h2 className="px-5 pt-5 text-sm font-medium">Daftar dompet</h2>
        {wallets.length === 0 ? (
          <p className="p-5 text-sm text-(--text-secondary)">
            Belum ada dompet. Tambahkan lewat form di bawah, atau kirim{" "}
            <code>/dompet tambah BCA 1,5jt</code> ke bot.
          </p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-(--text-muted)">
              <tr className="border-b border-(--grid)">
                <th className="px-5 py-2 font-normal">Dompet</th>
                <th className="px-2 py-2 font-normal">Pemilik</th>
                <th className="hidden px-2 py-2 text-right font-normal sm:table-cell">
                  Saldo awal
                </th>
                <th className="px-2 py-2 text-right font-normal">Saldo</th>
                <th className="px-5 py-2">
                  <span className="sr-only">Ubah</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {wallets.map((wallet) => (
                <tr
                  key={wallet.id}
                  className="border-b border-(--grid) align-top last:border-0"
                >
                  <td className="px-5 py-3 font-medium">{wallet.name}</td>
                  <td className="px-2 py-3 text-(--text-secondary)">
                    {wallet.owner}
                  </td>
                  <td className="hidden px-2 py-3 text-right whitespace-nowrap text-(--text-secondary) tabular-nums sm:table-cell">
                    {formatRupiah(wallet.initialBalance)}
                  </td>
                  <td className="px-2 py-3 text-right font-medium whitespace-nowrap tabular-nums">
                    {formatRupiah(wallet.balance)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <details className="text-left">
                      <summary className="cursor-pointer text-right text-(--text-secondary) underline decoration-(--axis) underline-offset-4">
                        Ubah
                      </summary>
                      <form action={editWallet} className="mt-3 w-56">
                        <input type="hidden" name="id" value={wallet.id} />
                        <label className="block text-xs text-(--text-secondary)">
                          Nama
                          <input
                            name="nama"
                            defaultValue={wallet.name}
                            required
                            className={field}
                          />
                        </label>
                        <label className="mt-2 block text-xs text-(--text-secondary)">
                          Pemilik
                          <select
                            name="pemilik"
                            defaultValue={wallet.owner}
                            className={field}
                          >
                            {people.map((person) => (
                              <option key={person}>{person}</option>
                            ))}
                          </select>
                        </label>
                        <label className="mt-2 block text-xs text-(--text-secondary)">
                          Saldo awal
                          <input
                            name="saldo"
                            defaultValue={wallet.initialBalance}
                            inputMode="numeric"
                            className={field}
                          />
                        </label>
                        <button type="submit" className={primaryButton}>
                          Simpan
                        </button>
                      </form>
                      <form action={removeWallet} className="mt-4 w-56">
                        <input type="hidden" name="id" value={wallet.id} />
                        <p className="text-xs text-(--text-muted)">
                          Menghapus dompet ikut menghapus pemasukan dan pindah
                          dananya. Pengeluarannya tetap ada, tanpa dompet.
                        </p>
                        <button
                          type="submit"
                          className="mt-2 rounded-md border border-(--critical) px-3 py-2 text-sm font-medium text-(--critical)"
                        >
                          Hapus dompet
                        </button>
                      </form>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-4 grid gap-4 sm:grid-cols-2">
        <form action={addWallet} className="card p-5">
          <h2 className="text-sm font-medium">Tambah dompet</h2>
          <label className="mt-4 block text-sm">
            Nama
            <input
              name="nama"
              required
              placeholder="BCA, blu, SeaBank…"
              className={field}
            />
          </label>
          <label className="mt-3 block text-sm">
            Pemilik
            <select name="pemilik" className={field}>
              {people.map((person) => (
                <option key={person}>{person}</option>
              ))}
            </select>
          </label>
          <label className="mt-3 block text-sm">
            Saldo awal
            <input
              name="saldo"
              placeholder="1500000 atau 1,5jt"
              className={field}
            />
          </label>
          <button type="submit" className={primaryButton}>
            Tambah
          </button>
        </form>

        <form action={recordIncome} className="card p-5">
          <h2 className="text-sm font-medium">Catat pemasukan</h2>
          <label className="mt-4 block text-sm">
            Masuk ke
            <select name="dompet" required className={field}>
              {walletOptions}
            </select>
          </label>
          <label className="mt-3 block text-sm">
            Jumlah
            <input
              name="jumlah"
              required
              placeholder="5000000 atau 5jt"
              className={field}
            />
          </label>
          <label className="mt-3 block text-sm">
            Catatan
            <input
              name="catatan"
              placeholder="gaji, bonus…"
              className={field}
            />
          </label>
          <button
            type="submit"
            disabled={wallets.length === 0}
            className={`${primaryButton} disabled:opacity-50`}
          >
            Catat
          </button>
        </form>

        <form action={moveFunds} className="card p-5">
          <h2 className="text-sm font-medium">Pindah dana</h2>
          <label className="mt-4 block text-sm">
            Dari
            <select name="dari" required className={field}>
              {walletOptions}
            </select>
          </label>
          <label className="mt-3 block text-sm">
            Ke
            <select name="ke" required className={field}>
              {walletOptions}
            </select>
          </label>
          <label className="mt-3 block text-sm">
            Jumlah
            <input
              name="jumlah"
              required
              placeholder="500000 atau 500rb"
              className={field}
            />
          </label>
          <button
            type="submit"
            disabled={wallets.length < 2}
            className={`${primaryButton} disabled:opacity-50`}
          >
            Pindahkan
          </button>
        </form>

        {others.length > 0 && (
          <form action={sendFunds} className="card p-5">
            <h2 className="text-sm font-medium">Kirim ke orang lain</h2>
            <label className="mt-4 block text-sm">
              Dari dompet
              <select name="dari" required className={field}>
                {walletOptions}
              </select>
            </label>
            <label className="mt-3 block text-sm">
              Ke dompet
              <select name="ke" required className={field}>
                {theirWallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {wallet.name} ({wallet.owner})
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-sm">
              Jumlah
              <input
                name="jumlah"
                required
                placeholder="500000 atau 500rb"
                className={field}
              />
            </label>
            <label className="mt-3 block text-sm">
              Catatan
              <input
                name="catatan"
                placeholder="bagi hasil…"
                className={field}
              />
            </label>
            <p className="mt-3 text-xs text-(--text-muted)">
              {theirWallets.length === 0
                ? `${others.join(" dan ")} belum punya dompet, jadi belum bisa dikirimi.`
                : "Uangnya langsung masuk ke dompet itu, dan kalian berdua dikabari lewat bot."}
            </p>
            <button
              type="submit"
              disabled={wallets.length === 0 || theirWallets.length === 0}
              className={`${primaryButton} disabled:opacity-50`}
            >
              Kirim
            </button>
          </form>
        )}
      </section>

      {entries.length > 0 && (
        <section className="card mt-4 overflow-x-auto">
          <h2 className="px-5 pt-5 text-sm font-medium">
            Pemasukan dan pindah dana terakhir
          </h2>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-(--text-muted)">
              <tr className="border-b border-(--grid)">
                <th className="px-5 py-2 font-normal">Waktu</th>
                <th className="px-2 py-2 font-normal">Dompet</th>
                <th className="px-2 py-2 font-normal">Catatan</th>
                <th className="px-2 py-2 text-right font-normal">Jumlah</th>
                <th className="w-10 px-2 py-2">
                  <span className="sr-only">Hapus</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-(--grid) last:border-0"
                >
                  <td className="px-5 py-3 whitespace-nowrap text-(--text-secondary)">
                    {entryTime.format(entry.createdAt)}
                  </td>
                  <td className="px-2 py-3">
                    {entry.wallet}{" "}
                    <span className="text-(--text-muted)">({entry.owner})</span>
                  </td>
                  <td className="px-2 py-3 text-(--text-secondary)">
                    {entry.note ?? (entry.kind === "income" ? "Pemasukan" : "")}
                  </td>
                  <td className="px-2 py-3 text-right whitespace-nowrap tabular-nums">
                    {entry.amount > 0 ? "+" : "−"}
                    {formatRupiah(Math.abs(entry.amount))}
                  </td>
                  <td className="px-2 py-3 text-right">
                    <form action={removeEntry}>
                      <input type="hidden" name="id" value={entry.id} />
                      <button
                        type="submit"
                        aria-label={`Hapus ${entry.note ?? "pemasukan"}`}
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
      )}
    </>
  );
}
