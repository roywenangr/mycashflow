import { createHmac, timingSafeEqual } from "node:crypto";
import { isPerson, PEOPLE, type Person } from "@/lib/people";

/**
 * The profit-sharing app calls /api/sync from the browser. Each person who
 * uses it has their own token: SYNC_TOKEN_YOR, …
 */
export function syncPerson(request: Request): Person | null {
  const given = /^Bearer (.+)$/.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
  if (!given) return null;
  return (
    PEOPLE.find((person) => {
      const token = process.env[`SYNC_TOKEN_${person.toUpperCase()}`];
      return (
        !!token &&
        token.length === given.length &&
        timingSafeEqual(Buffer.from(token), Buffer.from(given))
      );
    }) ?? null
  );
}

const allowedOrigins = () =>
  (process.env.SYNC_ALLOWED_ORIGINS ?? "https://cashflowshit.vercel.app")
    .split(",")
    .map((origin) => origin.trim());

/** CORS headers for the one app allowed to call from a browser. */
export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function syncJson(request: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

export function preflight(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

const TICKET_SECONDS = 60;

function signTicket(person: Person, expires: number): string | null {
  const token = process.env[`SYNC_TOKEN_${person.toUpperCase()}`];
  if (!token) return null;
  return createHmac("sha256", token)
    .update(`enter:${person}:${expires}`)
    .digest("hex");
}

/**
 * A short-lived pass that logs its holder into the dashboard as `person`, so
 * the long-lived token never travels in a page navigation.
 */
export function enterTicket(person: Person): string | null {
  const expires = Math.floor(Date.now() / 1000) + TICKET_SECONDS;
  const signature = signTicket(person, expires);
  return signature && `${person}.${expires}.${signature}`;
}

/** The person a ticket lets in, or null when it is forged or expired. */
export function personForTicket(ticket: string): Person | null {
  const [person, expires, signature] = ticket.split(".");
  if (!isPerson(person) || !signature) return null;
  if (!(Number(expires) > Date.now() / 1000)) return null;
  const expected = signTicket(person, Number(expires));
  return expected &&
    expected.length === signature.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    ? person
    : null;
}
