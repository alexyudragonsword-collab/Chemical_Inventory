"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { WitnessRequiredError } from "@/server/audit";
import { AuthzError } from "@/server/authz";
import {
  adjustQuantity,
  DomainError,
  reverseTransaction,
  verifyWitness,
} from "@/server/inventory";
import { requireUser } from "@/server/session";

const adjustSchema = z.object({
  containerId: z.string().min(1),
  mode: z.enum(["DEDUCT", "ADD", "CORRECT"]),
  amount: z.coerce.number().nonnegative(),
  reason: z.string().trim().min(1, "Purpose is required"),
  projectCode: z.string().trim().optional(),
  witnessEmail: z.string().trim().optional(),
  witnessPassword: z.string().optional(),
});

export type AdjustResult =
  | { ok: true; before: number; after: number; transactionId: string }
  | { ok: false; error: string; needWitness?: boolean };

export async function adjustQuantityAction(input: unknown): Promise<AdjustResult> {
  const user = await requireUser();
  const parsed = adjustSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  try {
    let witnessId: string | undefined;
    if (data.witnessEmail && data.witnessPassword) {
      witnessId = await verifyWitness(user.id, data.witnessEmail, data.witnessPassword);
    }
    const result = await adjustQuantity({
      user,
      containerId: data.containerId,
      mode: data.mode,
      amount: data.amount,
      reason: data.reason,
      projectCode: data.projectCode || undefined,
      witnessId,
    });
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { ok: true, before: result.before, after: result.after, transactionId: result.transactionId };
  } catch (error) {
    if (error instanceof WitnessRequiredError) {
      return { ok: false, error: error.message, needWitness: true };
    }
    if (error instanceof AuthzError) {
      return { ok: false, error: "You are not authorized to change this container. The attempt has been logged." };
    }
    if (error instanceof DomainError) {
      return { ok: false, error: error.message };
    }
    console.error("adjustQuantityAction failed", error);
    return { ok: false, error: "Unexpected error — nothing was recorded." };
  }
}

export async function reverseTransactionAction(transactionId: string): Promise<AdjustResult> {
  const user = await requireUser();
  try {
    const result = await reverseTransaction({ user, transactionId });
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { ok: true, before: result.before, after: result.after, transactionId };
  } catch (error) {
    if (error instanceof DomainError || error instanceof AuthzError) {
      return { ok: false, error: error.message };
    }
    console.error("reverseTransactionAction failed", error);
    return { ok: false, error: "Unexpected error — nothing was recorded." };
  }
}
