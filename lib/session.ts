import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, viewerFromCookie } from "@/lib/auth";
import type { Person } from "@/lib/people";

/** The logged-in person; sends everyone else to the login page. */
export async function requireViewer(): Promise<Person> {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  return (await viewerFromCookie(cookie)) ?? redirect("/login");
}
