import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { ParsedExpense } from "@/lib/ai/parse-expense";
import { isDate, monthRange } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { expenses, wallets, type Expense } from "@/lib/db/schema";
import { telegramIdsOf, visiblePeople, type Person } from "@/lib/people";
import { walletForOwner } from "@/lib/wallets";
import {
  appendExpenses,
  isSheetsConfigured,
  removeExpense,
} from "@/lib/sheets";

export type SheetStatus = "synced" | "skipped" | "failed";

/** Saves to the database (the webapp's source of truth), then mirrors to the spreadsheet. */
export async function recordExpenses(input: {
  userId: string;
  items: ParsedExpense[];
  source: Expense["source"];
  today: string;
}): Promise<{ rows: Expense[]; sheet: SheetStatus }> {
  const db = getDb();
  const batch = crypto.randomUUID().slice(0, 8);
  const rows = await db
    .insert(expenses)
    .values(
      input.items.map((item) => ({
        userId: input.userId,
        batch,
        walletId: item.walletId,
        amount: item.amount,
        category: item.category,
        description: item.description,
        merchant: item.merchant,
        spentOn: isDate(item.date) ? item.date : input.today,
        source: input.source,
      })),
    )
    .returning();

  if (!isSheetsConfigured()) return { rows, sheet: "skipped" };

  try {
    await appendExpenses(rows);
    await db
      .update(expenses)
      .set({ sheetSynced: true })
      .where(
        inArray(
          expenses.id,
          rows.map((row) => row.id),
        ),
      );
    return { rows, sheet: "synced" };
  } catch (error) {
    console.error("Gagal sinkron ke Google Sheets", error);
    return { rows, sheet: "failed" };
  }
}

/**
 * Rows a person may see: their own, the shared ones, and the ones they sent
 * that have no owner yet.
 */
function visibleTo(viewer: Person) {
  const sentByViewer = telegramIdsOf(viewer);
  return or(
    inArray(expenses.owner, visiblePeople(viewer)),
    and(
      isNull(expenses.owner),
      sentByViewer.length > 0
        ? inArray(expenses.userId, sentByViewer)
        : sql`false`,
    ),
  )!;
}

/** A wallet's id, "none" for expenses without a wallet, or undefined for all. */
export type WalletFilter = number | "none" | undefined;

function paidFrom(wallet: WalletFilter) {
  if (wallet === undefined) return undefined;
  return wallet === "none"
    ? isNull(expenses.walletId)
    : eq(expenses.walletId, wallet);
}

function inMonth(month: string, viewer: Person, wallet?: WalletFilter) {
  const { start, end } = monthRange(month);
  return and(
    gte(expenses.spentOn, start),
    lt(expenses.spentOn, end),
    visibleTo(viewer),
    paidFrom(wallet),
  );
}

/** With a viewer, only deletes a row that viewer may see. */
export async function deleteExpense(
  id: number,
  viewer?: Person,
): Promise<Expense | null> {
  const [row] = await getDb()
    .delete(expenses)
    .where(and(eq(expenses.id, id), viewer ? visibleTo(viewer) : undefined))
    .returning();
  if (!row) return null;

  if (row.sheetSynced && isSheetsConfigured()) {
    try {
      await removeExpense(row.id);
    } catch (error) {
      console.error("Gagal menghapus baris di Google Sheets", error);
    }
  }
  return row;
}

/**
 * Changes the owner, moving the expense to their matching wallet or to none.
 * The viewer can only touch rows they see and hand them to people they see.
 */
export async function setOwner(
  id: number,
  owner: Person | null,
  viewer: Person,
) {
  if (owner && !visiblePeople(viewer).includes(owner)) return;

  const db = getDb();
  const [[expense], all] = await Promise.all([
    db
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, id), visibleTo(viewer))),
    db.select().from(wallets),
  ]);
  if (!expense) return;

  const walletId = walletForOwner(all, expense.walletId, owner)?.id ?? null;
  await db.update(expenses).set({ owner, walletId }).where(eq(expenses.id, id));
}

/** Assigns every expense recorded from one message. */
export async function setBatchOwner(
  batch: string,
  owner: Person,
): Promise<Expense[]> {
  const rows = await getDb()
    .update(expenses)
    .set({ owner })
    .where(eq(expenses.batch, batch))
    .returning();
  return rows.sort((a, b) => a.id - b.id);
}

