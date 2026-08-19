"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { writeAuditEvent } from "@/server/audit";
import { can } from "@/server/authz";
import { requireUser } from "@/server/session";

async function requireAdmin() {
  const user = await requireUser();
  if (!can(user, "manage_users")) throw new Error("Admin only");
  return user;
}

export async function createUserAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const email = String(formData.get("email")).toLowerCase().trim();
  const name = String(formData.get("name")).trim();
  const role = String(formData.get("role")) as Role;
  const password = String(formData.get("password"));
  const labId = String(formData.get("labId"));
  const isManager = formData.get("isManager") === "on";

  if (!email || !name || password.length < 8) return;
  if (await prisma.user.findUnique({ where: { email } })) return;

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name,
        role,
        passwordHash: await bcrypt.hash(password, 10),
        labMemberships: labId ? { create: { labId, isManager } } : undefined,
      },
    });
    await writeAuditEvent(tx, {
      eventType: "user.created",
      actorId: admin.id,
      entityType: "user",
      entityId: user.id,
      payload: { email, name, role, labId: labId || null, isManager },
    });
  });
  revalidatePath("/admin/users");
}

export async function updateUserAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId"));
  const role = String(formData.get("role")) as Role;
  const isActive = formData.get("isActive") === "true";

  const before = await prisma.user.findUnique({ where: { id: userId } });
  if (!before) return;
  // An admin cannot demote or deactivate themselves — avoids lockout.
  if (userId === admin.id && (role !== "ADMIN" || !isActive)) return;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { role, isActive, tokenVersion: { increment: 1 } },
    });
    await writeAuditEvent(tx, {
      eventType: "user.updated",
      actorId: admin.id,
      entityType: "user",
      entityId: userId,
      payload: {
        email: before.email,
        role: { before: before.role, after: role },
        isActive: { before: before.isActive, after: isActive },
      },
    });
  });
  revalidatePath("/admin/users");
}

export async function setMembershipAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId"));
  const labId = String(formData.get("labId"));
  const isManager = formData.get("isManager") === "on";
  const remove = formData.get("remove") === "1";
  if (!userId || !labId) return;

  await prisma.$transaction(async (tx) => {
    if (remove) {
      await tx.labMembership.deleteMany({ where: { userId, labId } });
    } else {
      await tx.labMembership.upsert({
        where: { userId_labId: { userId, labId } },
        update: { isManager },
        create: { userId, labId, isManager },
      });
    }
    await writeAuditEvent(tx, {
      eventType: remove ? "user.membership_removed" : "user.membership_set",
      actorId: admin.id,
      entityType: "user",
      entityId: userId,
      payload: { labId, isManager, removed: remove },
    });
  });
  revalidatePath("/admin/users");
}
