"use client";

// One dialog for the two quantity flows: Deduct and Correct count.
// There is deliberately no "Add": stock only enters through Check-In —
// containers are consumed until empty, never topped up.
// Shows the resulting number before confirm (deck: "the before → after strip
// removes the mental arithmetic") and reveals the witness fields only when
// the server says one is required.

import { useMemo, useState, useTransition } from "react";
import { adjustQuantityAction, reverseTransactionAction, type AdjustResult } from "@/app/(app)/inventory/actions";
import { formatQty, presetSteps, unitLabel } from "@/lib/units-ui";

export type AdjustTarget = {
  containerId: string;
  code: string;
  substanceName: string;
  cas: string | null;
  unit: string;
  currentQuantity: number;
  packSize: number;
  minLevel: number | null;
  isControlled: boolean;
};

type Mode = "DEDUCT" | "CORRECT";

export function AdjustDialog({
  target,
  initialMode,
  onClose,
}: {
  target: AdjustTarget;
  initialMode: Mode;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [amount, setAmount] = useState<number>(presetSteps(target.unit)[2] ?? 1);
  const [needWitness, setNeedWitness] = useState(target.isControlled);
  const [witnessEmail, setWitnessEmail] = useState("");
  const [witnessPassword, setWitnessPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<AdjustResult & { ok: true } | null>(null);
  const [reversed, setReversed] = useState(false);
  const [pending, startTransition] = useTransition();

  const after = useMemo(() => {
    switch (mode) {
      case "DEDUCT":
        return target.currentQuantity - amount;
      case "CORRECT":
        return amount;
    }
  }, [mode, amount, target.currentQuantity]);

  const invalid = after < 0 || (mode !== "CORRECT" && amount <= 0);
  const belowMin = target.minLevel !== null && after < target.minLevel;
  const correctionDelta =
    mode === "CORRECT" && target.currentQuantity > 0
      ? Math.abs(after - target.currentQuantity) / target.currentQuantity
      : 0;

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await adjustQuantityAction({
        containerId: target.containerId,
        mode,
        amount,
        witnessEmail: witnessEmail || undefined,
        witnessPassword: witnessPassword || undefined,
      });
      if (result.ok) {
        setDone(result);
      } else {
        setError(result.error);
        if (result.needWitness) setNeedWitness(true);
      }
    });
  }

  function undo() {
    if (!done) return;
    startTransition(async () => {
      const result = await reverseTransactionAction(done.transactionId);
      if (result.ok) setReversed(true);
      else setError(result.error);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-lg bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-teal-deep">Adjust quantity</h2>
            <p className="mt-0.5 text-sm text-muted">
              {target.substanceName}
              {target.cas ? ` · CAS ${target.cas}` : ""} · Container {target.code}
            </p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close">
            ✕
          </button>
        </div>

        {done ? (
          <div className="mt-6">
            <div className="rounded-md border border-ok/30 bg-ok-soft px-4 py-3 text-sm text-ok">
              {reversed ? (
                <>Change reversed. Quantity is back to {formatQty(done.before, target.unit)}.</>
              ) : (
                <>
                  Recorded: {formatQty(done.before, target.unit)} →{" "}
                  <strong>{formatQty(done.after, target.unit)}</strong>
                </>
              )}
            </div>
            {error && <p className="mt-2 text-sm text-danger">{error}</p>}
            <div className="mt-4 flex justify-between">
              {!reversed ? (
                <button
                  onClick={undo}
                  disabled={pending}
                  className="rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:bg-paper"
                >
                  Reverse (15-min window)
                </button>
              ) : (
                <span />
              )}
              <button
                onClick={onClose}
                className="rounded-md bg-teal px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-deep"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Mode tabs */}
            <div className="mt-4 flex gap-1 rounded-md bg-paper p-1">
              {(["DEDUCT", "CORRECT"] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded px-3 py-1.5 text-sm font-medium ${
                    mode === m ? "bg-card text-teal-deep shadow-sm" : "text-muted hover:text-ink"
                  }`}
                >
                  {m === "DEDUCT" ? "Deduct" : "Correct count"}
                </button>
              ))}
            </div>
            {mode === "CORRECT" && (
              <p className="mt-2 text-xs text-muted">
                A correction records a discrepancy, not a use. Corrections above 20% require a
                witness.
              </p>
            )}

            {/* Amount + presets */}
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={() => setAmount((a) => Math.max(0, +(a - (presetSteps(target.unit)[0] ?? 1)).toFixed(3)))}
                className="h-10 w-10 rounded-full border border-line text-lg text-ink hover:bg-paper"
                aria-label="Decrease"
              >
                −
              </button>
              <input
                type="number"
                min={0}
                step="any"
                value={Number.isNaN(amount) ? "" : amount}
                onChange={(e) => setAmount(e.target.valueAsNumber)}
                className="w-28 rounded-md border border-line px-3 py-2 text-center text-lg font-semibold focus:border-teal focus:outline-none"
              />
              <span className="text-sm text-muted">{unitLabel(target.unit)}</span>
              <button
                onClick={() => setAmount((a) => +((Number.isNaN(a) ? 0 : a) + (presetSteps(target.unit)[0] ?? 1)).toFixed(3))}
                className="h-10 w-10 rounded-full border border-line text-lg text-ink hover:bg-paper"
                aria-label="Increase"
              >
                +
              </button>
              <div className="ml-2 flex flex-wrap gap-1">
                {presetSteps(target.unit).map((p) => (
                  <button
                    key={p}
                    onClick={() => setAmount(p)}
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      amount === p ? "border-teal bg-teal-soft text-teal-deep" : "border-line text-muted hover:bg-paper"
                    }`}
                  >
                    {p} {unitLabel(target.unit)}
                  </button>
                ))}
              </div>
            </div>

            {/* Before → after strip */}
            <div
              className={`mt-4 rounded-md border px-4 py-2.5 text-sm ${
                invalid
                  ? "border-danger/40 bg-danger-soft text-danger"
                  : belowMin
                    ? "border-warning/40 bg-warning-soft text-warning"
                    : "border-line bg-paper text-ink"
              }`}
            >
              <span className="font-medium">{formatQty(target.currentQuantity, target.unit)}</span>
              <span className="mx-2">→</span>
              <span className="font-semibold">
                {Number.isNaN(after) ? "—" : formatQty(after, target.unit)}
              </span>
              <span className="ml-3 text-xs">
                {invalid
                  ? "Cannot go below zero"
                  : `${target.packSize > 0 ? Math.round((after / target.packSize) * 100) : 0}% of pack${
                      target.minLevel !== null
                        ? belowMin
                          ? ` · below min (${formatQty(target.minLevel, target.unit)})`
                          : ` · above min (${formatQty(target.minLevel, target.unit)})`
                        : ""
                    }`}
              </span>
            </div>

            {/* Witness — controlled substances always; corrections when server demands */}
            {(needWitness || (mode === "CORRECT" && correctionDelta > 0.2)) && (
              <fieldset className="mt-4 rounded-md border border-restricted/30 bg-restricted-soft p-3">
                <legend className="px-1 text-xs font-semibold tracking-wide text-restricted uppercase">
                  Witness signature required
                </legend>
                <p className="text-xs text-muted">
                  {target.isControlled
                    ? "Controlled substance: a second person must confirm with their own credentials."
                    : "Correction above 20%: a second person must confirm with their own credentials."}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input
                    type="email"
                    placeholder="Witness email"
                    value={witnessEmail}
                    onChange={(e) => setWitnessEmail(e.target.value)}
                    className="rounded-md border border-line px-3 py-2 text-sm focus:border-restricted focus:outline-none"
                  />
                  <input
                    type="password"
                    placeholder="Witness password"
                    value={witnessPassword}
                    onChange={(e) => setWitnessPassword(e.target.value)}
                    className="rounded-md border border-line px-3 py-2 text-sm focus:border-restricted focus:outline-none"
                  />
                </div>
              </fieldset>
            )}

            {error && <p className="mt-3 text-sm text-danger">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-md border border-line px-4 py-2 text-sm text-muted hover:bg-paper"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={pending || invalid || Number.isNaN(amount)}
                className={`rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                  mode === "DEDUCT" ? "bg-teal hover:bg-teal-deep" : "bg-accent hover:opacity-90"
                }`}
              >
                {pending
                  ? "Recording…"
                  : mode === "DEDUCT"
                    ? "Confirm deduct"
                    : "Confirm correction"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
