"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  annotateAction,
  claimAction,
  recordScanAction,
  resolveCorrectionAction,
  signOffAction,
  submitAction,
  type ActionResult,
} from "../actions";

export function ScanForm({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const codeRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [last, setLast] = useState<string | null>(null);

  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const code = codeRef.current?.value.trim();
        if (!code) return;
        const qty = qtyRef.current?.value;
        startTransition(async () => {
          const result = await recordScanAction({
            sessionId,
            code,
            countedQuantity: qty === "" || qty === undefined ? null : Number(qty),
          });
          if (result.ok) {
            setLast(`${code}: ${result.discrepancy === "NONE" ? "match" : result.discrepancy?.toLowerCase()}`);
            if (codeRef.current) codeRef.current.value = "";
            if (qtyRef.current) qtyRef.current.value = "";
            codeRef.current?.focus();
            router.refresh();
          } else {
            setLast(result.error ?? "failed");
          }
        });
      }}
    >
      <label className="text-xs font-semibold tracking-wide text-muted uppercase">
        Scan container
        <input ref={codeRef} autoFocus placeholder="▦ B2-14-C03" className="input mt-1 w-48 font-mono" />
      </label>
      <label className="text-xs font-semibold tracking-wide text-muted uppercase">
        Counted quantity (blank = matches label)
        <input ref={qtyRef} type="number" step="any" min={0} className="input mt-1 w-40" />
      </label>
      <button
        disabled={pending}
        className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-deep disabled:opacity-50"
      >
        Record
      </button>
      {last && <span className="text-xs text-muted">Last: {last}</span>}
    </form>
  );
}

export function ResolveControls({
  countId,
  sessionId,
  discrepancy,
  hasContainer,
}: {
  countId: string;
  sessionId: string;
  discrepancy: string;
  hasContainer: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"idle" | "annotate" | "witness">("idle");
  const [note, setNote] = useState("");
  const [witnessEmail, setWitnessEmail] = useState("");
  const [witnessPassword, setWitnessPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error ?? "failed");
        if (result.needWitness) setMode("witness");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {discrepancy === "MISMATCH" && hasContainer && (
          <button
            disabled={pending}
            onClick={() =>
              run(() =>
                resolveCorrectionAction({
                  countId,
                  sessionId,
                  witnessEmail: witnessEmail || undefined,
                  witnessPassword: witnessPassword || undefined,
                }),
              )
            }
            className="rounded bg-teal px-2 py-0.5 text-xs font-medium text-white hover:bg-teal-deep disabled:opacity-50"
          >
            Correct to counted
          </button>
        )}
        {discrepancy === "UNEXPECTED" && hasContainer && (
          <button
            disabled={pending}
            onClick={() => run(() => claimAction({ countId, sessionId }))}
            className="rounded bg-info px-2 py-0.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Claim
          </button>
        )}
        <button
          onClick={() => setMode(mode === "annotate" ? "idle" : "annotate")}
          className="rounded border border-line px-2 py-0.5 text-xs text-muted hover:bg-paper"
        >
          Annotate
        </button>
      </div>
      {mode === "annotate" && (
        <div className="flex gap-1">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. bottle found broken, disposed"
            className="input w-56 text-xs"
          />
          <button
            disabled={pending || !note.trim()}
            onClick={() => run(() => annotateAction({ countId, sessionId, note }))}
            className="rounded bg-teal px-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Save
          </button>
        </div>
      )}
      {mode === "witness" && (
        <div className="flex gap-1">
          <input type="email" value={witnessEmail} onChange={(e) => setWitnessEmail(e.target.value)} placeholder="Witness email" className="input w-40 text-xs" />
          <input type="password" value={witnessPassword} onChange={(e) => setWitnessPassword(e.target.value)} placeholder="Password" className="input w-28 text-xs" />
          <button
            disabled={pending}
            onClick={() =>
              run(() => resolveCorrectionAction({ countId, sessionId, witnessEmail, witnessPassword }))
            }
            className="rounded bg-restricted px-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Confirm
          </button>
        </div>
      )}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

export function SessionControls({
  sessionId,
  status,
  canSignOff,
  unresolvedCount,
}: {
  sessionId: string;
  status: string;
  canSignOff: boolean;
  unresolvedCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) router.refresh();
      else setError(result.error ?? "failed");
    });
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-danger">{error}</span>}
      {status === "OPEN" && (
        <button
          disabled={pending}
          onClick={() => run(() => submitAction({ sessionId }))}
          className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-deep disabled:opacity-50"
        >
          Submit for sign-off
        </button>
      )}
      {status === "AWAITING_SIGNOFF" && canSignOff && (
        <button
          disabled={pending || unresolvedCount > 0}
          onClick={() => run(() => signOffAction({ sessionId }))}
          title={unresolvedCount > 0 ? "Resolve or annotate every discrepancy first" : undefined}
          className="rounded-md bg-ok px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          Sign off
        </button>
      )}
    </div>
  );
}
