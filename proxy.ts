import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, viewerFromCookie } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  if (await viewerFromCookie(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Telegram authenticates the webhook with its own secret token, and the
  // sync API with a bearer token.
  matcher: [
    "/((?!login|api/webhooks|api/sync|_next/static|_next/image|favicon.ico).*)",
  ],
};
