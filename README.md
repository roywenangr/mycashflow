# MyCashflow

Bot Telegram pencatat pengeluaran. Kirim teks bebas ("makan siang 25rb") atau foto struk; AI mengekstrak nominal dan kategori, lalu data disimpan ke database (untuk dashboard web) dan ditambahkan ke Google Sheets.

## Alur

1. Telegram → `app/api/webhooks/telegram` (webhook saat deploy, long polling saat `npm run dev:bot`)
2. `lib/bot.ts` → `lib/ai/parse-expense.ts` (AI SDK dengan Gemini API)
3. `lib/expenses.ts` menyimpan ke Neon Postgres, lalu `lib/sheets.ts` menambah baris ke spreadsheet
4. `app/page.tsx` menampilkan dashboard dari database

## Setup

Salin `.env.example` untuk melihat variabel yang dibutuhkan; nilainya disimpan di `.env.local`.

1. **Database** — `npx vercel integration add neon`, lalu `npx vercel env pull .env.local` dan `npm run db:migrate` (setelah mengubah `lib/db/schema.ts`: `npm run db:generate` dulu).
2. **AI** — buat API key gratis di [Google AI Studio](https://aistudio.google.com/apikey), isi `GOOGLE_GENERATIVE_AI_API_KEY`.
3. **Telegram** — buat bot di [@BotFather](https://t.me/BotFather), isi `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_BOT_USERNAME`. Jalankan `npm run dev:bot`, kirim pesan apa saja ke bot; bot membalas ID Telegram-mu. Isi `TELEGRAM_ALLOWED_USER_IDS` dengan ID itu dan jalankan ulang.
4. **Google Sheets** — buat service account di Google Cloud, aktifkan Google Sheets API, unduh key JSON-nya. Bagikan spreadsheet ke email service account sebagai Editor. Isi `GOOGLE_SHEET_ID` (bagian URL di antara `/d/` dan `/edit`), `GOOGLE_SERVICE_ACCOUNT_EMAIL`, dan `GOOGLE_PRIVATE_KEY`. Bot menulis ke tab pertama.
5. **Dashboard** — isi `DASHBOARD_PASSWORD_YOR` dan `DASHBOARD_PASSWORD_AWLAS` dengan password yang berbeda. Password menentukan siapa yang login.

## Deploy

1. Tambahkan semua variabel di atas plus `TELEGRAM_WEBHOOK_SECRET_TOKEN` (string acak) ke project Vercel.
2. `npx vercel deploy --prod`
3. `npm run telegram:webhook -- https://<domain-kamu>`

`npm run dev` hanya menjalankan dashboard. `npm run dev:bot` juga menjalankan bot secara lokal lewat polling, tapi itu mencabut webhook sehingga bot yang sudah di-deploy berhenti menerima pesan sampai `npm run telegram:webhook` dijalankan lagi.

## Perintah bot

- `/cek` — lihat pengeluaran; pilih rentangnya (hari ini, 1 minggu terakhir, atau pilih bulan), orangnya, lalu dompetnya atau Semua
- `/hapus` — hapus catatan terakhir (juga dari spreadsheet)
- `/dompet` — daftar dompet dan saldonya; `/dompet tambah BCA 1,5jt`; `/dompet hapus`
- `/masuk 5jt gaji` — catat pemasukan ke sebuah dompet
- `/pindah 500rb` — pindah dana antar dompetmu sendiri
- `/kirim 500rb bagi hasil` — kirim uang ke orang lain; penerima dikabari bot dan memilih dompet tujuannya

Semua perintah juga tersedia sebagai tombol di bawah kolom ketik (dikirim bot otomatis sekali per orang). Tombol yang butuh angka — Masuk, Pindah, Kirim, Dompet baru — menanyakan dulu, lalu ketikan berikutnya dipakai sebagai isinya (berlaku 5 menit, `batal` untuk membatalkan).

## Orang dan dompet

Yor dan Awlas disekat: masing-masing hanya melihat dan mengubah data miliknya dan data Kita, baik di bot (dari akun Telegram, lewat `TELEGRAM_USER_PEOPLE`) maupun di dashboard (dari password login). Sekat ini diterapkan di query (`visibleTo` di `lib/expenses.ts`, `getWallets(viewer)` di `lib/wallets.ts`), bukan hanya di tampilan.

Tiap pengeluaran punya pemilik (`lib/people.ts`: Yor, Awlas, Kita) dan dompet yang membayarnya. `TELEGRAM_USER_PEOPLE` memetakan akun Telegram ke orangnya, supaya bot hanya menawarkan dompet milik pengirim dan dompet Kita. Saldo dompet = saldo awal + pemasukan dan pindah dana − pengeluaran, selalu dihitung ulang dari data.

## Sinkron dengan app bagi hasil (cashflowshit)

App bagi hasil membaca dompet dan saldo dari bot ini, dan mengabari bot saat payout ditandai dibayar:

- `GET /api/sync/wallets` — dompet dan saldo milik pemanggil, plus nama dompet orang yang dibayarnya (tanpa saldo).
- `POST /api/sync/payouts` — `{ id, amount, label, fromWalletId, toWalletId }`. Saldo dompet asal dipotong, masuk ke dompet tujuan (atau menunggu dipilih penerima kalau `toWalletId` null), dan kedua orang dikabari lewat Telegram. Aman diulang: `id` yang sama hanya dicatat sekali.
- `DELETE /api/sync/payouts` — `{ ids, label }`. Membatalkan payout di kedua sisi.

Semuanya memakai `Authorization: Bearer <SYNC_TOKEN_YOR>` dan hanya menerima panggilan browser dari `SYNC_ALLOWED_ORIGINS` (default `https://cashflowshit.vercel.app`). Token diisi di cashflowshit: Pengaturan → Bot Telegram.
