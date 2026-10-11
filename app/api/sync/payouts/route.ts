import { z } from "zod";
import { getBot } from "@/lib/bot";
import { notifyPayout, notifyPayoutCancelled } from "@/lib/bot-wallets";
import { othersOf } from "@/lib/people";
import { preflight, syncJson, syncPerson } from "@/lib/sync";
import { cancelPayouts, recordPayout } from "@/lib/wallets";

export const OPTIONS = preflight;

const id = z.string().min(8).max(64).regex(/^[\w-]+$/);
const label = z.string().trim().max(80).nullish();

const paid = z.object({
  id,
  amount: z.number().int().positive().max(100_000_000_000),
  label,
  fromWalletId: z.number().int().positive(),
  toWalletId: z.number().int().positive().nullable(),
});

/** A payout was marked as paid: move the money between the two wallets. */
export async function POST(request: Request) {
  const me = syncPerson(request);
  if (!me) return syncJson(request, { error: "Token tidak dikenal" }, 401);
  const [to] = othersOf(me);
  const input = paid.safeParse(await request.json().catch(() => null));
  if (!input.success || !to) {
    return syncJson(request, { error: "Data payout tidak valid" }, 400);
  }

  const payout = await recordPayout({
    ...input.data,
    sender: me,
    to,
    note: input.data.label || null,
  });
  if (!payout) {
    return syncJson(request, { error: "Dompet itu sudah tidak ada" }, 404);
  }
  // A repeated request is not announced twice.
  if (!payout.created) return syncJson(request, { status: "exists" });

  const told = await notifyPayout(getBot(), {
    sender: me,
    to,
    amount: input.data.amount,
    label: input.data.label || null,
    from: payout.from,
    into: payout.into,
    incoming: payout.incoming,
  });
  return syncJson(request, {
    status: "created",
    from: { name: payout.from.name, balance: payout.from.balance },
    told,
  });
}

const cancelled = z.object({ ids: z.array(id).min(1).max(20), label });

/** The paid mark was taken back: undo the payout on both sides. */
export async function DELETE(request: Request) {
  const me = syncPerson(request);
  if (!me) return syncJson(request, { error: "Token tidak dikenal" }, 401);
  const [to] = othersOf(me);
  const input = cancelled.safeParse(await request.json().catch(() => null));
  if (!input.success || !to) {
    return syncJson(request, { error: "Data pembatalan tidak valid" }, 400);
  }

  const undone = await cancelPayouts(input.data.ids, me);
  for (const payout of undone) {
    await notifyPayoutCancelled(getBot(), {
      ...payout,
      sender: me,
      to,
      label: input.data.label || null,
    });
  }
  return syncJson(request, { status: "cancelled", count: undone.length });
}
