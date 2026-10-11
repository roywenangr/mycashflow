import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { z } from "zod";
import { CATEGORIES } from "@/lib/categories";

// Flash-Lite answers in 1-2s; the full Flash alias took 5s to over 2 minutes
// on the free tier for the same results.
const MODEL = process.env.EXPENSE_MODEL ?? "gemini-flash-lite-latest";

const schema = z.object({
  expenses: z.array(
    z.object({
      amount: z.number().int().positive().describe("Nominal dalam rupiah utuh"),
      category: z.enum(CATEGORIES),
      description: z.string().describe("Deskripsi singkat, huruf kecil"),
      merchant: z.string().nullable().describe("Nama toko/merchant bila ada"),
      date: z
        .string()
        .nullable()
        .describe("Tanggal pengeluaran YYYY-MM-DD, null bila hari ini"),
      walletId: z
        .number()
        .int()
        .nullable()
        .describe("ID dompet yang disebut di pesan, null bila tidak disebut"),
    }),
  ),
  note: z
    .string()
    .nullable()
    .describe("Pesan singkat ke pengguna bila tidak ada yang bisa dicatat"),
});

export type WalletOption = { id: number; label: string };
export type ParsedExpense = z.infer<typeof schema>["expenses"][number];
export type ParseResult = z.infer<typeof schema>;

function systemPrompt(todayDate: string, wallets: WalletOption[]) {
  const walletList = wallets.length
    ? wallets.map((w) => `- ID ${w.id}: ${w.label}`).join("\n")
    : "(belum ada dompet)";

  return `Kamu adalah pencatat pengeluaran pribadi untuk pengguna di Indonesia. Tugasmu mengekstrak pengeluaran dari pesan chat atau foto struk.

Hari ini tanggal ${todayDate}.

Aturan nominal (selalu rupiah utuh):
- "rb", "ribu", "k" = ribuan: "25rb" = 25000, "18k" = 18000, "7,5rb" = 7500.
- "jt", "juta" = jutaan: "1,5jt" = 1500000.
- Bahasa gaul: "goceng" = 5000, "ceban" = 10000, "goban" = 50000, "cepek" = 100000, "gopek" = 500, "seceng" = 1000.
- Angka polos tanpa satuan dipakai apa adanya: "25000" = 25000.

Dompet yang tersedia:
${walletList}

Aturan dompet:
- Isi walletId hanya bila pesan menyebut salah satu dompet di daftar ("pakai bca", "via blu", "kopi 20rb seabank"). Cocokkan tanpa membedakan huruf besar/kecil.
- Bila tidak ada dompet yang disebut, atau yang disebut tidak ada di daftar, isi null. Jangan menebak.
- Nama dompet bukan merchant dan bukan bagian deskripsi.

Aturan pencatatan:
- Satu pesan boleh berisi beberapa pengeluaran ("makan 25rb, parkir 2rb"): catat masing-masing.
- Untuk foto struk: catat SATU pengeluaran dengan total akhir yang dibayar (setelah pajak/diskon), merchant dari kop struk, dan tanggal dari struk bila terbaca. Deskripsi merangkum isi belanja.
- Bila pengguna menyertakan caption pada foto struk, pakai sebagai petunjuk deskripsi/kategori.
- Tanggal: null berarti hari ini. Isi hanya bila pengguna menyebut waktu lain ("kemarin", "tgl 5") atau tertera di struk.
- Pilih kategori yang paling cocok; pakai "Lainnya" bila ragu.
- Jangan mengarang nominal. Bila pesan bukan pengeluaran atau nominalnya tidak jelas, kembalikan expenses kosong dan isi note dengan penjelasan singkat dalam bahasa Indonesia santai, pakai satu-dua emoji.`;
}

export async function parseExpense(input: {
  text: string;
  images: Uint8Array[];
  today: string;
  wallets: WalletOption[];
}): Promise<ParseResult> {
  const { output } = await generateText({
    model: google(MODEL),
    system: systemPrompt(input.today, input.wallets),
    output: Output.object({ schema }),
    // Fail with an apology rather than leave the chat hanging.
    abortSignal: AbortSignal.timeout(25_000),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: input.text || "(foto struk tanpa caption)",
          },
          ...input.images.map((data) => ({
            type: "file" as const,
            mediaType: "image",
            data,
          })),
        ],
      },
    ],
  });
  return output;
}
