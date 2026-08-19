import { prisma } from "@/lib/prisma";
import { can } from "@/server/authz";
import { requireUser } from "@/server/session";
import { CheckInWizard } from "./wizard";

export const dynamic = "force-dynamic";

export default async function CheckInPage() {
  const user = await requireUser();

  const labs = await prisma.lab.findMany({
    where:
      user.role === "ADMIN"
        ? {}
        : { id: { in: user.memberships.filter((m) => m.isManager).map((m) => m.labId) } },
    include: {
      locations: {
        select: { id: true, code: true, name: true, kind: true, parentId: true, capacity: true },
        orderBy: { code: "asc" },
      },
    },
    orderBy: { code: "asc" },
  });

  if (!can(user, "check_in") && user.role !== "ADMIN") {
    return (
      <div>
        <h1 className="text-xl font-semibold text-teal-deep">Check-In</h1>
        <p className="mt-4 text-sm text-muted">
          Receiving stock requires the Custodian or Lab Manager role in a lab. Ask your lab manager
          to receive deliveries, or to grant you the role.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-teal-deep">Receive delivery</h1>
      <p className="text-sm text-muted">
        Scan first, type second — a matched barcode or catalogue number fills the identity fields.
        Two containers of the same lot produce two records and two labels.
      </p>
      <CheckInWizard
        labs={labs.map((lab) => ({
          id: lab.id,
          code: lab.code,
          name: lab.name,
          locations: lab.locations,
        }))}
        defaultLabId={user.workspaceLabId}
      />
    </div>
  );
}
