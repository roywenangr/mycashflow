"use client";

import { useTransition } from "react";

/** A select that saves through a server action as soon as it changes. */
export function InlineSelect({
  value,
  options,
  emptyLabel,
  label,
  action,
}: {
  value: string;
  options: { value: string; label: string }[];
  emptyLabel: string;
  label: string;
  action: (value: string) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      aria-label={label}
      value={value}
      disabled={pending}
      onChange={(event) => {
        const next = event.target.value;
        startTransition(() => action(next));
      }}
      className="w-full max-w-36 rounded-md border border-(--axis) bg-(--surface) px-2 py-1 text-sm disabled:opacity-60"
    >
      <option value="">{emptyLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
