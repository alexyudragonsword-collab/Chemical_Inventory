"use client";

// The inline − / + control on every inventory row the user owns — the
// highest-frequency interaction in the product. Out-of-scope rows render a
// lock with the custodian's name instead (deck: never hide stock).

import { useState } from "react";
import { AdjustDialog, type AdjustTarget } from "@/components/adjust-dialog";

export function RowAdjust({
  target,
  mode,
  custodianName,
  disabledReason,
}: {
  target: AdjustTarget;
  mode: "editable" | "request-only" | "read-only" | "restricted" | "denied";
  custodianName: string | null;
  disabledReason?: string;
}) {
  const [open, setOpen] = useState<"DEDUCT" | null>(null);

  if (mode === "restricted") {
    return (
      <span className="text-xs text-restricted" title="Controlled substance — EHS Officer or authorized custodian only">
        🔒 Controlled
      </span>
    );
  }
  if (mode !== "editable") {
    return (
      <span
        className="text-xs text-muted"
        title={disabledReason ?? "Outside your custody — use Request transfer"}
      >
        🔒 {custodianName ?? "Other custody"}
      </span>
    );
  }

  return (
    <>
      <div className="flex items-center gap-1">
        {/* No "+" here: stock only enters through Check-In. */}
        <button
          onClick={() => setOpen("DEDUCT")}
          className="h-7 w-7 rounded-full border border-line text-sm leading-none text-ink hover:border-teal hover:bg-teal-soft"
          title="Deduct or correct quantity"
        >
          −
        </button>
      </div>
      {open && (
        <AdjustDialog target={target} initialMode={open} onClose={() => setOpen(null)} />
      )}
    </>
  );
}
