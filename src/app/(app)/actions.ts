"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signOut } from "@/lib/auth";
import { requireUser, WORKSPACE_COOKIE } from "@/server/session";

export async function signOutAction() {
  await signOut({ redirectTo: "/sign-in" });
}

/** Switch the default editable scope without signing out (deck, slide 5). */
export async function switchWorkspaceAction(formData: FormData) {
  const user = await requireUser();
  const labId = formData.get("labId");
  if (typeof labId === "string" && user.memberships.some((m) => m.labId === labId)) {
    const cookieStore = await cookies();
    cookieStore.set(WORKSPACE_COOKIE, labId, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 90,
    });
  }
  redirect("/dashboard");
}
