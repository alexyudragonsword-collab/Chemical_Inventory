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

export const HAZARD_FILTERS: Record<string, Prisma.ContainerWhereInput> = {
  flammable: { substance: { ghs: { storageClass: "FLAMMABLE" } } },
  toxic: { substance: { ghs: { storageClass: "TOXIC" } } },
  corrosive: { substance: { ghs: { storageClass: { in: ["ACID", "BASE"] } } } },
  oxidiser: { substance: { ghs: { storageClass: "OXIDISER" } } },
  "water-reactive": { substance: { ghs: { storageClass: "WATER_REACTIVE" } } },
  controlled: { substance: { isControlled: true } },
};
