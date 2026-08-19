"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { WitnessRequiredError } from "@/server/audit";
import { AuthzError } from "@/server/authz";
import { DomainError, verifyWitness } from "@/server/inventory";
import {
  annotateCount,
  claimForeignContainer,
  recordScan,
  resolveByCorrection,
  signOffStocktake,
  startStocktake,
  submitForSignOff,
} from "@/server/stocktake";
import { requireUser } from "@/server/session";

export type ActionResult = { ok: boolean; error?: string; needWitness?: boolean };

function handle(error: unknown): ActionResult {
  if (error instanceof WitnessRequiredError) return { ok: false, error: error.message, needWitness: true };
  if (error instanceof DomainError) return { ok: false, error: error.message };
  if (error instanceof AuthzError) return { ok: false, error: "Not authorized for this lab's stocktake" };
  console.error("stocktake action failed", error);
  return { ok: false, error: "Unexpected error" };
}

export async function startStocktakeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const labId = String(formData.get("labId"));
  let sessionId: string | null = null;
  try {
    const session = await startStocktake(user, labId);
    sessionId = session.id;
  } catch {
    // Errors surface as "already in progress" on the list page.
  }
  revalidatePath("/stocktake");
  if (sessionId) redirect(`/stocktake/${sessionId}`);
}

export async function recordScanAction(input: {
  sessionId: string;
  code: string;
  countedQuantity: number | null;
}): Promise<ActionResult & { discrepancy?: string }> {
  const user = await requireUser();
  try {
    const count = await recordScan(user, input.sessionId, input.code.trim(), input.countedQuantity);
    revalidatePath(`/stocktake/${input.sessionId}`);
    return { ok: true, discrepancy: count.discrepancy };
  } catch (error) {
    return handle(error);
  }
}

export async function resolveCorrectionAction(input: {
  countId: string;
  sessionId: string;
  witnessEmail?: string;
  witnessPassword?: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  try {
    let witnessId: string | undefined;
    if (input.witnessEmail && input.witnessPassword) {
      witnessId = await verifyWitness(user.id, input.witnessEmail, input.witnessPassword);
    }
    await resolveByCorrection(user, input.countId, witnessId);
    revalidatePath(`/stocktake/${input.sessionId}`);
    return { ok: true };
  } catch (error) {
    return handle(error);
  }
}

export async function claimAction(input: { countId: string; sessionId: string }): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await claimForeignContainer(user, input.countId);
    revalidatePath(`/stocktake/${input.sessionId}`);
    return { ok: true };
  } catch (error) {
    return handle(error);
  }
}

export async function annotateAction(input: {
  countId: string;
  sessionId: string;
  note: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await annotateCount(user, input.countId, input.note);
    revalidatePath(`/stocktake/${input.sessionId}`);
    return { ok: true };
  } catch (error) {
    return handle(error);
  }
}

export async function submitAction(input: { sessionId: string }): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await submitForSignOff(user, input.sessionId);
    revalidatePath(`/stocktake/${input.sessionId}`);
    return { ok: true };
  } catch (error) {
    return handle(error);
  }
}

export async function signOffAction(input: { sessionId: string }): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await signOffStocktake(user, input.sessionId);
    revalidatePath(`/stocktake/${input.sessionId}`);
    return { ok: true };
  } catch (error) {
    return handle(error);
  }
}
