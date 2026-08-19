"use client";

import { useState, useTransition } from "react";
import { verifyChainAction } from "./actions";

export function VerifyIntegrityButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);

  return (
    <span className="flex items-center gap-2">
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await verifyChainAction();
            setOk(r.ok);
            setResult(r.message);
          })
        }
        className="rounded-md bg-teal px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-deep disabled:opacity-50"
      >
        {pending ? "Verifying…" : "Verify integrity"}
      </button>
      {result && (
        <span className={`text-xs ${ok ? "text-ok" : "text-danger"}`}>
          {ok ? "✓" : "✗"} {result}
        </span>
      )}
    </span>
  );
}
