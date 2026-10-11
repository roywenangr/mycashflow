import {
  Actions,
  Button,
  Card,
  CardText,
  type ActionEvent,
  type Chat,
  type Thread,
} from "chat";
import { parseAmount } from "@/lib/amount";
import { formatRupiah } from "@/lib/format";
import {
  isPerson,
  othersOf,
  type Person,
  personLabel,
  personOf,
  telegramIdsOf,
  visiblePeople,
} from "@/lib/people";
import {
  addIncome,
  deleteDraft,
  getDraft,
  recordPayout,
  createWallet,
  deleteWallet,
  draftSend,
  getWaitingFor,
  placeEntry,
  getWallet,
  getWallets,
  transfer,
  updateWallet,
  walletLabel,
  type WalletWithBalance,
} from "@/lib/wallets";

const WALLET_OWNER = "wowner";
const WALLET_DELETE = "wdel";
const WALLET_DELETE_PICK = "wdelpick";
const WALLET_DELETE_YES = "wdelyes";
const WALLET_DELETE_NO = "wdelno";
const INCOME_WALLET = "inw";
const TRANSFER_FROM = "tf";
const TRANSFER_TO = "tt";
const SEND_FROM = "sf";
const SEND_TO = "st";
const RECEIVE = "rcv";

export const WALLET_HELP = `👛 /dompet — daftar dompet dan saldonya
➕ /dompet tambah BCA 1,5jt — dompet baru dengan saldo awal
➖ /dompet hapus — hapus dompet
💵 /masuk 5jt gaji — catat pemasukan
🔁 /pindah 500rb — pindah dana antar dompetmu
💸 /kirim 500rb bagi hasil — kirim uang ke orang lain; kamu yang memilih dompet asal dan dompet tujuannya`;

type WalletRef = { id: number; name: string; owner: string };

/** Wallet buttons, three to a row so the labels stay readable. */
export function walletButtonRows(
  wallets: WalletRef[],
  viewer: Person | null,
  actionId: string,
  value: (wallet: WalletRef) => string,
  selectedId?: number | null,
) {
  const rows = [];
  for (let i = 0; i < wallets.length; i += 3) {
    rows.push(
      Actions(
        wallets.slice(i, i + 3).map((wallet) =>
          Button({
            id: actionId,
            value: value(wallet),
            label: `${wallet.id === selectedId ? "✅" : "👛"} ${walletLabel(wallet, viewer)}`,
          }),
        ),
      ),
    );
  }
  return rows;
}

const NO_WALLETS =
  "👛 Belum ada dompet. Tambah dulu, misalnya:\n/dompet tambah BCA 1,5jt";

export async function walletCommand(args: string, viewer: Person) {
  const [sub = "", ...rest] = args.trim().split(/\s+/);

  switch (sub.toLowerCase()) {
    case "":
      return walletList(viewer);
    case "tambah":
      return addWallet(rest, viewer);
    case "hapus":
      return walletDeletePicker(viewer);
    default:
      return `🤷 Perintah dompet "${sub}" tidak kukenal.\n\n${WALLET_HELP}`;
  }
}

async function walletDeletePicker(viewer: Person) {
  const wallets = await getWallets(viewer);
  if (wallets.length === 0) return NO_WALLETS;
  return Card({
    children: [
      CardText("🗑️ Hapus dompet yang mana?"),
      ...walletButtonRows(wallets, viewer, WALLET_DELETE, (w) => String(w.id)),
    ],
  });
}

async function walletList(viewer: Person) {
  const wallets = await getWallets(viewer);
  if (wallets.length === 0) return NO_WALLETS;

  const lines = ["👛 Dompet"];
  for (const person of visiblePeople(viewer)) {
    const mine = wallets.filter((wallet) => wallet.owner === person);
    if (mine.length === 0) continue;
    lines.push(`\n${personLabel(person)}`);
    for (const wallet of mine) {
      lines.push(`• ${wallet.name}: ${formatRupiah(wallet.balance)}`);
    }
  }
  const total = wallets.reduce((sum, wallet) => sum + wallet.balance, 0);
  lines.push(`\n💰 Total saldo: ${formatRupiah(total)}`);
  return Card({
    children: [
      CardText(lines.join("\n")),
      Actions([Button({ id: WALLET_DELETE_PICK, label: "🗑️ Hapus dompet" })]),
    ],
  });
}

