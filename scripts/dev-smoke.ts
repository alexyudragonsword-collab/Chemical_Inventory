// Ad-hoc smoke test of the domain layer against the seeded dev DB.
import { PrismaClient } from "@prisma/client";
import { adjustQuantity, reverseTransaction } from "../src/server/inventory";
import { verifyAuditChain } from "./verify-audit-chain";

const prisma = new PrismaClient();

async function main() {
  const liwei = await prisma.user.findUniqueOrThrow({ where: { email: "li.wei@lab.internal" }, include: { labMemberships: true } });
  const riyer = await prisma.user.findUniqueOrThrow({ where: { email: "r.iyer@lab.internal" }, include: { labMemberships: true } });
  const asUser = (u: typeof liwei) => ({ id: u.id, role: u.role, memberships: u.labMemberships.map(m => ({ labId: m.labId, isManager: m.isManager })) });
  const container = await prisma.container.findUniqueOrThrow({ where: { code: "B2-14-A11" } });

  // 1. Authorized deduct
  const r1 = await adjustQuantity({ user: asUser(liwei), containerId: container.id, mode: "DEDUCT", amount: 50, reason: "Smoke test deduct" });
  console.log("deduct ok:", r1.before, "->", r1.after);

  // 2. Reversal within window
  const r2 = await reverseTransaction({ user: asUser(liwei), transactionId: r1.transactionId });
  console.log("reversal ok:", r2.before, "->", r2.after);

  // 3. Unauthorized deduct by R. Iyer (not custodian) -> AuthzError + auth.denied logged
  try {
    await adjustQuantity({ user: asUser(riyer), containerId: container.id, mode: "DEDUCT", amount: 10, reason: "Should fail" });
    console.log("ERROR: unauthorized deduct succeeded");
    process.exitCode = 1;
  } catch (e) {
    console.log("unauthorized deduct rejected:", (e as Error).name);
  }
  const denied = await prisma.auditEvent.count({ where: { eventType: "auth.denied", actorId: riyer.id } });
  console.log("auth.denied events for R. Iyer:", denied);

  // 4. Controlled substance: witnessless deduct must fail even for custodian Li Wei... (KCN custodian is liwei, LAB_MANAGER OWN handling)
  const kcn = await prisma.container.findUniqueOrThrow({ where: { code: "B2-14-P01" } });
  try {
    await adjustQuantity({ user: asUser(liwei), containerId: kcn.id, mode: "DEDUCT", amount: 5, reason: "No witness" });
    console.log("ERROR: controlled deduct without witness succeeded");
    process.exitCode = 1;
  } catch (e) {
    console.log("controlled without witness rejected:", (e as Error).name);
  }

  // 5. Quantity unchanged after failed attempts + chain verifies
  const after = await prisma.container.findUniqueOrThrow({ where: { code: "B2-14-A11" } });
  console.log("final quantity B2-14-A11:", after.currentQuantity.toString());
  const chain = await verifyAuditChain(prisma);
  console.log("audit chain:", chain.ok ? `OK (${chain.checked} events)` : `BROKEN: ${chain.detail}`);
  if (!chain.ok) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
