import { enterTicket, preflight, syncJson, syncPerson } from "@/lib/sync";

export const OPTIONS = preflight;

/** Trades the sync token for a one-minute pass into the dashboard. */
export async function POST(request: Request) {
  const me = syncPerson(request);
  if (!me) return syncJson(request, { error: "Token tidak dikenal" }, 401);
  return syncJson(request, { ticket: enterTicket(me) });
}
