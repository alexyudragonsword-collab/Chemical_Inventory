"use client";

// Four-step check-in wizard: identify → quantity & lot → assign location
// (with live compatibility check) → label preview & confirm.

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  checkInAction,
  checkPlacementAction,
  createSubstanceAction,
  identifyProductAction,
  type IdentifyMatch,
  type PlacementCheck,
} from "./actions";

type Lab = {
  id: string;
  code: string;
  name: string;
  locations: { id: string; code: string; name: string | null; kind: string; parentId: string | null; capacity: number | null }[];
};

const STEPS = ["Identify", "Quantity & lot", "Assign location", "Label & confirm"];

export function CheckInWizard({ labs, defaultLabId }: { labs: Lab[]; defaultLabId: string | null }) {
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Step 1
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<IdentifyMatch[] | null>(null);
  const [selected, setSelected] = useState<IdentifyMatch | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  // Step 2
  const [lotNumber, setLotNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [packSize, setPackSize] = useState<number>(500);
  const [unit, setUnit] = useState("mL");
  const [count, setCount] = useState(1);
  const [grade, setGrade] = useState("");
  const [poNumber, setPoNumber] = useState("");

  // Step 3
  const [labId, setLabId] = useState<string>(
    defaultLabId && labs.some((l) => l.id === defaultLabId) ? defaultLabId : (labs[0]?.id ?? ""),
  );
  const [locationId, setLocationId] = useState<string | null>(null);
  const [placement, setPlacement] = useState<PlacementCheck | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  // Step 4
  const [createdCodes, setCreatedCodes] = useState<string[] | null>(null);

  const lab = labs.find((l) => l.id === labId);
  const cabinets = lab?.locations.filter((l) => l.parentId === null) ?? [];
  const shelvesOf = (cabinetId: string) => lab?.locations.filter((l) => l.parentId === cabinetId) ?? [];

  function search(value: string) {
    setQuery(value);
    setMatches(null);
    if (value.trim().length < 2) return;
    startTransition(async () => {
      setMatches(await identifyProductAction(value));
    });
  }

  function selectLocation(id: string | null) {
    setLocationId(id);
    setPlacement(null);
    setOverrideReason("");
    if (id && selected) {
      startTransition(async () => {
        setPlacement(await checkPlacementAction(id, selected.substanceId));
      });
    }
  }

  function confirm() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const result = await checkInAction({
        substanceId: selected.substanceId,
        labId,
        locationId,
        lotNumber: lotNumber || null,
        expiryDate: expiryDate || null,
        packSize,
        unit,
        count,
        grade: grade || null,
        poNumber: poNumber || null,
        overrideReason: overrideReason || null,
      });
      if (result.ok) setCreatedCodes(result.codes);
      else setError(result.error);
    });
  }

  if (createdCodes) {
    return (
      <div className="mt-6 rounded-lg border border-ok/30 bg-ok-soft p-6">
        <h2 className="text-lg font-semibold text-ok">
          {createdCodes.length} container{createdCodes.length === 1 ? "" : "s"} received
        </h2>
        <p className="mt-1 text-sm text-ink">
          {createdCodes.join(" · ")} — in your custody, ready on the shelf.
        </p>
        <div className="mt-4 flex gap-2">
          <a
            href={`/labels/print?codes=${createdCodes.join(",")}`}
            target="_blank"
            className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-deep"
          >
            Print {createdCodes.length} label{createdCodes.length === 1 ? "" : "s"}
          </a>
          <button
            onClick={() => {
              setCreatedCodes(null);
              setStep(0);
              setSelected(null);
              setMatches(null);
              setQuery("");
            }}
            className="rounded-md border border-line bg-white px-4 py-2 text-sm text-muted hover:bg-paper"
          >
            Receive next line
          </button>
          <Link href="/inventory" className="rounded-md border border-line bg-white px-4 py-2 text-sm text-muted hover:bg-paper">
            Done
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5">
      {/* Step indicator */}
      <ol className="flex gap-2">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              i === step
                ? "bg-teal text-white"
                : i < step
                  ? "bg-teal-soft text-teal-deep"
                  : "bg-paper text-muted"
            }`}
          >
            {i < step ? "✓" : i + 1} {label}
          </li>
        ))}
      </ol>

      <div className="mt-4 rounded-lg border border-line bg-white p-5">
        {step === 0 && (
          <div>
            <label className="block text-xs font-semibold tracking-wide text-muted uppercase">
              Scan barcode or type catalogue number / name / CAS
              <input
                autoFocus
                value={query}
                onChange={(e) => search(e.target.value)}
                placeholder="▦ 252379, Acetone, 67-64-1…"
                className="mt-1 w-full max-w-md rounded-md border border-line px-3 py-2 text-sm normal-case focus:border-teal focus:outline-none"
              />
            </label>
            {matches && matches.length > 0 && (
              <ul className="mt-3 max-w-xl divide-y divide-line rounded-md border border-line">
                {matches.map((m) => (
                  <li key={m.substanceId + (m.catalogNumber ?? "")}>
                    <button
                      onClick={() => {
                        setSelected(m);
                        setStep(1);
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-teal-soft"
                    >
                      <span className="min-w-0 flex-1">
                        {m.name}
                        <span className="ml-2 text-xs text-muted">
                          {m.casNumber ? `CAS ${m.casNumber}` : "no CAS"}
                          {m.supplier ? ` · ${m.supplier}/${m.catalogNumber}` : ""}
                        </span>
                      </span>
                      <span className="text-xs text-teal">
                        {m.matchedBy === "catalog" ? "catalogue match" : m.matchedBy === "cas" ? "CAS match" : "name match"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {matches && matches.length === 0 && (
              <p className="mt-3 text-sm text-muted">No catalogue match.</p>
            )}
            <button
              onClick={() => setShowNewForm((v) => !v)}
              className="mt-3 text-sm text-teal underline-offset-2 hover:underline"
            >
              {showNewForm ? "Hide manual entry" : "No match? Enter the product manually"}
            </button>
            {showNewForm && (
              <NewSubstanceForm
                onCreated={(m) => {
                  setSelected(m);
                  setShowNewForm(false);
                  setStep(1);
                }}
              />
            )}
          </div>
        )}

        {step === 1 && selected && (
          <div>
            <div className="rounded-md bg-teal-soft px-3 py-2 text-sm">
              <strong>{selected.name}</strong>
              {selected.casNumber ? ` · CAS ${selected.casNumber}` : ""}
              {selected.supplier ? ` · ${selected.supplier}/${selected.catalogNumber}` : ""}
            </div>
            <div className="mt-4 grid max-w-2xl grid-cols-2 gap-3 md:grid-cols-3">
              <Field label="Lot number">
                <input value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} className="input" placeholder="24A-9911" />
              </Field>
              <Field label="Expiry">
                <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="input" />
              </Field>
              <Field label="Grade">
                <input value={grade} onChange={(e) => setGrade(e.target.value)} className="input" placeholder="≥98%" />
              </Field>
              <Field label="Pack size">
                <div className="flex gap-1">
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={packSize}
                    onChange={(e) => setPackSize(e.target.valueAsNumber)}
                    className="input w-24"
                  />
                  <select value={unit} onChange={(e) => setUnit(e.target.value)} className="input w-20">
                    {["mL", "L", "mg", "g", "kg", "unit"].map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </div>
              </Field>
              <Field label="Containers received">
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={count}
                  onChange={(e) => setCount(e.target.valueAsNumber)}
                  className="input w-24"
                />
              </Field>
              <Field label="PO number">
                <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className="input" placeholder="2026-4471" />
              </Field>
            </div>
          </div>
        )}

        {step === 2 && selected && (
          <div>
            <Field label="Lab">
              <select
                value={labId}
                onChange={(e) => {
                  setLabId(e.target.value);
                  selectLocation(null);
                }}
                className="input max-w-xs"
              >
                {labs.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} — {l.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="mt-3 max-w-xl space-y-1">
              {cabinets.map((cabinet) => {
                const shelves = shelvesOf(cabinet.id);
                return (
                  <div key={cabinet.id} className="rounded-md border border-line">
                    <button
                      onClick={() => selectLocation(cabinet.id)}
                      className={`flex w-full items-center px-3 py-2 text-left text-sm ${
                        locationId === cabinet.id ? "bg-teal-soft font-medium" : "hover:bg-paper"
                      }`}
                    >
                      {cabinet.name ?? cabinet.code}
                    </button>
                    {shelves.length > 0 && (
                      <div className="border-t border-line">
                        {shelves.map((shelf) => (
                          <button
                            key={shelf.id}
                            onClick={() => selectLocation(shelf.id)}
                            className={`flex w-full items-center justify-between px-6 py-1.5 text-left text-sm ${
                              locationId === shelf.id ? "bg-teal-soft font-medium" : "hover:bg-paper"
                            }`}
                          >
                            <span>{shelf.name ?? shelf.code}</span>
                            {shelf.capacity !== null && (
                              <span className="text-xs text-muted">cap. {shelf.capacity}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {cabinets.length === 0 && (
                <p className="text-sm text-muted">
                  This lab has no storage locations defined yet — you can confirm without one and
                  assign it later.
                </p>
              )}
            </div>

            {placement && (
              <div
                className={`mt-3 max-w-xl rounded-md border px-3 py-2 text-sm ${
                  placement.verdict === "COMPATIBLE"
                    ? "border-ok/40 bg-ok-soft text-ok"
                    : placement.verdict === "SEGREGATE"
                      ? "border-warning/40 bg-warning-soft text-warning"
                      : "border-danger/40 bg-danger-soft text-danger"
                }`}
              >
                {placement.verdict === "COMPATIBLE" && "✓ Compatible with cabinet contents"}
                {placement.verdict !== "COMPATIBLE" && (
                  <>
                    {placement.verdict === "SEGREGATE" ? "! Segregation required: " : "✕ Never together: "}
                    {placement.conflicts.map((c) => `${c.substance} (${c.storageClass})`).join(", ")}
                  </>
                )}
                {placement.shelfLoad && placement.shelfLoad.capacity !== null && (
                  <span className="ml-2 text-xs">
                    · shelf {placement.shelfLoad.count} / {placement.shelfLoad.capacity}
                  </span>
                )}
              </div>
            )}
            {placement && placement.verdict !== "COMPATIBLE" && (
              <Field label="Override reason (recorded in the audit trail)">
                <input
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="e.g. segregated in spill tray on shelf 3"
                  className="input max-w-xl"
                />
              </Field>
            )}
          </div>
        )}

        {step === 3 && selected && (
          <div className="flex flex-wrap gap-6">
            <div>
              <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Label preview</h3>
              <div className="mt-2 w-64 rounded-md border-2 border-ink p-3">
                <div className="text-sm font-bold uppercase">{selected.name}</div>
                <div className="text-xs">
                  {selected.casNumber ? `CAS ${selected.casNumber}` : ""} {grade ? ` · ${grade}` : ""}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex h-14 w-14 items-center justify-center border border-ink text-[8px]">
                    QR
                  </div>
                  <div>
                    <div className="font-mono text-sm font-bold">{lab?.code}-###</div>
                    <div className="text-[10px]">
                      Recv {new Date().toISOString().slice(0, 10)}
                      {expiryDate ? ` · Exp ${expiryDate}` : ""}
                    </div>
                    <div className="text-[10px]">
                      {lab?.locations.find((l) => l.id === locationId)?.code ?? "no location"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="min-w-56 flex-1">
              <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Summary</h3>
              <dl className="mt-2 space-y-1 text-sm">
                <Row k="Product" v={selected.name} />
                <Row k="Lot" v={lotNumber || "—"} />
                <Row k="Pack" v={`${packSize} ${unit} × ${count}`} />
                <Row k="Lab" v={lab ? `${lab.code} — ${lab.name}` : "—"} />
                <Row k="Location" v={lab?.locations.find((l) => l.id === locationId)?.code ?? "unassigned"} />
                <Row k="Expiry" v={expiryDate || "—"} />
                {overrideReason && <Row k="Override" v={overrideReason} />}
              </dl>
              <p className="mt-3 text-xs text-muted">
                The label is the record: container ID, QR and expiry are printed at receipt.
                Everything downstream starts by scanning it.
              </p>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        {/* Wizard controls */}
        <div className="mt-5 flex justify-between border-t border-line pt-4">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="rounded-md border border-line px-4 py-2 text-sm text-muted hover:bg-paper disabled:opacity-40"
          >
            Back
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={
                pending ||
                (step === 0 && !selected) ||
                (step === 1 && (!packSize || !count)) ||
                (step === 2 && placement !== null && placement.verdict !== "COMPATIBLE" && !overrideReason.trim())
              }
              className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-deep disabled:opacity-50"
            >
              Next
            </button>
          ) : (
            <button
              onClick={confirm}
              disabled={pending}
              className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-deep disabled:opacity-50"
            >
              {pending ? "Recording…" : `Print ${count} label${count === 1 ? "" : "s"} & confirm`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function NewSubstanceForm({ onCreated }: { onCreated: (m: IdentifyMatch) => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", casNumber: "", storageClass: "", supplier: "", catalogNumber: "" });

  return (
    <div className="mt-3 max-w-xl rounded-md border border-line bg-paper p-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Product name">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
        </Field>
        <Field label="CAS (optional)">
          <input value={form.casNumber} onChange={(e) => setForm({ ...form, casNumber: e.target.value })} className="input" placeholder="67-64-1" />
        </Field>
        <Field label="Storage class">
          <select value={form.storageClass} onChange={(e) => setForm({ ...form, storageClass: e.target.value })} className="input">
            <option value="">Unclassified (EHS review)</option>
            {["FLAMMABLE", "OXIDISER", "ACID", "BASE", "TOXIC", "WATER_REACTIVE", "GENERAL"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Supplier / catalogue">
          <div className="flex gap-1">
            <input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} className="input w-1/2" placeholder="Supplier" />
            <input value={form.catalogNumber} onChange={(e) => setForm({ ...form, catalogNumber: e.target.value })} className="input w-1/2" placeholder="Cat. no." />
          </div>
        </Field>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <button
        disabled={pending || form.name.trim().length < 2}
        onClick={() =>
          startTransition(async () => {
            const result = await createSubstanceAction(form);
            if (result.ok) onCreated(result.match);
            else setError(result.error);
          })
        }
        className="mt-3 rounded-md bg-teal px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-deep disabled:opacity-50"
      >
        Create product
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold tracking-wide text-muted uppercase">
      {label}
      <div className="mt-1 normal-case">{children}</div>
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-xs text-muted">{k}</dt>
      <dd className="min-w-0 flex-1">{v}</dd>
    </div>
  );
}
