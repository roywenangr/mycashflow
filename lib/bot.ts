import { createPostgresState } from "@chat-adapter/state-pg";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import {
  Actions,
  Button,
  Card,
  CardText,
  Chat,
  type ActionEvent,
  type Message,
  type Thread,
} from "chat";
import { parseExpense } from "@/lib/ai/parse-expense";
import {
  incomeCommand,
  receiveCommand,
  sendCommand,
  registerWalletActions,
  transferCommand,
  WALLET_HELP,
  walletButtonRows,
  walletCommand,
} from "@/lib/bot-wallets";
import {
  followUpPrompt,
  FOLLOW_UPS,
  isFollowUp,
  KEYBOARD_VERSION,
  keyboardKey,
  menuKey,
  showKeyboard,
} from "@/lib/bot-menu";
import { isPeriod, periodDetail, periodInfo, recentMonths } from "@/lib/check";
import { formatDay, formatMonth, shiftDay, today } from "@/lib/dates";
import {
  deleteExpense,
  getLastExpense,
  getTotal,
  recordExpenses,
  setBatchOwner,
  setBatchWallet,
} from "@/lib/expenses";
import type { Expense } from "@/lib/db/schema";
import { formatRupiah } from "@/lib/format";
import { categoryLabel } from "@/lib/categories";
import {
  isPerson,
  type Person,
  personLabel,
  personOf,
  visiblePeople,
} from "@/lib/people";
import {
  getWallet,
  getWallets,
  walletForOwner,
  walletLabel,
} from "@/lib/wallets";

const HELP = `✍️ Kirim pengeluaranmu dengan bahasa bebas, misalnya:
🍜 makan siang 25rb
🛵 grab ke kantor 18k pakai bca
💡 kemarin bayar listrik 350rb

📸 Atau kirim foto struk, nanti kubaca totalnya.
👆 Setelah tercatat, pilih pemiliknya lewat tombol (kamu atau ${personLabel("Kita")}), lalu pilih dompetnya

⌨️ Semua perintah di bawah ini juga ada sebagai tombol di bawah kolom ketik.

Perintah:
🔎 /cek — lihat pengeluaran: hari ini, 1 minggu terakhir, atau pilih bulan
🗑️ /hapus — hapus catatan terakhir
${WALLET_HELP}`;