async function addWallet(tokens: string[], owner: Person) {
  // A trailing amount is the opening balance: "/dompet tambah BCA 1,5jt".
  const opening = tokens.length > 1 ? parseAmount(tokens.at(-1)!) : null;
  const name = (opening === null ? tokens : tokens.slice(0, -1)).join(" ");
  if (!name) {
    return "✍️ Tulis nama dompetnya, misalnya:\n/dompet tambah BCA 1,5jt";
  }

  const wallet = await createWallet({
    name,
    owner,
    initialBalance: opening ?? 0,
  });
  if (!wallet) {
    return `🙅 ${personLabel(owner)} sudah punya dompet bernama ${name}.`;
  }
  return walletCreatedCard(wallet, owner);
}

function walletCreatedCard(
  wallet: { id: number; name: string; owner: string; initialBalance: number },
  viewer: Person,
) {
  return Card({
    children: [
      CardText(
        `👛 Dompet ${wallet.name} dibuat untuk ${personLabel(wallet.owner)}\n💰 Saldo awal: ${formatRupiah(wallet.initialBalance)}\n\nSalah pemilik? Ganti lewat tombol:`,
      ),
      Actions(
        visiblePeople(viewer).map((person) =>
          Button({
            id: WALLET_OWNER,
            value: `${person}:${wallet.id}`,
            label:
              person === wallet.owner ? `✅ ${person}` : personLabel(person),
          }),
        ),
      ),
    ],
  });
}

export async function incomeCommand(args: string, viewer: Person) {
  const [first = "", ...rest] = args.trim().split(/\s+/);
  const amount = parseAmount(first);
  if (amount === null) {
    return "✍️ Tulis jumlahnya dulu, misalnya:\n/masuk 5jt gaji";
  }

  const wallets = await getWallets(viewer);
  if (wallets.length === 0) return NO_WALLETS;

  const note = rest.join(" ") || null;
  // Saved now and attached to a wallet on tap, so the note survives the
  // 64-byte limit on button data.
  const entry = await addIncome({
    walletId: null,
    amount,
    note,
    recipient: viewer,
  });
  return Card({
    children: [
      CardText(
        `💵 Pemasukan ${formatRupiah(amount)}${note ? ` · ${note}` : ""}\n\nMasuk ke dompet mana?`,
      ),
      ...walletButtonRows(
        wallets,
        viewer,
        INCOME_WALLET,
        (w) => `${entry.id}:${w.id}`,
      ),
    ],
  });
}

export async function transferCommand(args: string, viewer: Person) {
  const amount = parseAmount(args.trim().split(/\s+/)[0] ?? "");
  if (amount === null) {
    return "✍️ Tulis jumlahnya dulu, misalnya:\n/pindah 500rb";
  }

  const wallets = await getWallets(viewer);
  if (wallets.length === 0) return NO_WALLETS;
  if (wallets.length < 2) return "🔁 Pindah dana butuh minimal dua dompet.";

  return Card({
    children: [
      CardText(`🔁 Pindah ${formatRupiah(amount)}\n\nDari dompet mana?`),
      ...walletButtonRows(
        wallets,
        viewer,
        TRANSFER_FROM,
        (w) => `${amount}:${w.id}`,
      ),
    ],
  });
}

