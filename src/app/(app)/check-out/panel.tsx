"use client";

import { useState, useTransition } from "react";
import { formatQty, presetSteps, unitLabel } from "@/lib/units-ui";
import { CustodyPill, ExpiryPill, HazardPill, Pill } from "@/components/pills";
import {
  checkOutDeductAction,
  checkOutDisposeAction,
  checkOutTransferAction,
  type CheckOutResult,
} from "./actions";
import { reverseTransactionAction } from "@/app/(app)/inventory/actions";

type ContainerView = {
  id: string;
  code: string;
  substanceName: string;
  cas: string | null;
  lot: string | null;
  unit: string;
  currentQuantity: number;
  packSize: number;
  status: string;
  expiryDate: string | null;
  storageClass: string | null;
  isControlled: boolean;
  labCode: string;
  location: string | null;
  custodianName: string | null;
  useFirst: boolean;
};

type Mode = "editable" | "request-only" | "read-only" | "restricted" | "denied";

const CHECKLIST = [
  "PPE on (gloves, goggles)",
  "Working in fume hood",
  "Secondary container labelled",
  "Spill kit located",
];

export function CheckOutPanel({
  container,
  mode,
  transferMode,
  disposeMode,
  projects,
  people,
}: {
  container: ContainerView;
  mode: Mode;
  transferMode: Mode;
  disposeMode: Mode;
  projects: { code: string; name: string }[];
  people: { id: string; name: string }[];
}) {
  const [tab, setTab] = useState<"deduct" | "transfer" | "dispose">("deduct");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CheckOutResult | null>(null);
  const [needWitness, setNeedWitness] = useState(container.isControlled);
  const [witnessEmail, setWitnessEmail] = useState("");
  const [witnessPassword, setWitnessPassword] = useState("");
  const [reversed, setReversed] = useState(false);

  // Deduct state
  const [amount, setAmount] = useState(presetSteps(container.unit)[2] ?? 1);
  const [reason, setReason] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [dispensedInto, setDispensedInto] = useState("");
  const [fumeHood, setFumeHood] = useState("");
  const [checks, setChecks] = useState<string[]>([]);

  // Transfer state
  const [toUserId, setToUserId] = useState("");
  const [transferReason, setTransferReason] = useState("");

  // Dispose state
  const [disposeReason, setDisposeReason] = useState("");
  const [wasteStream, setWasteStream] = useState("");

  const daysToExpiry = container.expiryDate
    ? Math.ceil((new Date(container.expiryDate).getTime() - Date.now()) / 86_400_000)
    : null;

  const witness = needWitness
    ? { witnessEmail: witnessEmail || undefined, witnessPassword: witnessPassword || undefined }
    : {};

  function run(action: () => Promise<CheckOutResult>) {
    setResult(null);
    startTransition(async () => {
      const r = await action();
      setResult(r);
      if (!r.ok && r.needWitness) setNeedWitness(true);
    });
  }

  return (
    <div className="mt-5 rounded-lg border border-line bg-white">
      {/* Scanned context */}
      <div className="flex flex-wrap items-start gap-4 border-b border-line p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-lg font-semibold">{container.code}</span>
            {container.custodianName && mode === "editable" ? <CustodyPill /> : null}
            <HazardPill storageClass={container.storageClass} />
            {container.isControlled && <Pill tone="restricted">Controlled</Pill>}
            {container.useFirst && <Pill tone="info">Use first</Pill>}
          </div>
          <div className="mt-0.5 text-sm">
            {container.substanceName}
            <span className="ml-2 text-xs text-muted">
              {container.cas ? `CAS ${container.cas}` : ""}
              {container.lot ? ` · Lot ${container.lot}` : ""} · {container.labCode}
              {container.location ? ` · ${container.location}` : ""}
            </span>
          </div>
          <div className="mt-1 text-sm">
            Remaining:{" "}
            <strong>
              {formatQty(container.currentQuantity, container.unit)} of{" "}
              {formatQty(container.packSize, container.unit)}
            </strong>
            {container.packSize > 0 && (
              <span className="ml-1 text-xs text-muted">
                · {Math.round((container.currentQuantity / container.packSize) * 100)}%
              </span>
            )}
          </div>
        </div>
        <ExpiryPill expiryDate={container.expiryDate ? new Date(container.expiryDate) : null} />
      </div>

      {/* Warnings BEFORE the controls (deck: reading order before action) */}
      {(daysToExpiry !== null && daysToExpiry <= 30) || container.storageClass === "FLAMMABLE" ? (
        <div className="border-b border-line bg-warning-soft px-4 py-2.5 text-sm text-ink">
          {daysToExpiry !== null && daysToExpiry <= 30 && daysToExpiry >= 0 && (
            <div>⚠ Expires in {daysToExpiry} days — use this container before opening a newer one.</div>
          )}
          {daysToExpiry !== null && daysToExpiry < 0 && (
            <div>⚠ Expired {-daysToExpiry} days ago — dispose rather than dispense.</div>
          )}
          {container.storageClass === "FLAMMABLE" && (
            <div>🔥 Highly flammable — keep away from ignition sources; use in fume hood.</div>
          )}
        </div>
      ) : null}

      {mode !== "editable" && tab === "deduct" ? (
        <div className="p-4 text-sm text-muted">
          {mode === "restricted"
            ? "Controlled substance: only the EHS Officer or an authorized custodian can dispense it."
            : `This container is in ${container.custodianName ?? "another"}’s custody — request a transfer from the inventory list.`}
        </div>
      ) : null}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-line px-4 pt-3">
        {(
          [
            ["deduct", "Deduct quantity", mode],
            ["transfer", "Transfer custody", transferMode],
            ["dispose", "Dispose container", disposeMode],
          ] as const
        ).map(([key, label, m]) => (
          <button
            key={key}
            onClick={() => {
              setTab(key);
              setResult(null);
            }}
            disabled={m !== "editable"}
            className={`rounded-t-md px-3 py-2 text-sm font-medium disabled:opacity-40 ${
              tab === key ? "border border-b-0 border-line bg-white text-teal-deep" : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {result?.ok ? (
          <div className="rounded-md border border-ok/30 bg-ok-soft px-4 py-3 text-sm text-ok">
            {reversed ? "Change reversed." : result.message}
            {!reversed && result.transactionId && (
              <button
                onClick={() =>
                  startTransition(async () => {
                    const r = await reverseTransactionAction(result.transactionId!);
                    if (r.ok) setReversed(true);
                  })
                }
                className="ml-3 rounded border border-line bg-white px-2 py-0.5 text-xs text-muted hover:bg-paper"
              >
                Reverse
              </button>
            )}
          </div>
        ) : (
          <>
            {tab === "deduct" && mode === "editable" && (
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setAmount((a) => Math.max(0, a - (presetSteps(container.unit)[0] ?? 1)))} className="h-9 w-9 rounded-full border border-line text-lg">−</button>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={amount}
                      onChange={(e) => setAmount(e.target.valueAsNumber)}
                      className="input w-24 text-center font-semibold"
                    />
                    <span className="text-sm text-muted">{unitLabel(container.unit)}</span>
                    <button onClick={() => setAmount((a) => a + (presetSteps(container.unit)[0] ?? 1))} className="h-9 w-9 rounded-full border border-line text-lg">+</button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {presetSteps(container.unit).map((p) => (
                      <button key={p} onClick={() => setAmount(p)} className={`rounded-full border px-2 py-0.5 text-xs ${amount === p ? "border-teal bg-teal-soft" : "border-line text-muted"}`}>
                        {p}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-sm">
                    {formatQty(container.currentQuantity, container.unit)} →{" "}
                    <strong>{formatQty(Math.max(0, container.currentQuantity - (amount || 0)), container.unit)}</strong>
                  </p>
                  <label className="mt-3 block text-xs font-semibold tracking-wide text-muted uppercase">
                    Purpose (required)
                    <input value={reason} onChange={(e) => setReason(e.target.value)} className="input mt-1" placeholder="Reaction solvent" />
                  </label>
                  <label className="mt-2 block text-xs font-semibold tracking-wide text-muted uppercase">
                    Project / cost centre
                    <select value={projectCode} onChange={(e) => setProjectCode(e.target.value)} className="input mt-1">
                      <option value="">—</option>
                      {projects.map((p) => (
                        <option key={p.code} value={p.code}>{p.code} · {p.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div>
                  <label className="block text-xs font-semibold tracking-wide text-muted uppercase">
                    Dispensed into
                    <input value={dispensedInto} onChange={(e) => setDispensedInto(e.target.value)} className="input mt-1" placeholder="Secondary container SC-221" />
                  </label>
                  <label className="mt-2 block text-xs font-semibold tracking-wide text-muted uppercase">
                    Fume hood
                    <input value={fumeHood} onChange={(e) => setFumeHood(e.target.value)} className="input mt-1" placeholder="FH-3" />
                  </label>
                  <fieldset className="mt-3">
                    <legend className="text-xs font-semibold tracking-wide text-muted uppercase">
                      Pre-dispense checks (recorded, not enforced)
                    </legend>
                    {CHECKLIST.map((item) => (
                      <label key={item} className="mt-1 flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checks.includes(item)}
                          onChange={(e) =>
                            setChecks((prev) => (e.target.checked ? [...prev, item] : prev.filter((c) => c !== item)))
                          }
                        />
                        {item}
                      </label>
                    ))}
                  </fieldset>
                </div>
              </div>
            )}

            {tab === "transfer" && transferMode === "editable" && (
              <div className="max-w-md">
                <label className="block text-xs font-semibold tracking-wide text-muted uppercase">
                  Transfer to
                  <select value={toUserId} onChange={(e) => setToUserId(e.target.value)} className="input mt-1">
                    <option value="">Choose a person…</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label className="mt-2 block text-xs font-semibold tracking-wide text-muted uppercase">
                  Reason (required)
                  <input value={transferReason} onChange={(e) => setTransferReason(e.target.value)} className="input mt-1" placeholder="Borrowed for Project 44-B" />
                </label>
                <p className="mt-2 text-xs text-muted">
                  The container moves to the receiver&apos;s custody (and their lab, if different).
                  Its shelf assignment clears when it changes lab.
                </p>
              </div>
            )}

            {tab === "dispose" && disposeMode === "editable" && (
              <div className="max-w-md">
                <label className="block text-xs font-semibold tracking-wide text-muted uppercase">
                  Reason (required)
                  <input value={disposeReason} onChange={(e) => setDisposeReason(e.target.value)} className="input mt-1" placeholder="Expired; peroxide risk" />
                </label>
                <label className="mt-2 block text-xs font-semibold tracking-wide text-muted uppercase">
                  Waste stream
                  <input value={wasteStream} onChange={(e) => setWasteStream(e.target.value)} className="input mt-1" placeholder="Halogen-free solvent W-02" />
                </label>
                <p className="mt-2 text-xs text-danger">
                  Disposal is final — the container stays on record with status DISPOSED.
                </p>
              </div>
            )}

            {needWitness && (
              <fieldset className="mt-4 max-w-md rounded-md border border-restricted/30 bg-restricted-soft p-3">
                <legend className="px-1 text-xs font-semibold tracking-wide text-restricted uppercase">
                  Witness signature required
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  <input type="email" placeholder="Witness email" value={witnessEmail} onChange={(e) => setWitnessEmail(e.target.value)} className="input" />
                  <input type="password" placeholder="Witness password" value={witnessPassword} onChange={(e) => setWitnessPassword(e.target.value)} className="input" />
                </div>
              </fieldset>
            )}

            {result && !result.ok && <p className="mt-3 text-sm text-danger">{result.error}</p>}

            <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
              <span className="text-xs text-muted">
                Recorded against you · deductions reversible within 15 minutes
              </span>
              {tab === "deduct" && mode === "editable" && (
                <button
                  onClick={() => run(() => checkOutDeductAction({ containerId: container.id, amount, reason, projectCode: projectCode || undefined, dispensedInto: dispensedInto || undefined, fumeHood: fumeHood || undefined, checklist: checks, ...witness }))}
                  disabled={pending || !reason.trim() || !(amount > 0)}
                  className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-deep disabled:opacity-50"
                >
                  {pending ? "Recording…" : `Confirm deduct ${amount || ""} ${unitLabel(container.unit)}`}
                </button>
              )}
              {tab === "transfer" && transferMode === "editable" && (
                <button
                  onClick={() => run(() => checkOutTransferAction({ containerId: container.id, toUserId, reason: transferReason, ...witness }))}
                  disabled={pending || !toUserId || !transferReason.trim()}
                  className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-deep disabled:opacity-50"
                >
                  {pending ? "Recording…" : "Confirm transfer"}
                </button>
              )}
              {tab === "dispose" && disposeMode === "editable" && (
                <button
                  onClick={() => run(() => checkOutDisposeAction({ containerId: container.id, reason: disposeReason, wasteStream: wasteStream || undefined, ...witness }))}
                  disabled={pending || !disposeReason.trim()}
                  className="rounded-md bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {pending ? "Recording…" : "Confirm dispose"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
