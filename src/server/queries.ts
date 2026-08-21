// Shared read-side helpers for Server Components.

import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/server/authz";

/** Prisma filter matching the user's editable set (the custody rule). */
export function custodyWhere(user: SessionUser): Prisma.ContainerWhereInput {
  const managedLabIds = user.memberships.filter((m) => m.isManager).map((m) => m.labId);
  return {
    OR: [{ custodianId: user.id }, ...(managedLabIds.length ? [{ labId: { in: managedLabIds } }] : [])],
  };
}

export function managedLabIds(user: SessionUser): string[] {
  return user.memberships.filter((m) => m.isManager).map((m) => m.labId);
}

/** Free-text search over name / CAS / container code. */
export function containerSearchWhere(q: string): Prisma.ContainerWhereInput {
  const term = q.trim();
  if (!term) return {};
  return {
    OR: [
      { code: { contains: term, mode: "insensitive" } },
      { substance: { name: { contains: term, mode: "insensitive" } } },
      { substance: { casNumber: { contains: term, mode: "insensitive" } } },
      { lotNumber: { contains: term, mode: "insensitive" } },
    ],
  };
}

export type InventoryFilterParams = {
  q?: string;
  scope?: string;
  hazard?: string;
  status?: string;
  lab?: string;
};

/** The inventory list / CSV export share this filter builder. */
export function buildInventoryWhere(
  user: SessionUser,
  params: InventoryFilterParams,
): Prisma.ContainerWhereInput {
  const scopeMine = params.scope !== "all";
  const now = new Date();
  const soon = new Date(Date.now() + 30 * 86_400_000);
  const statusWhere: Prisma.ContainerWhereInput =
    params.status === "expiring"
      ? { expiryDate: { gte: now, lte: soon } }
      : params.status === "expired"
        ? { expiryDate: { lt: now } }
        : {};
  return {
    // Disposed containers are hidden from working views but stay on record;
    // the explicit "Disposed" filter is the registry of everything disposed.
    status: params.status === "disposed" ? "DISPOSED" : { notIn: ["DISPOSED"] },
    AND: [
      scopeMine ? custodyWhere(user) : {},
      params.q ? containerSearchWhere(params.q) : {},
      params.hazard && HAZARD_FILTERS[params.hazard] ? HAZARD_FILTERS[params.hazard] : {},
      params.lab ? { lab: { code: params.lab } } : {},
      statusWhere,
    ],
  };
}

export const HAZARD_FILTERS: Record<string, Prisma.ContainerWhereInput> = {
  flammable: { substance: { ghs: { storageClass: "FLAMMABLE" } } },
  toxic: { substance: { ghs: { storageClass: "TOXIC" } } },
  corrosive: { substance: { ghs: { storageClass: { in: ["ACID", "BASE"] } } } },
  oxidiser: { substance: { ghs: { storageClass: "OXIDISER" } } },
  "water-reactive": { substance: { ghs: { storageClass: "WATER_REACTIVE" } } },
  controlled: { substance: { isControlled: true } },
};
