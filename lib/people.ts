/** Who an expense belongs to. "Kita" is the shared bucket. */
export const PEOPLE = ["Yor", "Awlas", "Kita"] as const;

export type Person = (typeof PEOPLE)[number];

export const UNASSIGNED = "Belum dipilih";

export function isPerson(value: unknown): value is Person {
  return PEOPLE.includes(value as Person);
}

const PERSON_EMOJI: Record<Person, string> = {
  Yor: "🦊",
  Awlas: "🐼",
  Kita: "🤍",
};

/** "🦊 Yor", or "❓ Belum dipilih" for no owner — for chat messages. */
export function personLabel(person: string | null): string {
  return isPerson(person)
    ? `${PERSON_EMOJI[person]} ${person}`
    : `❓ ${UNASSIGNED}`;
}

/**
 * The person behind a Telegram account, from TELEGRAM_USER_PEOPLE
 * ("123:Yor,456:Awlas"). Null for an unmapped account.
 */
export function personOf(userId: string): Person | null {
  for (const pair of (process.env.TELEGRAM_USER_PEOPLE ?? "").split(",")) {
    const [id, person] = pair.trim().split(":");
    if (id === userId && isPerson(person)) return person;
  }
  return null;
}

/** The people a person can send money to: everyone but themselves and "Kita". */
export function othersOf(viewer: Person): Person[] {
  return PEOPLE.filter((person) => person !== viewer && person !== "Kita");
}

/** What a person may see and assign: their own data and the shared bucket. */
export function visiblePeople(viewer: Person): Person[] {
  return viewer === "Kita" ? ["Kita"] : [viewer, "Kita"];
}

/** The Telegram accounts mapped to a person in TELEGRAM_USER_PEOPLE. */
export function telegramIdsOf(person: Person): string[] {
  return (process.env.TELEGRAM_USER_PEOPLE ?? "")
    .split(",")
    .map((pair) => pair.trim().split(":"))
    .filter(([, name]) => name === person)
    .map(([id]) => id);
}
