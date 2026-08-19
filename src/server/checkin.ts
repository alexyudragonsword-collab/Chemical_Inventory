// Check-in: receiving a delivery. N containers of the same lot produce N
// records and N labels — that is what makes the container-as-unit principle
// real (deck, check-in note).

import { Prisma, type CanonicalUnit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditEvent } from "@/server/audit";
import { AuthzError, can, type SessionUser } from "@/server/authz";
import { checkPlacement } from "@/server/compatibility";
import { DomainError } from "@/server/inventory";

export type CheckInInput = {
  substanceId: string;
  labId: string;
  locationId: string | null;
  lotNumber: string | null;
  expiryDate: Date | null;
  packSize: number;
  unit: CanonicalUnit;
  count: number;
  grade: string | null;
  poNumber: string | null;
  /** Required when the placement check said SEGREGATE / NEVER_TOGETHER. */
  overrideReason: string | null;
};

export async function checkInContainers(user: SessionUser, input: CheckInInput) {
  if (!can(user, "check_in", input.labId)) throw new AuthzError("denied", "check_in");
  if (input.count < 1 || input.count > 50) throw new DomainError("Count must be between 1 and 50");
  if (!(input.packSize > 0)) throw new DomainError("Pack size must be positive");

  return prisma.$transaction(async (tx) => {
    const substance = await tx.substance.findUnique({
      where: { id: input.substanceId },
      include: { ghs: { select: { storageClass: true } } },
    });
    if (!substance) throw new DomainError("Substance not found");
    const lab = await tx.lab.findUnique({ where: { id: input.labId } });
    if (!lab) throw new DomainError("Lab not found");

    // Storage rules run before commit; an incompatible choice demands an
    // override reason, which is recorded on the audit event.
    let placementVerdict = "COMPATIBLE";
    if (input.locationId) {
      const placement = await checkPlacement(tx, input.locationId, substance.ghs?.storageClass ?? null);
      placementVerdict = placement.verdict;
      if (placement.verdict !== "COMPATIBLE" && !input.overrideReason?.trim()) {
        throw new DomainError(
          `Storage conflict (${placement.verdict.toLowerCase().replace("_", " ")}): ` +
            placement.conflicts
              .map((c) => `${c.substanceB} (${c.classB})`)
              .slice(0, 3)
              .join(", ") +
            ". Choose another location or provide an override reason.",
        );
      }
    }

    // Sequential codes per lab: <LAB>-001, -002, … with gap-safe retry.
    const existing = await tx.container.count({ where: { labId: lab.id } });
    const codes: string[] = [];
    let next = existing + 1;
    for (let i = 0; i < input.count; i++) {
      let code = `${lab.code}-${String(next).padStart(3, "0")}`;
      // Skip codes already taken (imports use legacy Sub IDs, so clashes are
      // rare but possible after manual creation).
      while (await tx.container.findUnique({ where: { code } })) {
        next++;
        code = `${lab.code}-${String(next).padStart(3, "0")}`;
      }
      codes.push(code);
      next++;
    }

    const created = [];
    for (const code of codes) {
      const container = await tx.container.create({
        data: {
          code,
          substanceId: substance.id,
          labId: lab.id,
          locationId: input.locationId,
          custodianId: user.id,
          currentQuantity: new Prisma.Decimal(input.packSize),
          initialQuantity: new Prisma.Decimal(input.packSize),
          unit: input.unit,
          lotNumber: input.lotNumber,
          grade: input.grade,
          expiryDate: input.expiryDate,
          receivedAt: new Date(),
        },
      });
      const event = await writeAuditEvent(tx, {
        eventType: "container.check_in",
        actorId: user.id,
        entityType: "container",
        entityId: container.id,
        payload: {
          containerCode: code,
          substance: substance.name,
          before: 0,
          after: input.packSize,
          unit: input.unit,
          reason: input.poNumber ? `Received against PO ${input.poNumber}` : "Received delivery",
          lot: input.lotNumber,
          placementVerdict,
          overrideReason: input.overrideReason ?? null,
        },
      });
      await tx.inventoryTransaction.create({
        data: {
          auditEventId: event.id,
          containerId: container.id,
          kind: "CHECK_IN",
          quantityBefore: new Prisma.Decimal(0),
          quantityAfter: new Prisma.Decimal(input.packSize),
          unit: input.unit,
          reason: input.poNumber ? `PO ${input.poNumber}` : "Received delivery",
        },
      });
      created.push({ id: container.id, code });
    }

    return created;
  });
}
