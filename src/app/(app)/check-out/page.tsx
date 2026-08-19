// Check-out: one scanned context, three outcomes (deduct / transfer /
// dispose), with warnings shown BEFORE the action controls.

import { prisma } from "@/lib/prisma";
import { authorizeContainer } from "@/server/authz";
import { requireUser } from "@/server/session";
import { ScanInput } from "@/components/scan-input";
import { CheckOutPanel } from "./panel";

export const dynamic = "force-dynamic";

export default async function CheckOutPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const user = await requireUser();
  const { code } = await searchParams;

  const container = code
    ? await prisma.container.findUnique({
        where: { code },
        include: {
          substance: { include: { ghs: { select: { storageClass: true, pictograms: true } } } },
          lab: { select: { code: true } },
          location: { select: { code: true, name: true } },
          custodian: { select: { id: true, name: true } },
        },
      })
    : null;

  const [projects, labMembers] = container
    ? await Promise.all([
        prisma.project.findMany({ where: { isActive: true }, select: { code: true, name: true } }),
        prisma.user.findMany({
          where: { isActive: true, id: { not: user.id } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
      ])
    : [[], []];

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-teal-deep">Check-out container</h1>
      <p className="text-sm text-muted">
        Scan the label to deduct, transfer or dispose — all three reduce quantity in your custody,
        so they share one scanned context.
      </p>

      <div className="mt-4">
        <ScanInput targetPath="/check-out" />
      </div>

      {code && !container && (
        <p className="mt-4 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          No container with code “{code}”. Check the label or search the inventory.
        </p>
      )}

      {container && (
        <CheckOutPanel
          container={{
            id: container.id,
            code: container.code,
            substanceName: container.substance.name,
            cas: container.substance.casNumber,
            lot: container.lotNumber,
            unit: container.unit,
            currentQuantity: container.currentQuantity.toNumber(),
            packSize: container.initialQuantity.toNumber(),
            status: container.status,
            expiryDate: container.expiryDate?.toISOString() ?? null,
            storageClass: container.substance.ghs?.storageClass ?? null,
            isControlled: container.substance.isControlled,
            labCode: container.lab.code,
            location: container.location?.name ?? container.location?.code ?? null,
            custodianName: container.custodian?.name ?? null,
            useFirst: container.useFirst,
          }}
          mode={authorizeContainer(user, "deduct", {
            id: container.id,
            labId: container.labId,
            custodianId: container.custodianId,
            isControlled: container.substance.isControlled,
          })}
          disposeMode={authorizeContainer(user, "dispose", {
            id: container.id,
            labId: container.labId,
            custodianId: container.custodianId,
            isControlled: container.substance.isControlled,
          })}
          transferMode={authorizeContainer(user, "transfer", {
            id: container.id,
            labId: container.labId,
            custodianId: container.custodianId,
            isControlled: container.substance.isControlled,
          })}
          projects={projects}
          people={labMembers}
        />
      )}
    </div>
  );
}
