import { isPerson, PEOPLE, type Person } from "@/lib/people";

export const SESSION_COOKIE = "mycashflow_session";

/** Each person logs in with their own password: DASHBOARD_PASSWORD_YOR, … */
function passwordOf(person: Person): string | undefined {
  return process.env[`DASHBOARD_PASSWORD_${person.toUpperCase()}`] || undefined;
}

export function hasPasswords(): boolean {
  return PEOPLE.some((person) => passwordOf(person));
}

/** Who a password belongs to, or null when it matches nobody. */
export function personForPassword(password: string): Person | null {
  if (!password) return null;
  return PEOPLE.find((person) => passwordOf(person) === password) ?? null;
}

async function sign(person: Person, password: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${SESSION_COOKIE}:${person}`),
  );
  return Buffer.from(signature).toString("hex");
}

/** Cookie value for a logged-in person: "Yor.<signature>". */
export async function sessionToken(person: Person): Promise<string | null> {
  const password = passwordOf(person);
  return password ? `${person}.${await sign(person, password)}` : null;
}

/** The person a session cookie proves, or null. Changing a password ends its sessions. */
export async function viewerFromCookie(
  cookie: string | undefined,
): Promise<Person | null> {
  const person = cookie?.split(".")[0];
  if (!isPerson(person)) return null;
  return cookie === (await sessionToken(person)) ? person : null;
}
