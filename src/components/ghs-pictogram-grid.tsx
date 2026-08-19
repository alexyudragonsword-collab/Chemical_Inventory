// Fixed nine-slot GHS pictogram grid. Non-applicable diamonds are drawn
// greyed rather than omitted, so users learn positions and read hazard at a
// glance (deck, chemical detail note 1).

import type { GhsPictogram } from "@prisma/client";

const SLOTS: { code: GhsPictogram; symbol: string; label: string }[] = [
  { code: "GHS01_EXPLOSIVE", symbol: "✹", label: "Explosive" },
  { code: "GHS02_FLAMMABLE", symbol: "🔥", label: "Flammable" },
  { code: "GHS03_OXIDISER", symbol: "⌾", label: "Oxidiser" },
  { code: "GHS04_GAS", symbol: "⚗", label: "Gas under pressure" },
  { code: "GHS05_CORROSIVE", symbol: "🜂", label: "Corrosive" },
  { code: "GHS06_TOXIC", symbol: "☠", label: "Acute toxic" },
  { code: "GHS07_IRRITANT", symbol: "❗", label: "Irritant" },
  { code: "GHS08_HEALTH_HAZARD", symbol: "☢", label: "Health hazard" },
  { code: "GHS09_ENVIRONMENT", symbol: "🌊", label: "Environmental" },
];

export function GhsPictogramGrid({
  active,
  size = "md",
}: {
  active: GhsPictogram[];
  size?: "sm" | "md";
}) {
  const cell =
    size === "sm" ? "h-7 w-7 text-sm rounded" : "h-11 w-11 text-xl rounded-md";
  return (
    <div className={`grid w-fit grid-cols-9 ${size === "sm" ? "gap-1" : "gap-1.5"}`}>
      {SLOTS.map((slot) => {
        const on = active.includes(slot.code);
        return (
          <div
            key={slot.code}
            title={`${slot.label}${on ? "" : " (not applicable)"}`}
            className={`flex items-center justify-center border ${cell} ${
              on
                ? "border-danger/40 bg-danger-soft"
                : "border-line bg-paper opacity-35 grayscale"
            }`}
          >
            <span role="img" aria-label={slot.label}>
              {slot.symbol}
            </span>
          </div>
        );
      })}
    </div>
  );
}
