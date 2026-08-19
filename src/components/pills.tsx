// Status / hazard / custody pills — the design system's most reused atoms.

const TONES = {
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
  ok: "bg-ok-soft text-ok",
  info: "bg-info-soft text-info",
  restricted: "bg-restricted-soft text-restricted",
  accent: "bg-accent-soft text-accent",
  neutral: "bg-paper text-muted",
} as const;

export type PillTone = keyof typeof TONES;

export function Pill({ tone, children }: { tone: PillTone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function HazardPill({ storageClass }: { storageClass: string | null | undefined }) {
  switch (storageClass) {
    case "FLAMMABLE":
      return <Pill tone="warning">Flammable</Pill>;
    case "OXIDISER":
      return <Pill tone="danger">Oxidiser</Pill>;
    case "ACID":
    case "BASE":
      return <Pill tone="danger">Corrosive</Pill>;
    case "TOXIC":
      return <Pill tone="danger">Toxic</Pill>;
    case "WATER_REACTIVE":
      return <Pill tone="warning">Water-reactive</Pill>;
    default:
      return <Pill tone="neutral">General</Pill>;
  }
}

export function ExpiryPill({ expiryDate }: { expiryDate: Date | null }) {
  if (!expiryDate) return <Pill tone="neutral">No expiry</Pill>;
  const days = Math.ceil((expiryDate.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return <Pill tone="danger">Expired {-days} d ago</Pill>;
  if (days <= 30) return <Pill tone="warning">Expires in {days} d</Pill>;
  return <Pill tone="ok">In date</Pill>;
}

export function CustodyPill() {
  return <Pill tone="accent">My custody</Pill>;
}

export function ControlledPill() {
  return <Pill tone="restricted">Controlled</Pill>;
}

export function StatusPill({ status }: { status: string }) {
  switch (status) {
    case "ACTIVE":
      return <Pill tone="ok">Active</Pill>;
    case "EMPTY":
      return <Pill tone="neutral">Empty</Pill>;
    case "DISPOSED":
      return <Pill tone="neutral">Disposed</Pill>;
    case "MISSING":
      return <Pill tone="danger">Missing</Pill>;
    case "QUARANTINED":
      return <Pill tone="warning">Quarantined</Pill>;
    default:
      return <Pill tone="neutral">{status}</Pill>;
  }
}