export async function sendCommand(args: string, viewer: Person) {
  const [first = "", ...rest] = args.trim().split(/\s+/);
  const amount = parseAmount(first);
  if (amount === null) {
    return "✍️ Tulis jumlahnya dulu, misalnya:\n/kirim 500rb bagi hasil";
  }
  // With two people there is exactly one possible recipient.
  const [to] = othersOf(viewer);
  if (!to) return "🤷 Tidak ada orang lain yang bisa dikirimi.";

  const wallets = await getWallets(viewer);
  if (wallets.length === 0) return NO_WALLETS;
  // The sender picks where it lands, so there has to be somewhere.
  if ((await walletsOf(to)).length === 0) {
    return `🙅 ${personLabel(to)} belum punya dompet di bot, jadi belum bisa dikirimi. Minta ${to} membuat dompet dulu lewat tombol ➕ Dompet baru.`;
  }

  const note = rest.join(" ") || null;
  // Saved as a draft so the note survives the 64-byte limit on button data.
  const draft = await draftSend({ to, amount, note });
  return Card({
    children: [
      CardText(
        `💸 Kirim ${formatRupiah(amount)} ke ${personLabel(to)}${note ? ` · ${note}` : ""}\n\nDari dompet mana?`,
      ),
      ...walletButtonRows(
        wallets,
        viewer,
        SEND_FROM,
        (w) => `${draft.id}:${w.id}`,
      ),
    ],
  });
}

/** A person's own wallets, for someone choosing where to send them money. */
async function walletsOf(person: Person) {
  return (await getWallets()).filter((wallet) => wallet.owner === person);
}

export async function receiveCommand(viewer: Person) {
  const waiting = await getWaitingFor(viewer);
  if (waiting.length === 0) return "📭 Tidak ada kiriman yang menunggu.";
  return incomingMessage(waiting[0], viewer, waiting.length - 1);
}

/** Asks the recipient which of their wallets an incoming entry goes into. */
async function incomingMessage(
  entry: { id: number; amount: number; note: string | null },
  viewer: Person,
  more = 0,
) {
  const head = `📥 ${entry.note ?? "Kiriman"}: ${formatRupiah(entry.amount)}`;
  const wallets = await getWallets(viewer);
  if (wallets.length === 0) {
    return `${head}\n\n👛 Kamu belum punya dompet. Buat dulu dengan /dompet tambah, lalu kirim /terima.`;
  }
  return Card({
    children: [
      CardText(
        `${head}\n\nMasuk ke dompet mana?${more > 0 ? `\n\n(${more} kiriman lain menunggu, kirim /terima lagi setelah ini)` : ""}`,
      ),
      ...walletButtonRows(
        wallets,
        viewer,
        RECEIVE,
        (w) => `${entry.id}:${w.id}`,
      ),
    ],
  });
}

/** Posts to every Telegram account of a person. False when none was reached. */
async function tell(
  bot: Chat,
  to: Person,
  message: Parameters<Thread["post"]>[0],
): Promise<boolean> {
  let reached = false;
  await bot.initialize();
  for (const telegramId of telegramIdsOf(to)) {
    try {
      const thread = await bot.openDM(telegramId);
      await thread.post(message);
      reached = true;
    } catch (error) {
      console.error(`Gagal mengabari ${to}`, error);
    }
  }
  return reached;
}

/**
 * Tells the recipient on Telegram that money is waiting. Returns false when
 * none of their accounts could be reached.
 */
export async function notifyIncoming(
  bot: Chat,
  entry: { id: number; amount: number; note: string | null },
  to: Person,
): Promise<boolean> {
  return tell(bot, to, await incomingMessage(entry, to));
}

