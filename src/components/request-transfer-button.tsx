"use client";

import { useState, useTransition } from "react";
import { requestTransferAction } from "@/app/(app)/inventory/transfer-actions";

export function RequestTransferButton({ containerId, compact }: { containerId: string; compact?: boolean }) {
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (state === "sent") {
    return <span className="text-xs text-ok">Request sent</span>;
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await requestTransferAction(containerId);
            if (result.ok) setState("sent");
            else {
              setState("error");
              setMessage(result.error ?? "Failed");
            }
          })
        }
        className={`rounded-md border border-info/40 text-info hover:bg-info-soft disabled:opacity-50 ${
          compact ? "px-2 py-0.5 text-xs" : "px-3 py-1.5 text-sm"
        }`}
      >
        {pending ? "…" : "Request transfer"}
      </button>
      {state === "error" && <span className="text-xs text-danger">{message}</span>}
    </span>
  );
}