function createBot() {
  const bot = new Chat({
    userName: process.env.TELEGRAM_BOT_USERNAME ?? "mycashflow_bot",
    adapters: {
      telegram: createTelegramAdapter({
        // Polling is the opt-in local mode; see instrumentation.ts.
        mode: process.env.TELEGRAM_POLLING === "1" ? "polling" : "webhook",
      }),
    },
    state: createPostgresState(),
    // Don't lose expenses sent while a previous one is still being parsed.
    concurrency: "queue",
  });

  bot.onDirectMessage(async (thread, message, _channel, context) => {
    for (const queued of [...(context?.skipped ?? []), message]) {
      try {
        await handleMessage(bot, thread, queued);
      } catch (error) {
        console.error("Gagal memproses pesan", error);
        await thread.post(
          "😵‍💫 Maaf, ada gangguan saat mencatat. Coba kirim lagi sebentar lagi ya 🙏",
        );
      }
    }
  });

  // Telegram delivers /commands here, never to onDirectMessage.
  bot.onSlashCommand(async (event) => {
    try {
      await event.channel.post(
        await runCommand(event.command, event.text, event.user.userId),
      );
      await ensureKeyboard(bot, event.user.userId);
    } catch (error) {
      console.error("Gagal memproses perintah", error);
      await event.channel.post(
        "😵‍💫 Maaf, ada gangguan saat memproses perintah. Coba lagi sebentar lagi ya 🙏",
      );
    }
  });

  bot.onAction(OWNER_ACTION, async (event) => {
    const [owner, batch] = (event.value ?? "").split(":");
    const viewer = personOf(event.user.userId);
    // A person can only file expenses under themselves or the shared bucket.
    if (!viewer || !isPerson(owner) || !batch) return;
    if (!visiblePeople(viewer).includes(owner)) return;

    const rows = await setBatchOwner(batch, owner);
    if (rows.length === 0) {
      await event.adapter.postMessage(
        event.threadId,
        "🫥 Catatan ini sudah dihapus.",
      );
      return;
    }

    try {
      await event.adapter.editMessage(
        event.threadId,
        event.messageId,
        await recordedCard(rows),
      );
    } catch (error) {
      // Telegram rejects an edit that changes nothing (same owner tapped again).
      console.warn("Gagal memperbarui pesan catatan", error);
    }

    await event.adapter.postMessage(
      event.threadId,
      await walletPrompt(rows, owner),
    );
  });

  bot.onAction(WALLET_ACTION, async (event) => {
    const [walletId, batch] = (event.value ?? "").split(":");
    const viewer = personOf(event.user.userId);
    const wallet = viewer && (await getWallet(Number(walletId), viewer));
    if (!wallet || !batch) {
      await event.adapter.postMessage(
        event.threadId,
        "🫥 Dompet itu sudah tidak ada.",
      );
      return;
    }

    const rows = await setBatchWallet(batch, wallet.id);
    if (rows.length === 0) {
      await event.adapter.postMessage(
        event.threadId,
        "🫥 Catatan ini sudah dihapus.",
      );
      return;
    }

    const expenseOwner = rows[0].owner;
    if (!isPerson(expenseOwner)) return;
    try {
      await event.adapter.editMessage(
        event.threadId,
        event.messageId,
        await walletPrompt(rows, expenseOwner),
      );
    } catch (error) {
      // Telegram rejects an edit that changes nothing (same wallet tapped again).
      console.warn("Gagal memperbarui pilihan dompet", error);
    }

    // Re-read for the balance after this expense.
    const updated = (await getWallet(wallet.id)) ?? wallet;
    await event.adapter.postMessage(
      event.threadId,
      `👛 Sip, dibayar pakai ${updated.name} ✨\n💰 Sisa saldo: ${formatRupiah(updated.balance)}`,
    );
  });

  registerWalletActions(bot);

  bot.onAction(DELETE_LAST_ACTION, async (event) => {
    const viewer = personOf(event.user.userId);
    if (!viewer) return;
    let message = "👍 Batal, tidak ada yang dihapus.";
    if (event.value) {
      const gone = await deleteExpense(Number(event.value), viewer);
      message = gone
        ? `🗑️ Dihapus: ${describe(gone)}`
        : "🫥 Catatan itu sudah tidak ada.";
    }
    try {
      await event.adapter.editMessage(event.threadId, event.messageId, message);
    } catch (error) {
      console.warn("Gagal memperbarui pesan hapus", error);
    }
  });

  // "Pilih bulan" on /cek: the recent months to choose from.
  bot.onAction(CHECK_MONTHS_ACTION, async (event) => {
    if (!personOf(event.user.userId)) return;
    const months = recentMonths();
    const rows = [];
    for (let i = 0; i < months.length; i += 2) {
      rows.push(
        Actions(
          months.slice(i, i + 2).map((month) =>
            Button({
              id: CHECK_PERIOD_ACTION,
              value: month,
              label: formatMonth(month),
            }),
          ),
        ),
      );
    }
    await event.adapter.postMessage(
      event.threadId,
      Card({ children: [CardText("📆 Bulan yang mana?"), ...rows] }),
    );
  });

  // Step two of /cek: whose expenses.
  bot.onAction(CHECK_PERIOD_ACTION, async (event) => {
    const period = event.value;
    const viewer = personOf(event.user.userId);
    if (!viewer) return;
    if (!isPeriod(period)) return void (await expired(event));
    await event.adapter.postMessage(
      event.threadId,
      Card({
        children: [
          CardText(`👀 Pengeluaran ${periodInfo(period).label}, punya siapa?`),
          Actions(
            visiblePeople(viewer).map((who) =>
              Button({
                id: CHECK_PERSON_ACTION,
                value: `${period}:${who}`,
                label: personLabel(who),
              }),
            ),
          ),
        ],
      }),
    );
  });

  // Step three: the picked person's wallets, or everything.
  bot.onAction(CHECK_PERSON_ACTION, async (event) => {
    const [period, who] = (event.value ?? "").split(":");
    const viewer = personOf(event.user.userId);
    if (!viewer) return;
    if (!isPeriod(period)) return void (await expired(event));
    if (!isPerson(who) || !visiblePeople(viewer).includes(who)) return;

    const wallets = (await getWallets(viewer)).filter((w) => w.owner === who);
    await event.adapter.postMessage(
      event.threadId,
      // Without wallets there is nothing to choose between.
      wallets.length === 0
        ? await periodDetail(period, viewer, who)
        : Card({
            children: [
              CardText(
                `👀 Pengeluaran ${personLabel(who)} ${periodInfo(period).label}, dari dompet mana?`,
              ),
              ...walletButtonRows(
                wallets,
                who,
                CHECK_ACTION,
                (w) => `${period}:${who}:${w.id}`,
              ),
              Actions([
                Button({
                  id: CHECK_ACTION,
                  value: `${period}:${who}:${ALL}`,
                  label: "👥 Semua dompet",
                }),
              ]),
            ],
          }),
    );
  });

  bot.onAction(CHECK_ACTION, async (event) => {
    const [period, who, wallet] = (event.value ?? "").split(":");
    const viewer = personOf(event.user.userId);
    if (!viewer) return;
    if (!isPeriod(period)) return void (await expired(event));
    if (!isPerson(who) || !visiblePeople(viewer).includes(who)) return;
    await event.adapter.postMessage(
      event.threadId,
      await periodDetail(
        period,
        viewer,
        who,
        wallet === ALL ? undefined : Number(wallet),
      ),
    );
  });

  return bot;
}

