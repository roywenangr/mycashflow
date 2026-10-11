"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { parseAmount } from "@/lib/amount";
import {
  hasPasswords,
  personForPassword,
  SESSION_COOKIE,
  sessionToken,
} from "@/lib/auth";
import { deleteExpense, setOwner, setWallet } from "@/lib/expenses";
import { getBot } from "@/lib/bot";
import { notifyPayout } from "@/lib/bot-wallets";
import { isPerson, othersOf, visiblePeople, type Person } from "@/lib/people";
import { requireViewer } from "@/lib/session";
import {
  addIncome,
  createWallet,
  deleteEntry,
  deleteWallet,
  getWallet,
  getWallets,
  placeEntry,
  recordPayout,
  transfer,
  updateWallet,
} from "@/lib/wallets";

export async function login(_previous: string | null, formData: FormData) {
  if (!hasPasswords()) return "Password dashboard belum di-set di server.";
  const person = personForPassword(String(formData.get("password") ?? ""));
  const token = person && (await sessionToken(person));
  if (!token) return "Password salah.";

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function removeExpense(formData: FormData) {
  const viewer = await requireViewer();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) await deleteExpense(id, viewer);
  revalidatePath("/");
}

export async function changeOwner(id: number, owner: string) {
  const viewer = await requireViewer();
  if (Number.isInteger(id)) {
    await setOwner(id, isPerson(owner) ? owner : null, viewer);
  }
  revalidatePath("/");
}

export async function changeWallet(id: number, walletId: string) {
  const viewer = await requireViewer();
  if (Number.isInteger(id)) {
    await setWallet(id, walletId ? Number(walletId) : null, viewer);
  }
  revalidatePath("/");
}

/** Back to the wallet page with a notice explaining what went wrong. */
function walletError(message: string): never {
  redirect(`/dompet?pesan=${encodeURIComponent(message)}`);
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

/** Empty means zero; anything else must be a valid amount. */
function openingBalance(formData: FormData): number {
  const raw = text(formData, "saldo");
  if (!raw || /^0+$/.test(raw)) return 0;
  return (
    parseAmount(raw) ??
    walletError(
      `Saldo awal "${raw}" tidak terbaca. Contoh: 1500000 atau 1,5jt.`,
    )
  );
}

/** The owner field of a wallet form, limited to people the viewer may see. */
function ownerField(formData: FormData, viewer: Person): Person {
  const owner = text(formData, "pemilik");
  return isPerson(owner) && visiblePeople(viewer).includes(owner)
    ? owner
    : walletError("Pilih pemilik dompetnya.");
}

export async function addWallet(formData: FormData) {
  const viewer = await requireViewer();
  const name = text(formData, "nama");
  if (!name) walletError("Isi nama dompetnya.");
  const owner = ownerField(formData, viewer);

  const wallet = await createWallet({
    name,
    owner,
    initialBalance: openingBalance(formData),
  });
  if (!wallet) walletError(`${owner} sudah punya dompet bernama ${name}.`);
  redirect("/dompet");
}

export async function editWallet(formData: FormData) {
  const viewer = await requireViewer();
  const wallet = await getWallet(Number(formData.get("id")), viewer);
  const name = text(formData, "nama");
  if (!wallet || !name) walletError("Isi nama dompetnya.");

  await updateWallet(wallet.id, {
    name,
    owner: ownerField(formData, viewer),
    initialBalance: openingBalance(formData),
  });
  redirect("/dompet");
}

export async function removeWallet(formData: FormData) {
  const viewer = await requireViewer();
  const wallet = await getWallet(Number(formData.get("id")), viewer);
  if (wallet) await deleteWallet(wallet.id);
  revalidatePath("/");
  redirect("/dompet");
}

export async function recordIncome(formData: FormData) {
  const viewer = await requireViewer();
  const raw = text(formData, "jumlah");
  const amount =
    parseAmount(raw) ??
    walletError(`Jumlah "${raw}" tidak terbaca. Contoh: 5000000 atau 5jt.`);
  const wallet = await getWallet(Number(formData.get("dompet")), viewer);
  if (!wallet) walletError("Pilih dompet tujuannya.");

  await addIncome({
    walletId: wallet.id,
    amount,
    note: text(formData, "catatan") || null,
  });
  redirect("/dompet");
}

export async function moveFunds(formData: FormData) {
  const viewer = await requireViewer();
  const raw = text(formData, "jumlah");
  const amount =
    parseAmount(raw) ??
    walletError(`Jumlah "${raw}" tidak terbaca. Contoh: 500000 atau 500rb.`);

  const wallets = await getWallets(viewer);
  const from = wallets.find((w) => w.id === Number(formData.get("dari")));
  const to = wallets.find((w) => w.id === Number(formData.get("ke")));
  if (!from || !to) walletError("Pilih dompet asal dan tujuan.");
  if (from.id === to.id) walletError("Dompet asal dan tujuan harus berbeda.");

  await transfer({ from, to, amount });
  redirect("/dompet");
}

export async function removeEntry(formData: FormData) {
  const viewer = await requireViewer();
  await deleteEntry(Number(formData.get("id")), viewer);
  redirect("/dompet");
}

/** Sends money from one of the viewer's wallets into another person's wallet. */
export async function sendFunds(formData: FormData) {
  const viewer = await requireViewer();
  const raw = text(formData, "jumlah");
  const amount =
    parseAmount(raw) ??
    walletError(`Jumlah "${raw}" tidak terbaca. Contoh: 500000 atau 500rb.`);
  // The destination wallet says who the money goes to.
  const into = await getWallet(Number(formData.get("ke")));
  const to = into?.owner;
  if (!isPerson(to) || !othersOf(viewer).includes(to)) {
    walletError("Pilih dompet tujuannya.");
  }

  const note = text(formData, "catatan") || null;
  const sent = await recordPayout({
    id: `send-${crypto.randomUUID()}`,
    sender: viewer,
    to,
    fromWalletId: Number(formData.get("dari")),
    toWalletId: into!.id,
    amount,
    note,
  });
  if (!sent) walletError("Pilih dompet asalnya.");

  // Best effort: the money has already moved either way.
  await notifyPayout(getBot(), {
    sender: viewer,
    to,
    amount,
    label: note,
    from: sent.from,
    into: sent.into,
    incoming: sent.incoming,
  }).catch((error) => console.error("Gagal mengabari kiriman", error));
  redirect("/dompet");
}

/** Puts money someone sent into one of the viewer's wallets. */
export async function placeIncoming(formData: FormData) {
  const viewer = await requireViewer();
  const placed = await placeEntry(
    Number(formData.get("id")),
    Number(formData.get("dompet")),
    viewer,
  );
  if (!placed)
    walletError("Kiriman itu tidak bisa ditempatkan di dompet tersebut.");
  redirect("/dompet");
}