/** Tells both sides about a payout recorded from the profit-sharing app. */
export async function notifyPayout(
  bot: Chat,
  payout: {
    sender: Person;
    to: Person;
    amount: number;
    label: string | null;
    from: WalletWithBalance;
    into: WalletWithBalance | null;
    incoming: { id: number; amount: number; note: string | null } | null;
  },
) {
  const { sender, to, from, into } = payout;
  const amount = formatRupiah(payout.amount);
  const label = payout.label ? [`📝 ${payout.label}`] : [];

  const sent = await tell(
    bot,
    sender,
    [
      `💸 Pengeluaran dari 👛 ${walletLabel(from, sender)}: ${amount} ke ${personLabel(to)} (${into ? `👛 ${into.name}` : "dompet belum dipilih"})`,
      ...label,
      balanceLine(from, sender),
    ].join("\n"),
  );
  const received = into
    ? await tell(
        bot,
        to,
        [
          `📥 Terima ${amount} ke 👛 ${into.name} dari ${personLabel(sender)}`,
          ...label,
          balanceLine(into, to),
        ].join("\n"),
      )
    : // No wallet picked for them: they choose it, as with /kirim.
      payout.incoming
      ? await notifyIncoming(bot, payout.incoming, to)
      : false;
  return { sent, received };
}

/** Tells both sides that a payout was taken back. */
export async function notifyPayoutCancelled(
  bot: Chat,
  cancelled: {
    sender: Person;
    to: Person;
    amount: number;
    label: string | null;
    from: WalletWithBalance | null;
    into: WalletWithBalance | null;
  },
) {
  const { sender, to, from, into } = cancelled;
  const what = `${formatRupiah(cancelled.amount)}${cancelled.label ? ` · ${cancelled.label}` : ""}`;
  await tell(
    bot,
    sender,
    [
      `↩️ Dibatalkan: kiriman ${what} ke ${personLabel(to)}`,
      ...(from
        ? [
            `Dikembalikan ke 👛 ${walletLabel(from, sender)}`,
            balanceLine(from, sender),
          ]
        : []),
    ].join("\n"),
  );
  await tell(
    bot,
    to,
    [
      `↩️ Dibatalkan: kiriman ${what} dari ${personLabel(sender)}`,
      ...(into ? [`Ditarik dari 👛 ${into.name}`, balanceLine(into, to)] : []),
    ].join("\n"),
  );
}

function reply(event: ActionEvent, message: string) {
  return event.adapter.postMessage(event.threadId, message);
}

/** Replaces the tapped message, which also removes its buttons. */
async function replace(
  event: ActionEvent,
  message: Parameters<ActionEvent["adapter"]["editMessage"]>[2],
) {
  try {
    await event.adapter.editMessage(event.threadId, event.messageId, message);
  } catch (error) {
    // Telegram rejects an edit that changes nothing.
    console.warn("Gagal memperbarui pesan", error);
  }
}

function balanceLine(wallet: WalletWithBalance, viewer: Person | null) {
  return `💰 Saldo ${walletLabel(wallet, viewer)}: ${formatRupiah(wallet.balance)}`;
}

const GONE = "🫥 Dompet itu sudah tidak ada.";

