"use server";

import { AuthError } from "next-auth";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signIn } from "@/lib/auth";
import { writeAuditEvent } from "@/server/audit";

export type SignUpState = { error?: string };

const signUpSchema = z
  .object({
    name: z.string().trim().min(2, "Please enter your name"),
    email: z.string().trim().toLowerCase().email("Please enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

export async function signUpAction(
  _prev: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "An account with this email already exists — sign in instead." };
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // Self-registration always lands on the read-only Viewer role; an admin
  // raises access and assigns labs in Admin → Users.
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name, email, passwordHash, role: "VIEWER" },
    });
    await writeAuditEvent(tx, {
      eventType: "user.register",
      actorId: user.id,
      entityType: "user",
      entityId: user.id,
      payload: { email, name, role: "VIEWER", reason: "Self-registration" },
    });
  });

  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      // Account exists and is fine — let them sign in manually.
      return { error: "Account created — please sign in." };
    }
    throw error; // NEXT_REDIRECT on success
  }
}
