"use client";

// Keyboard-wedge scanner capture: a USB scanner types the code and sends
// Enter. A plain autofocused input is all that is needed — no hardware SDK.

import { useRouter } from "next/navigation";
import { useRef } from "react";

export function ScanInput({
  targetPath,
  placeholder = "▦  Scan QR label or type container code",
  autoFocus = true,
}: {
  targetPath: string; // e.g. "/check-out" -> navigates to `${targetPath}?code=X`
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const value = ref.current?.value.trim();
        if (value) router.push(`${targetPath}?code=${encodeURIComponent(value)}`);
      }}
      className="flex max-w-md gap-2"
    >
      <input
        ref={ref}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className="flex-1 rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-teal focus:ring-2 focus:ring-teal/20 focus:outline-none"
      />
      <button className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-deep">
        Open
      </button>
    </form>
  );
}
