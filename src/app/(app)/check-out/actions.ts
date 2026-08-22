"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { WitnessRequiredError } from "@/server/audit";
import { AuthzError } from "@/server/authz";
import {
  adjustQuantity,
  disposeContainer,
  DomainError,
  transferCustody,
  verifyWitness,
} from "@/server/inventory";
import { requireUser } from "@/server/session";

export type CheckOutResult =
  | { ok: true; message: string; transactionId?: string }
  | { ok: false; error: string; needWitness?: boolean };

// The audit trail requires a non-empty reason on every transaction; the
// forms no longer ask for one, so each action records what happened.
const deductSchema = z.object({
  containerId: z.string().min(1),
  amount: z.coerce.number().positive(),
  reason: z.string().trim().optional(),
  projectCode: z.string().trim().optional(),
  dispensedInto: z.string().trim().optional(),
  fumeHood: z.string().trim().optional(),
  checklist: z.array(z.string()).optional(),
  witnessEmail: z.string().trim().optional(),
  witnessPassword: z.string().optional(),
});

export async function checkOutDeductAction(input: unknown): Promise<CheckOutResult> {
  const user = await requireUser();
  const parsed = deductSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const data = parsed.data;

  try {
    let witnessId: string | undefined;
    if (data.witnessEmail && data.witnessPassword) {
      witnessId = await verifyWitness(user.id, data.witnessEmail, data.witnessPassword);
    }
    const result = await adjustQuantity({
      user,
      containerId: data.containerId,
      mode: "DEDUCT",
      amount: data.amount,
      reason: data.reason || "Quantity deducted",
      projectCode: data.projectCode || undefined,
      witnessId,
      // The pre-dispense checks are captured in the audit record, not
      // enforced — EHS preferred a truthful record (deck, note 3).
      context: {
        dispensedInto: data.dispensedInto ?? null,
        fumeHood: data.fumeHood ?? null,
        checklist: data.checklist ?? [],
      },
    });
    revalidatePath("/inventory");
    return {
      ok: true,
      transactionId: result.transactionId,
      message: `Deducted — ${result.before} → ${result.after}. Reversible for 15 minutes.`,
    };
  } catch (error) {
    return toResult(error);
  }
}

const transferSchema = z.object({
  containerId: z.string().min(1),
  toUserId: z.string().min(1),
  reason: z.string().trim().optional(),
  witnessEmail: z.string().trim().optional(),
  witnessPassword: z.string().optional(),
});

export async function checkOutTransferAction(input: unknown): Promise<CheckOutResult> {
  const user = await requireUser();
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const data = parsed.data;

  try {
    let witnessId: string | undefined;
    if (data.witnessEmail && data.witnessPassword) {
      witnessId = await verifyWitness(user.id, data.witnessEmail, data.witnessPassword);
    }
    const result = await transferCustody({
      user,
      containerId: data.containerId,
      toUserId: data.toUserId,
      reason: data.reason || "Custody transfer",
      witnessId,
    });
    revalidatePath("/inventory");
    return { ok: true, message: `Custody transferred to ${result.toUserName}.` };
  } catch (error) {
    return toResult(error);
  }
}

const disposeSchema = z.object({
  containerId: z.string().min(1),
  reason: z.string().trim().optional(),
  wasteStream: z.string().trim().optional(),
  witnessEmail: z.string().trim().optional(),
  witnessPassword: z.string().optional(),
});

export async function checkOutDisposeAction(input: unknown): Promise<CheckOutResult> {
  const user = await requireUser();
  const parsed = disposeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const data = parsed.data;

  try {
    let witnessId: string | undefined;
    if (data.witnessEmail && data.witnessPassword) {
      witnessId = await verifyWitness(user.id, data.witnessEmail, data.witnessPassword);
    }
    await disposeContainer({
      user,
      containerId: data.containerId,
      reason: data.reason || "Container disposed",
      wasteStream: data.wasteStream || undefined,
      witnessId,
    });
    revalidatePath("/inventory");
    return { ok: true, message: "Container disposed. It stays on record as DISPOSED." };
  } catch (error) {
    return toResult(error);
  }
}

function toResult(error: unknown): CheckOutResult {
  if (error instanceof WitnessRequiredError) {
    return { ok: false, error: error.message, needWitness: true };
  }
  if (error instanceof AuthzError) {
    return { ok: false, error: "You are not authorized for this container. The attempt has been logged." };
  }
  if (error instanceof DomainError) return { ok: false, error: error.message };
  console.error("check-out action failed", error);
  return { ok: false, error: "Unexpected error — nothing was recorded." };
}
