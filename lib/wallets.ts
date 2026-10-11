import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { getDb } from "@/lib/db";
import { walletEntries, wallets, type Wallet } from "@/lib/db/schema";
import { PEOPLE, visiblePeople, type Person } from "@/lib/people";

export type WalletWithBalance = Wallet & { balance: number };

// Table names are spelled out: drizzle renders interpolated columns
// unqualified here, which would compare wallet_entries.wallet_id to its own id.
const balance = sql<number>`(
  "wallets"."initial_balance"
  + coalesce((select sum(e.amount) from wallet_entries e where e.wallet_id = "wallets"."id"), 0)
  - coalesce((select sum(x.amount) from expenses x where x.wallet_id = "wallets"."id"), 0)
)::float8`;

/**
 * Wallets with their current balance, grouped in PEOPLE order. With a viewer,
 * only that person's own wallets and the shared ones.
 */
export async function getWallets(
  viewer?: Person,
): Promise<WalletWithBalance[]> {
  const rows = await getDb()
    .select({
      id: wallets.id,
      name: wallets.name,
      owner: wallets.owner,
      initialBalance: wallets.initialBalance,
      createdAt: wallets.createdAt,
      balance,
    })
    .from(wallets)
    .where(viewer ? inArray(wallets.owner, visiblePeople(viewer)) : undefined)
    .orderBy(asc(wallets.name));
  const order = (owner: string) => PEOPLE.indexOf(owner as Person);
  return rows.sort((a, b) => order(a.owner) - order(b.owner));
}

export async function getWallet(id: number, viewer?: Person) {
  return (await getWallets(viewer)).find((wallet) => wallet.id === id) ?? null;
}

/** "BCA", or "BCA (Kita)" when it isn't the viewer's own wallet. */
export function walletLabel(
  wallet: { name: string; owner: string },
  viewer: Person | null,
): string {
  return wallet.owner === viewer
    ? wallet.name
    : `${wallet.name} (${wallet.owner})`;
}

/**
 * The wallet an expense should keep once it belongs to `owner`: the current
 * one if it is theirs, their wallet of the same name if it is someone else's,
 * otherwise none.
 */
export function walletForOwner<
  T extends { id: number; name: string; owner: string },
>(all: T[], currentId: number | null, owner: string | null): T | null {
  const current = all.find((wallet) => wallet.id === currentId);
  if (!current || !owner) return null;
  return (
    all.find(
      (wallet) =>
        wallet.owner === owner &&
        wallet.name.toLowerCase() === current.name.toLowerCase(),
    ) ?? null
  );
}

/** Returns null when that person already has a wallet with this name. */
export async function createWallet(input: {
  name: string;
  owner: Person;
  initialBalance: number;
}): Promise<Wallet | null> {
  const db = getDb();
  const [existing] = await db
    .select({ id: wallets.id })
    .from(wallets)
    .where(
      and(
        eq(wallets.owner, input.owner),
        sql`lower(${wallets.name}) = ${input.name.toLowerCase()}`,
      ),
    );
  if (existing) return null;

  const [wallet] = await db.insert(wallets).values(input).returning();
  return wallet;
}

export async function updateWallet(
  id: number,
  changes: Partial<Pick<Wallet, "name" | "owner" | "initialBalance">>,
) {
  await getDb().update(wallets).set(changes).where(eq(wallets.id, id));
}

/** Its expenses stay but lose the wallet; its income and transfers go with it. */
export async function deleteWallet(id: number) {
  await getDb().delete(wallets).where(eq(wallets.id, id));
}

/**
 * Records money coming in. Without a wallet it waits for `recipient` to pick
 * one.
 */
export async function addIncome(input: {
  walletId: number | null;
  amount: number;
  note: string | null;
  recipient?: Person;
}) {
  const [entry] = await getDb()
    .insert(walletEntries)
    .values({ ...input, kind: "income" })
    .returning();
  return entry;
}

/**
 * Places a waiting entry into one of the viewer's wallets. Null when it was
 * already placed, is not theirs to place, or the wallet is not theirs.
 */
export async function placeEntry(
  entryId: number,
  walletId: number,
  viewer: Person,
) {
  if (!(await getWallet(walletId, viewer))) return null;
  const [entry] = await getDb()
    .update(walletEntries)
    .set({ walletId, recipient: null })
    .where(
      and(
        eq(walletEntries.id, entryId),
        isNull(walletEntries.walletId),
        eq(walletEntries.recipient, viewer),
      ),
    )
    .returning();
  return entry ?? null;
}

/** Money sent to this person that they have not put in a wallet yet. */
export async function getWaitingFor(viewer: Person) {
  return getDb()
    .select()
    .from(walletEntries)
    .where(
      and(isNull(walletEntries.walletId), eq(walletEntries.recipient, viewer)),
    )
    .orderBy(asc(walletEntries.id));
}

/** First half of a send: remembered until the sender picks both wallets. */
export async function draftSend(input: {
  to: Person;
  amount: number;
  note: string | null;
}) {
  const [draft] = await getDb()
    .insert(walletEntries)
    .values({
      amount: input.amount,
      note: input.note,
      kind: "transfer",
      draftFor: input.to,
    })
    .returning();
  return draft;
}