export function registerWalletActions(bot: Chat) {
  bot.onAction(WALLET_OWNER, async (event) => {
    const [owner, id] = (event.value ?? "").split(":");
    const viewer = personOf(event.user.userId);
    if (!viewer || !isPerson(owner)) return;
    if (!visiblePeople(viewer).includes(owner)) return;
    if (!(await getWallet(Number(id), viewer))) {
      return void (await reply(event, GONE));
    }

    await updateWallet(Number(id), { owner });
    const wallet = await getWallet(Number(id), viewer);
    if (!wallet) return void (await reply(event, GONE));

    await replace(event, walletCreatedCard(wallet, viewer));
    await reply(
      event,
      `👌 Sip, dompet ${wallet.name} sekarang punya ${personLabel(owner)} ✨`,
    );
  });

  bot.onAction(WALLET_DELETE_PICK, async (event) => {
    const viewer = personOf(event.user.userId);
    if (!viewer) return;
    await event.adapter.postMessage(
      event.threadId,
      await walletDeletePicker(viewer),
    );
  });

  bot.onAction(WALLET_DELETE, async (event) => {
    const viewer = personOf(event.user.userId);
    const wallet = viewer && (await getWallet(Number(event.value), viewer));
    if (!wallet) return void (await replace(event, GONE));

    await replace(
      event,
      Card({
        children: [
          CardText(
            `⚠️ Yakin hapus dompet ${wallet.name} (${wallet.owner})? Saldonya ${formatRupiah(wallet.balance)}.\n\nCatatan pemasukan dan pindah dana dompet ini ikut terhapus. Pengeluarannya tetap ada, tapi tanpa dompet.`,
          ),
          Actions([
            Button({
              id: WALLET_DELETE_YES,
              value: String(wallet.id),
              label: "🗑️ Ya, hapus",
            }),
            Button({ id: WALLET_DELETE_NO, label: "Batal" }),
          ]),
        ],
      }),
    );
  });

  bot.onAction(WALLET_DELETE_YES, async (event) => {
    const viewer = personOf(event.user.userId);
    const wallet = viewer && (await getWallet(Number(event.value), viewer));
    if (!wallet) return void (await replace(event, GONE));
    await deleteWallet(wallet.id);
    await replace(event, `🗑️ Dompet ${wallet.name} (${wallet.owner}) dihapus.`);
  });

  bot.onAction(WALLET_DELETE_NO, async (event) => {
    await replace(event, "👍 Batal, dompetnya tidak dihapus.");
  });

  bot.onAction(INCOME_WALLET, async (event) => {
    const [entryId, walletId] = (event.value ?? "").split(":").map(Number);
    const viewer = personOf(event.user.userId);
    if (!viewer || !(await getWallet(walletId, viewer))) {
      return void (await replace(event, GONE));
    }
    const entry = await placeEntry(entryId, walletId, viewer);
    if (!entry) {
      return void (await replace(event, "✔️ Pemasukan ini sudah dicatat."));
    }
    // Re-read for the balance including this income.
    const wallet = await getWallet(walletId, viewer);
    if (!wallet) return void (await replace(event, GONE));

    const what = `${formatRupiah(entry.amount)}${entry.note ? ` · ${entry.note}` : ""}`;
    await replace(event, `💵 Pemasukan ${what} ✔️`);
    await reply(
      event,
      `✅ ${what} masuk ke 👛 ${walletLabel(wallet, viewer)} 🎉\n${balanceLine(wallet, viewer)}`,
    );
  });

  const SENT = "✔️ Kiriman ini sudah diproses.";

  // Step two of /kirim: which of the recipient's wallets it lands in.
  bot.onAction(SEND_FROM, async (event) => {
    const [draftId, fromId] = (event.value ?? "").split(":").map(Number);
    const viewer = personOf(event.user.userId);
    const draft = viewer && (await getDraft(draftId, viewer));
    if (!viewer || !draft) return void (await replace(event, SENT));
    const from = await getWallet(fromId, viewer);
    if (!from) return void (await replace(event, GONE));

    const theirs = await walletsOf(draft.to);
    if (theirs.length === 0) {
      await deleteDraft(draft.id);
      return void (await replace(
        event,
        `🙅 ${personLabel(draft.to)} sudah tidak punya dompet, kirimannya dibatalkan.`,
      ));
    }
    await replace(
      event,
      Card({
        children: [
          CardText(
            `💸 Kirim ${formatRupiah(draft.amount)} ke ${personLabel(draft.to)}${draft.note ? ` · ${draft.note}` : ""}\nDari 👛 ${walletLabel(from, viewer)}\n\nMasuk ke dompet ${draft.to} yang mana?`,
          ),
          // Labelled as the recipient sees them: names only, no balances.
          ...walletButtonRows(
            theirs,
            draft.to,
            SEND_TO,
            (w) => `${draft.id}:${from.id}:${w.id}`,
          ),
        ],
      }),
    );
  });

  bot.onAction(SEND_TO, async (event) => {
    const [draftId, fromId, toId] = (event.value ?? "").split(":").map(Number);
    const viewer = personOf(event.user.userId);
    const draft = viewer && (await getDraft(draftId, viewer));
    if (!viewer || !draft) return void (await replace(event, SENT));

    // Keyed by the draft, so a second tap cannot send it twice.
    const sent = await recordPayout({
      id: `send-${draft.id}`,
      sender: viewer,
      to: draft.to,
      fromWalletId: fromId,
      toWalletId: toId,
      amount: draft.amount,
      note: draft.note,
    });
    if (!sent) return void (await replace(event, GONE));
    await deleteDraft(draft.id);
    if (!sent.created) return void (await replace(event, SENT));

    await replace(
      event,
      `💸 Kirim ${formatRupiah(draft.amount)} ke ${personLabel(draft.to)}${draft.note ? ` · ${draft.note}` : ""} ✔️`,
    );
    const told = await notifyPayout(bot, {
      sender: viewer,
      to: draft.to,
      amount: draft.amount,
      label: draft.note,
      from: sent.from,
      into: sent.into,
      incoming: sent.incoming,
    });
    if (!told.received) {
      await reply(
        event,
        `⚠️ Uangnya sudah masuk, tapi aku tidak bisa mengabari ${draft.to} lewat Telegram.`,
      );
    }
  });

  bot.onAction(RECEIVE, async (event) => {
    const [entryId, walletId] = (event.value ?? "").split(":").map(Number);
    const viewer = personOf(event.user.userId);
    const entry = viewer && (await placeEntry(entryId, walletId, viewer));
    if (!viewer || !entry) {
      return void (await replace(event, "✔️ Kiriman ini sudah ditempatkan."));
    }
    const wallet = await getWallet(walletId, viewer);
    if (!wallet) return void (await replace(event, GONE));

    const what = `${entry.note ?? "Kiriman"}: ${formatRupiah(entry.amount)}`;
    await replace(event, `📥 ${what} ✔️`);
    const more = (await getWaitingFor(viewer)).length;
    await reply(
      event,
      [
        `✅ ${what} masuk ke 👛 ${walletLabel(wallet, viewer)} 🎉`,
        balanceLine(wallet, viewer),
        ...(more > 0
          ? [`📥 Masih ada ${more} kiriman menunggu, kirim /terima.`]
          : []),
      ].join("\n"),
    );
  });

  bot.onAction(TRANSFER_FROM, async (event) => {
    const [amount, fromId] = (event.value ?? "").split(":").map(Number);
    const viewer = personOf(event.user.userId);
    if (!viewer) return;
    const wallets = await getWallets(viewer);
    const from = wallets.find((wallet) => wallet.id === fromId);
    if (!from) return void (await replace(event, GONE));

    await replace(
      event,
      Card({
        children: [
          CardText(
            `🔁 Pindah ${formatRupiah(amount)} dari 👛 ${walletLabel(from, viewer)}\n\nKe dompet mana?`,
          ),
          ...walletButtonRows(
            wallets.filter((wallet) => wallet.id !== from.id),
            viewer,
            TRANSFER_TO,
            (w) => `${amount}:${from.id}:${w.id}`,
          ),
        ],
      }),
    );
  });

  bot.onAction(TRANSFER_TO, async (event) => {
    const [amount, fromId, toId] = (event.value ?? "").split(":").map(Number);
    const viewer = personOf(event.user.userId);
    if (!viewer) return;
    const before = await getWallets(viewer);
    const from = before.find((wallet) => wallet.id === fromId);
    const to = before.find((wallet) => wallet.id === toId);
    if (!from || !to || !(amount > 0)) {
      return void (await replace(event, GONE));
    }

    await transfer({ from, to, amount });
    const route = `${walletLabel(from, viewer)} → ${walletLabel(to, viewer)}`;
    await replace(event, `🔁 Pindah ${formatRupiah(amount)}: ${route} ✔️`);

    const after = await getWallets(viewer);
    await reply(
      event,
      [
        `✅ ${formatRupiah(amount)} dipindah: ${route}`,
        ...after
          .filter((wallet) => wallet.id === fromId || wallet.id === toId)
          .map((wallet) => balanceLine(wallet, viewer)),
      ].join("\n"),
    );
  });
}
