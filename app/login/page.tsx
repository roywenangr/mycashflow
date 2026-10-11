"use client";

import { useActionState } from "react";
import { login } from "@/app/actions";

export default function LoginPage() {
  const [error, action, pending] = useActionState(login, null);

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <form action={action} className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">MyCashflow</h1>
        <p className="mt-1 text-sm text-(--text-secondary)">
          Masukkan password untuk membuka dashboard.
        </p>
        <label className="mt-6 block text-sm font-medium" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          className="mt-2 w-full rounded-md border border-(--axis) bg-transparent px-3 py-2 outline-none focus-visible:border-(--series-1) focus-visible:ring-2 focus-visible:ring-(--series-1)/30"
        />
        {error && (
          <p role="alert" className="mt-3 text-sm text-(--critical)">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="mt-6 w-full rounded-md bg-(--text-primary) px-3 py-2 text-sm font-medium text-(--surface) disabled:opacity-60"
        >
          {pending ? "Memeriksa…" : "Masuk"}
        </button>
      </form>
    </main>
  );
}