/** A draft the sender may still finish, or null. */
export async function getDraft(draftId: number, sender: Person) {
  const [draft] = await getDb()
    .select()
    .from(walletEntries)
    .where(eq(walletEntries.id, draftId));
  // A draft is only ever finished by the other side of it.
  if (!draft?.draftFor || draft.draftFor === sender) return null;
  return { ...draft, to: draft.draftFor as Person };
}

export async function deleteDraft(draftId: number) {
  await getDb()
    .delete(walletEntries)
    .where(
      and(eq(walletEntries.id, draftId), isNotNull(walletEntries.draftFor)),
    );
}

export async function transfer(input: {
  from: { id: number; name: string };
  to: { id: number; name: string };
  amount: number;
}) {
  await getDb()
    .insert(walletEntries)
    .values([
      {
        walletId: input.from.id,
        amount: -input.amount,
        kind: "transfer",
        note: `Pindah ke ${input.to.name}`,
      },
      {
        walletId: input.to.id,
        amount: input.amount,
        kind: "transfer",
        note: `Pindah dari ${input.from.name}`,
      },
    ]);
}

const payoutRefs = (id: string) => [`payout:${id}:out`, `payout:${id}:in`];

/**
 * Money sent from one person to another: leaves the sender's wallet and lands
 * in the recipient's, or waits for them to pick one. Used for sends made in
 * the bot or dashboard and for payouts paid outside them. Safe to repeat, the
 * id is only ever recorded once. Null when a wallet is not theirs to use.
 */
export async function recordPayout(input: {
  id: string;
  sender: Person;
  to: Person;
  fromWalletId: number;
  toWalletId: number | null;
  amount: number;
  note: string | null;
}) {
  const from = await getWallet(input.fromWalletId, input.sender);
  const into =
    input.toWalletId === null ? null : await getWallet(input.toWalletId);
  if (!from || (input.toWalletId !== null && into?.owner !== input.to)) {
    return null;
  }

  const db = getDb();
  const [outRef, inRef] = payoutRefs(input.id);
  const suffix = input.note ? `: ${input.note}` : "";
  const [outgoing] = await db
    .insert(walletEntries)
    .values({
      walletId: from.id,
      amount: -input.amount,
      kind: "transfer",
      note: `Kirim ke ${input.to}${suffix}`,
      ref: outRef,
    })
    .onConflictDoNothing()
    .returning();
  const [incoming] = await db
    .insert(walletEntries)
    .values({
      walletId: into?.id ?? null,
      recipient: into ? null : input.to,
      amount: input.amount,
      kind: "transfer",
      note: `Dari ${input.sender}${suffix}`,
      ref: inRef,
    })
    .onConflictDoNothing()
    .returning();

  return {
    created: Boolean(outgoing || incoming),
    // Re-read for the balances after the money moved.
    from: (await getWallet(from.id)) ?? from,
    into: into ? ((await getWallet(into.id)) ?? into) : null,
    incoming: incoming ?? null,
  };
}

/**
 * Undoes payouts recorded by recordPayout, on both sides. Returns what was
 * taken back from where, for telling both people.
 */
export async function cancelPayouts(ids: string[], sender: Person) {
  if (ids.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select()
    .from(walletEntries)
    .where(inArray(walletEntries.ref, ids.flatMap(payoutRefs)));
  const mine = new Set((await getWallets(sender)).map((wallet) => wallet.id));

  const undone = [];
  for (const id of ids) {
    const [outRef, inRef] = payoutRefs(id);
    const outgoing = rows.find((row) => row.ref === outRef);
    const incoming = rows.find((row) => row.ref === inRef);
    // Only the person who paid can take a payout back.
    if (!outgoing?.walletId || !mine.has(outgoing.walletId)) continue;
    await db
      .delete(walletEntries)
      .where(inArray(walletEntries.ref, [outRef, inRef]));
    undone.push({
      amount: -outgoing.amount,
      from: await getWallet(outgoing.walletId),
      into: incoming?.walletId ? await getWallet(incoming.walletId) : null,
    });
  }
  return undone;
}

/** Only removes an entry of a wallet the viewer may see. */
export async function deleteEntry(id: number, viewer: Person) {
  const visible = (await getWallets(viewer)).map((wallet) => wallet.id);
  if (visible.length === 0) return;
  await getDb()
    .delete(walletEntries)
    .where(
      and(eq(walletEntries.id, id), inArray(walletEntries.walletId, visible)),
    );
}

export async function getRecentEntries(viewer: Person, limit = 30) {
  return getDb()
    .select({
      id: walletEntries.id,
      amount: walletEntries.amount,
      kind: walletEntries.kind,
      note: walletEntries.note,
      createdAt: walletEntries.createdAt,
      wallet: wallets.name,
      owner: wallets.owner,
    })
    .from(walletEntries)
    .innerJoin(wallets, eq(wallets.id, walletEntries.walletId))
    .where(inArray(wallets.owner, visiblePeople(viewer)))
    .orderBy(desc(walletEntries.id))
    .limit(limit);
}
