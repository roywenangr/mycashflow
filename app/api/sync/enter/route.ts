import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";
import { personForTicket } from "@/lib/sync";

/**
 * Where the profit-sharing app sends the browser (a form post) to switch to
 * the dashboard without typing the password again.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const person = personForTicket(String(form?.get("ticket") ?? ""));
  const token = person && (await sessionToken(person));
  if (!token) redirect("/login");

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  redirect("/");
}
