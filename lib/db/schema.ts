import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const wallets = pgTable("wallets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // One of PEOPLE.
  owner: text("owner").notNull(),
  // Whole rupiah. The balance is this plus entries minus expenses.
  initialBalance: bigint("initial_balance", { mode: "number" })
    .notNull()
    .default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Money moving in or out of a wallet other than by an expense. */
export const walletEntries = pgTable("wallet_entries", {
  id: serial("id").primaryKey(),
  // Null while money that came in still waits for its wallet.
  walletId: integer("wallet_id").references(() => wallets.id, {
    onDelete: "cascade",
  }),
  // Who gets to pick the wallet of a waiting entry.
  recipient: text("recipient"),
  // Set while a person-to-person send waits for the sender to pick the source
  // wallet; the intended recipient cannot see it yet.
  draftFor: text("draft_for"),
  // Positive for money in, negative for money out (the sending side of a transfer).
  amount: bigint("amount", { mode: "number" }).notNull(),
  kind: text("kind", { enum: ["income", "transfer"] }).notNull(),
  note: text("note"),
  // Set on entries made by another app, so a repeated request is recorded
  // once and both sides of it can be found again: "payout:<id>:out" | ":in".
  ref: text("ref").unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const expenses = pgTable(
  "expenses",
  {
    id: serial("id").primaryKey(),
    // Telegram user who sent it; not necessarily who it belongs to.
    userId: text("user_id").notNull(),
    // One of PEOPLE, or null until picked with the bot's buttons.
    owner: text("owner"),
    // The wallet that paid, or null until picked.
    walletId: integer("wallet_id").references(() => wallets.id, {
      onDelete: "set null",
    }),
    // Groups the expenses recorded from a single message.
    batch: text("batch"),
    // Whole rupiah, no decimals.
    amount: bigint("amount", { mode: "number" }).notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    merchant: text("merchant"),
    // Local calendar date of the expense (APP_TIMEZONE), as YYYY-MM-DD.
    spentOn: date("spent_on", { mode: "string" }).notNull(),
    source: text("source", { enum: ["text", "receipt"] }).notNull(),
    sheetSynced: boolean("sheet_synced").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("expenses_spent_on_idx").on(table.spentOn)],
);

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
export type Wallet = typeof wallets.$inferSelect;
export type WalletEntry = typeof walletEntries.$inferSelect;