const OWNER_ACTION = "owner";
const WALLET_ACTION = "wallet";
// Fresh ids, so buttons from /hariini, which /cek replaced, go quiet.
const DELETE_LAST_ACTION = "dl";
const CHECK_PERIOD_ACTION = "cp";
const CHECK_MONTHS_ACTION = "cm";
const CHECK_PERSON_ACTION = "cw";
const CHECK_ACTION = "cd";
const ALL = "all";

/** Answers a tap on a /cek button from before its choices changed. */
function expired(event: ActionEvent) {
  return event.adapter.postMessage(
    event.threadId,
    "⌛ Tombol ini sudah tidak berlaku. Kirim /cek lagi ya.",
  );
}

/** The confirmation for one message's expenses, with the owner buttons. */
async function recordedCard(rows: Expense[], warning?: string) {
  const date = today();
  const { owner, batch } = rows[0];
  const lines = rows.map((row) => {
    const merchant = row.merchant ? ` @ ${row.merchant}` : "";
    const when = row.spentOn === date ? "" : ` (${formatDay(row.spentOn)})`;
    return `✅ ${formatRupiah(row.amount)} · ${categoryLabel(row.category)}\n📝 ${row.description}${merchant}${when}`;
  });
  lines.push(owner ? `Punya ${personLabel(owner)}` : "🤔 Punya siapa nih?");
  // Whoever sent the message decides who it can belong to.
  const viewer = personOf(rows[0].userId);
  if (viewer) lines.push(await todaySummary(viewer));
  if (warning) lines.push(warning);

  return Card({
    children: [
      CardText(lines.join("\n\n")),
      Actions(
        (viewer ? visiblePeople(viewer) : []).map((person) =>
          Button({
            id: OWNER_ACTION,
            // Telegram caps callback data at 64 bytes; the batch id keeps it short.
            value: `${person}:${batch}`,
            label: person === owner ? `✅ ${person}` : personLabel(person),
          }),
        ),
      ),
    ],
  });
}

/**
 * The step after picking an owner: that person's wallets to pay from.
 * A wallet named in the message is kept when it is theirs, swapped for their
 * wallet of the same name when it is someone else's, and dropped otherwise.
 */
async function walletPrompt(rows: Expense[], owner: Person) {
  const batch = rows[0].batch!;
  const all = await getWallets();
  const mine = all.filter((wallet) => wallet.owner === owner);
  const chosen = walletForOwner(all, rows[0].walletId, owner);
  if ((chosen?.id ?? null) !== rows[0].walletId) {
    await setBatchWallet(batch, chosen?.id ?? null);
  }

  const what = rows
    .map((row) => `${formatRupiah(row.amount)} · ${row.description}`)
    .join(", ");
  const head = `👌 Sip, dicatat punya ${personLabel(owner)}: ${what} ✨`;
  if (mine.length === 0) {
    return `${head}\n\n👛 ${owner} belum punya dompet. Tambah dengan /dompet tambah`;
  }

  // Re-read so the balance reflects a wallet that was just swapped in.
  const paid = chosen && (await getWallet(chosen.id));
  return Card({
    children: [
      CardText(
        paid
          ? `${head}\n\n👛 Dibayar pakai ${paid.name}\n💰 Sisa saldo: ${formatRupiah(paid.balance)}\n\nSalah dompet? Ganti lewat tombol:`
          : `${head}\n\n👛 Bayar pakai dompet apa?`,
      ),
      ...walletButtonRows(
        mine,
        owner,
        WALLET_ACTION,
        (w) => `${w.id}:${batch}`,
        chosen?.id,
      ),
    ],
  });
}

