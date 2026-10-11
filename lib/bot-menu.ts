import type { Person } from "@/lib/people";
import { othersOf, personLabel } from "@/lib/people";

/**
 * The buttons under the message box. Telegram sends a tapped button's label
 * as an ordinary message, so each one is recognised by its words.
 */
const MENU = [
  ["🔎 Cek", "👛 Dompet", "💵 Masuk"],
  ["🔁 Pindah", "💸 Kirim", "➕ Dompet baru"],
  ["🗑️ Hapus", "❓ Bantuan"],
];

export type MenuKey =
  | "cek"
  | "dompet"
  | "masuk"
  | "pindah"
  | "kirim"
  | "dompet baru"
  | "hapus"
  | "bantuan"
  | "batal";

const KEYS: MenuKey[] = [
  "cek",
  "dompet",
  "masuk",
  "pindah",
  "kirim",
  "dompet baru",
  "hapus",
  "bantuan",
  "batal",
];

/** The menu button a message is, by its words alone: emoji vary by device. */
export function menuKey(text: string): MenuKey | null {
  const words = text
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .trim();
  return KEYS.find((key) => key === words) ?? null;
}

/** The buttons that need more typed after them, and the command that gets it. */
export const FOLLOW_UPS = {
  masuk: { command: "/masuk", prefix: "" },
  pindah: { command: "/pindah", prefix: "" },
  kirim: { command: "/kirim", prefix: "" },
  "dompet baru": { command: "/dompet", prefix: "tambah " },
} as const;
export type FollowUp = keyof typeof FOLLOW_UPS;

export function isFollowUp(key: unknown): key is FollowUp {
  return typeof key === "string" && key in FOLLOW_UPS;
}

/** What to ask after such a button is tapped. */
export function followUpPrompt(key: FollowUp, viewer: Person): string {
  const [other] = othersOf(viewer);
  const ask = {
    masuk:
      "💵 Pemasukan berapa? Ketik jumlah dan catatannya, misalnya:\n5jt gaji",
    pindah: "🔁 Pindah berapa? Ketik jumlahnya, misalnya:\n500rb",
    kirim: `💸 Kirim berapa ke ${personLabel(other ?? null)}? Ketik jumlah dan catatannya, misalnya:\n500rb bagi hasil`,
    "dompet baru":
      "➕ Dompet baru: ketik nama dan saldo awalnya, misalnya:\nBCA 1,5jt",
  }[key];
  return `${ask}\n\n(ketik batal kalau tidak jadi)`;
}

// Bump when MENU changes, so everyone gets the new buttons once.
const KEYBOARD_VERSION = "2";
export const keyboardKey = (userId: string) => `keyboard:${userId}`;
export { KEYBOARD_VERSION };

/**
 * Puts the menu under the message box. The chat adapter only knows buttons
 * attached to a message, so this one goes to Telegram directly. In a private
 * chat the chat id is the user's id.
 */
export async function showKeyboard(userId: string): Promise<boolean> {
  const response = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: userId,
        text: "⌨️ Tombol menu di bawah kolom ketik sudah diperbarui. Pengeluaran tetap tinggal diketik seperti biasa.",
        reply_markup: {
          keyboard: MENU.map((row) => row.map((text) => ({ text }))),
          resize_keyboard: true,
          is_persistent: true,
          input_field_placeholder: "makan siang 25rb",
        },
      }),
    },
  );
  return response.ok;
}
