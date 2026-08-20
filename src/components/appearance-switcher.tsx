"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setAppearanceAction } from "@/app/(app)/actions";
import { APPEARANCES } from "@/lib/appearance";

export function AppearanceSwitcher({ current }: { current: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-1.5" title="Appearance — visual only, never touches your data">
      <span className="text-xs tracking-wide text-muted uppercase">Look</span>
      <select
        value={current}
        disabled={pending}
        onChange={(e) =>
          startTransition(async () => {
            await setAppearanceAction(e.target.value);
            router.refresh();
          })
        }
        className="rounded-md border border-line bg-card px-2 py-1 text-sm"
      >
        {APPEARANCES.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>
    </label>
  );
}