/** Sets the paying wallet, which must belong to the expense's owner. */
export async function setWallet(
  id: number,
  walletId: number | null,
  viewer: Person,
) {
  const db = getDb();
  const [expense] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, id), visibleTo(viewer)));
  if (!expense) return;

  if (walletId !== null) {
    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.id, walletId));
    if (!wallet || wallet.owner !== expense.owner) return;
  }
  await db.update(expenses).set({ walletId }).where(eq(expenses.id, id));
}

/** Sets the paying wallet for every expense recorded from one message. */
export async function setBatchWallet(
  batch: string,
  walletId: number | null,
): Promise<Expense[]> {
  const rows = await getDb()
    .update(expenses)
    .set({ walletId })
    .where(eq(expenses.batch, batch))
    .returning();
  return rows.sort((a, b) => a.id - b.id);
}

export async function getBatch(batch: string): Promise<Expense[]> {
  return getDb()
    .select()
    .from(expenses)
    .where(eq(expenses.batch, batch))
    .orderBy(expenses.id);
}

export async function getLastExpense(userId: string): Promise<Expense | null> {
  const [row] = await getDb()
    .select()
    .from(expenses)
    .where(eq(expenses.userId, userId))
    .orderBy(desc(expenses.id))
    .limit(1);
  return row ?? null;
}

/** What the viewer may see for dates in [start, end), oldest first. */
export async function getExpensesBetween(
  start: string,
  end: string,
  viewer: Person,
): Promise<Expense[]> {
  return getDb()
    .select()
    .from(expenses)
    .where(
      and(
        gte(expenses.spentOn, start),
        lt(expenses.spentOn, end),
        visibleTo(viewer),
      ),
    )
    .orderBy(expenses.spentOn, expenses.id);
}

const total = sql<number>`coalesce(sum(${expenses.amount}), 0)::float8`;

/** Sum and count of what the viewer may see, for dates in [start, end). */
export async function getTotal(
  start: string,
  end: string,
  viewer: Person,
  wallet?: WalletFilter,
) {
  const [row] = await getDb()
    .select({ total, count: sql<number>`count(*)::int` })
    .from(expenses)
    .where(
      and(
        gte(expenses.spentOn, start),
        lt(expenses.spentOn, end),
        visibleTo(viewer),
        paidFrom(wallet),
      ),
    );
  return row;
}

export async function getMonthByCategory(
  month: string,
  viewer: Person,
  wallet?: WalletFilter,
) {
  return getDb()
    .select({ category: expenses.category, total })
    .from(expenses)
    .where(inMonth(month, viewer, wallet))
    .groupBy(expenses.category)
    .orderBy(desc(total));
}

export async function getMonthByDay(
  month: string,
  viewer: Person,
  wallet?: WalletFilter,
) {
  return getDb()
    .select({ date: expenses.spentOn, total })
    .from(expenses)
    .where(inMonth(month, viewer, wallet))
    .groupBy(expenses.spentOn);
}

export async function getMonthExpenses(
  month: string,
  viewer: Person,
  wallet?: WalletFilter,
): Promise<Expense[]> {
  return getDb()
    .select()
    .from(expenses)
    .where(inMonth(month, viewer, wallet))
    .orderBy(desc(expenses.spentOn), desc(expenses.id));
}

export async function getMonthByOwner(
  month: string,
  viewer: Person,
  wallet?: WalletFilter,
) {
  return getDb()
    .select({ owner: expenses.owner, total })
    .from(expenses)
    .where(inMonth(month, viewer, wallet))
    .groupBy(expenses.owner)
    .orderBy(desc(total));
}

export async function getMonthByWallet(month: string, viewer: Person) {
  return getDb()
    .select({ wallet: wallets.name, owner: wallets.owner, total })
    .from(expenses)
    .leftJoin(wallets, eq(wallets.id, expenses.walletId))
    .where(inMonth(month, viewer))
    .groupBy(wallets.id, wallets.name, wallets.owner)
    .orderBy(desc(total));
}

/** One row per month and owner, newest month first. */
export async function getMonthlyTotalsByOwner(viewer: Person) {
  const month = sql<string>`to_char(${expenses.spentOn}, 'YYYY-MM')`;
  return getDb()
    .select({
      month,
      owner: expenses.owner,
      total,
      count: sql<number>`count(*)::int`,
    })
    .from(expenses)
    .where(visibleTo(viewer))
    .groupBy(month, expenses.owner)
    .orderBy(desc(month));
}

export async function getAllTimeByCategory(viewer: Person) {
  return getDb()
    .select({ category: expenses.category, total })
    .from(expenses)
    .where(visibleTo(viewer))
    .groupBy(expenses.category)
    .orderBy(desc(total));
}
