import Link from "next/link";
import { Suspense } from "react";
import { logout } from "@/app/actions";
import { PEOPLE } from "@/lib/people";
import { requireViewer } from "@/lib/session";

const PAGES = [
  { href: "/", label: "Dashboard" },
  { href: "/rekap", label: "Rekap" },
  { href: "/dompet", label: "Dompet" },
];

export function Nav({ current }: { current: string }) {
  return (
    <nav aria-label="Halaman" className="flex flex-wrap items-center gap-2">
      {PAGES.map((page) =>
        page.href === current ? (
          <span
            key={page.href}
            aria-current="page"
            className="rounded-md bg-(--text-primary) px-3 py-1.5 text-sm font-medium text-(--surface)"
          >
            {page.label}
          </span>
        ) : (
          <Link
            key={page.href}
            href={page.href}
            className="rounded-md border border-(--axis) px-3 py-1.5 text-sm font-medium hover:bg-(--series-1-wash)"
          >
            {page.label}
          </Link>
        ),
      )}
      <Suspense fallback={null}>
        <Account />
      </Suspense>
    </nav>
  );
}

// The profit-sharing app this dashboard is paired with.
const SHARING_APP = process.env.SHARING_APP_URL ?? "https://cashflowshit.vercel.app";

/** Who is logged in, with a way out and the way back to the other app. */
async function Account() {
  const viewer = await requireViewer();
  return (
    <form action={logout} className="flex items-center gap-2 pl-2 text-sm">
      <a
        // Only the first person owns that app; the others use its partner portal.
        href={viewer === PEOPLE[0] ? SHARING_APP : `${SHARING_APP}/partner`}
        className="rounded-md border border-(--axis) px-3 py-1.5 font-medium hover:bg-(--series-1-wash)"
      >
        ⇄ Cashflowshit
      </a>
      <span className="text-(--text-secondary)">{viewer}</span>
      <button
        type="submit"
        className="rounded-md px-2 py-1.5 text-(--text-secondary) underline decoration-(--axis) underline-offset-4 hover:bg-(--series-1-wash)"
      >
        Keluar
      </button>
    </form>
  );
}
