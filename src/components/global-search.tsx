"use client";

import { useRouter } from "next/navigation";

/** Header search: CAS, name or container ID. Container codes jump straight
 * to the container; anything else lands on the filtered inventory list. */
export function GlobalSearch() {
  const router = useRouter();

  return (
    <form
      className="flex max-w-md flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        const q = new FormData(e.currentTarget).get("q");
        if (typeof q === "string" && q.trim()) {
          router.push(`/inventory?q=${encodeURIComponent(q.trim())}&scope=all`);
        }
      }}
    >
      <input
        name="q"
        placeholder="⌕  Search CAS, name, container ID"
        className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm focus:border-teal focus:bg-card focus:ring-2 focus:ring-teal/20 focus:outline-none"
      />
    </form>
  );
}
