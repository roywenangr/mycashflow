import { othersOf } from "@/lib/people";
import { preflight, syncJson, syncPerson } from "@/lib/sync";
import { getWallets } from "@/lib/wallets";

export const OPTIONS = preflight;

/**
 * The caller's wallets with balances, and the names of the wallets of the
 * person they pay, so a payout can say where it goes.
 */
export async function GET(request: Request) {
  const me = syncPerson(request);
  if (!me) return syncJson(request, { error: "Token tidak dikenal" }, 401);

  const [partner] = othersOf(me);
  const all = await getWallets();
  return syncJson(request, {
    me,
    wallets: all
      .filter((wallet) => wallet.owner === me)
      .map(({ id, name, balance }) => ({ id, name, balance })),
    partner: partner
      ? {
          name: partner,
          // Names only: balances stay private to their owner.
          wallets: all
            .filter((wallet) => wallet.owner === partner)
            .map(({ id, name }) => ({ id, name })),
        }
      : null,
  });
}