// The adapter drops everyone outside TELEGRAM_ALLOWED_USER_IDS. Until that is
// set the bot is open to the public, so only hand out the setup hint.
function setupHint(userId: string): string | null {
  if (process.env.TELEGRAM_ALLOWED_USER_IDS) return null;
  return `Bot belum dikunci ke pemiliknya.\n\nID Telegram kamu: ${userId}\n\nTambahkan TELEGRAM_ALLOWED_USER_IDS=${userId} ke environment variables, lalu jalankan ulang bot.`;
}

const UNKNOWN_ACCOUNT =
  "🙅 Akun Telegram ini belum terdaftar sebagai salah satu orang di TELEGRAM_USER_PEOPLE.";

async function runCommand(command: string, args: string, userId: string) {
  const hint = setupHint(userId);
  if (hint) return hint;
  const viewer = personOf(userId);
  if (!viewer) return UNKNOWN_ACCOUNT;

  switch (command.toLowerCase()) {
    case "/start":
    case "/help":
      return `👋 Halo! Aku pencatat pengeluaranmu 💸\n\n${HELP}`;
    case "/cek":
    // The commands /cek replaced still open it.
    case "/hariini":
    case "/bulanini":
      return Card({
        children: [
          CardText("🔎 Mau cek pengeluaran yang mana?"),
          // One per row: three long labels would be cut off side by side.
          Actions([
            Button({
              id: CHECK_PERIOD_ACTION,
              value: "d",
              label: "📅 Hari ini",
            }),
          ]),
          Actions([
            Button({
              id: CHECK_PERIOD_ACTION,
              value: "w",
              label: "🗓️ 1 minggu terakhir",
            }),
          ]),
          Actions([
            Button({ id: CHECK_MONTHS_ACTION, label: "📆 Pilih bulan" }),
          ]),
        ],
      });
    case "/hapus":
      return deleteLast(userId);
    case "/dompet":
      return walletCommand(args, viewer);
    case "/masuk":
      return incomeCommand(args, viewer);
    case "/pindah":
      return transferCommand(args, viewer);
    case "/kirim":
      return sendCommand(args, viewer);
    case "/terima":
      return receiveCommand(viewer);
    default:
      return `🤷 Perintah ${command} tidak kukenal.\n\n${HELP}`;
  }
}

/** How long a menu button waits for the amount typed after it. */
const FOLLOW_UP_MS = 5 * 60 * 1000;
const followUpKey = (userId: string) => `followup:${userId}`;

/** Sends the menu buttons to someone who doesn't have this version yet. */
async function ensureKeyboard(bot: Chat, userId: string) {
  if (setupHint(userId) || !personOf(userId)) return;
  try {
    const state = bot.getState();
    if ((await state.get(keyboardKey(userId))) === KEYBOARD_VERSION) return;
    if (await showKeyboard(userId)) {
      await state.set(keyboardKey(userId), KEYBOARD_VERSION);
    }
  } catch (error) {
    console.error("Gagal memasang tombol menu", error);
  }
}

/** Asks before deleting: a menu button is easy to tap by accident. */
async function confirmDeleteLast(userId: string) {
  const last = await getLastExpense(userId);
  if (!last) return "🤷 Belum ada catatan yang bisa dihapus.";
  return Card({
    children: [
      CardText(`🗑️ Hapus catatan terakhir?\n\n${describe(last)}`),
      Actions([
        Button({
          id: DELETE_LAST_ACTION,
          value: String(last.id),
          label: "🗑️ Ya, hapus",
        }),
        Button({ id: DELETE_LAST_ACTION, label: "Batal" }),
      ]),
    ],
  });
}

/**
 * A tap on a menu button, or the amount typed after one. Returns false when
 * the message is neither, so it is read as an expense.
 */
async function handleMenu(
  bot: Chat,
  thread: Thread,
  text: string,
  userId: string,
  viewer: Person,
): Promise<boolean> {
  const state = bot.getState();
  const key = menuKey(text);
  const waiting = await state.get(followUpKey(userId));
  if (waiting) await state.delete(followUpKey(userId));

  if (key === "batal") {
    await thread.post(
      waiting ? "👍 Oke, batal." : "👍 Tidak ada yang perlu dibatalkan.",
    );
  } else if (isFollowUp(key)) {
    await state.set(followUpKey(userId), key, FOLLOW_UP_MS);
    await thread.post(followUpPrompt(key, viewer));
  } else if (key === "hapus") {
    await thread.post(await confirmDeleteLast(userId));
  } else if (key) {
    const command = key === "bantuan" ? "/help" : `/${key}`;
    await thread.post(await runCommand(command, "", userId));
  } else if (isFollowUp(waiting)) {
    const { command, prefix } = FOLLOW_UPS[waiting];
    await thread.post(await runCommand(command, prefix + text, userId));
  } else {
    return false;
  }
  return true;
}

async function handleMessage(bot: Chat, thread: Thread, message: Message) {
  const userId = message.author.userId;

  const hint = setupHint(userId);
  if (hint) {
    await thread.post(hint);
    return;
  }
  const viewer = personOf(userId);
  if (!viewer) {
    await thread.post(UNKNOWN_ACCOUNT);
    return;
  }

  const text = message.text.trim();
  const images: Uint8Array[] = [];
  for (const attachment of message.attachments) {
    if (attachment.type === "image" && attachment.fetchData) {
      images.push(new Uint8Array(await attachment.fetchData()));
    }
  }
  if (!text && images.length === 0) {
    await thread.post(
      `🙈 Aku cuma bisa membaca teks dan foto struk.\n\n${HELP}`,
    );
    return;
  }
  // A photo is always a receipt, whatever button was tapped before it.
  if (
    images.length === 0 &&
    (await handleMenu(bot, thread, text, userId, viewer))
  ) {
    await ensureKeyboard(bot, userId);
    return;
  }

  await thread.startTyping();
  const date = today();
  // The owner is picked after recording, so any wallet the sender can see
  // may be named here.
  const offered = await getWallets(viewer);
  const parsed = await parseExpense({
    text,
    images,
    today: date,
    wallets: offered.map((w) => ({ id: w.id, label: walletLabel(w, null) })),
  });
  // Don't trust an ID the model made up.
  for (const item of parsed.expenses) {
    if (!offered.some((w) => w.id === item.walletId)) item.walletId = null;
  }
  // "bensin 50k via blu, parkir 2rb": one wallet named, so it paid for all.
  const named = new Set(
    parsed.expenses.map((item) => item.walletId).filter((id) => id !== null),
  );
  if (named.size === 1) {
    for (const item of parsed.expenses) item.walletId = [...named][0];
  }

  if (parsed.expenses.length === 0) {
    await thread.post(
      parsed.note ?? "🧐 Aku tidak menemukan pengeluaran di pesan itu.",
    );
    return;
  }

  const { rows, sheet } = await recordExpenses({
    userId,
    items: parsed.expenses,
    source: images.length > 0 ? "receipt" : "text",
    today: date,
  });

  await thread.post(
    await recordedCard(
      rows,
      sheet === "failed"
        ? "⚠️ Tersimpan di webapp, tapi gagal dikirim ke spreadsheet. Cek akses service account ke sheet-nya."
        : undefined,
    ),
  );
  await ensureKeyboard(bot, userId);
}

async function todaySummary(viewer: Person): Promise<string> {
  const date = today();
  const { total, count } = await getTotal(date, shiftDay(date, 1), viewer);
  return `💰 Total hari ini: ${formatRupiah(total)} (${count} transaksi)`;
}

async function deleteLast(userId: string): Promise<string> {
  const last = await getLastExpense(userId);
  if (!last) return "🤷 Belum ada catatan yang bisa dihapus.";
  await deleteExpense(last.id);
  return `🗑️ Dihapus: ${describe(last)}`;
}

function describe(expense: Expense): string {
  return `${formatRupiah(expense.amount)} · ${expense.description} (${formatDay(expense.spentOn)})`;
}

// One instance per process, surviving dev hot reloads so polling isn't doubled.
const globalForBot = globalThis as { __mycashflowBot?: Chat };

export function getBot() {
  if (!globalForBot.__mycashflowBot) globalForBot.__mycashflowBot = createBot();
  return globalForBot.__mycashflowBot;
}
