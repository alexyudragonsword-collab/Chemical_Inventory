"use server";

import { AuthError } from "next-auth";
import { cookies } from "next/headers";
import { signIn } from "@/lib/auth";
import { WORKSPACE_COOKIE } from "@/server/session";

export type SignInState = { error?: string };

export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const workspace = formData.get("workspace");
  if (typeof workspace === "string" && workspace) {
    const cookieStore = await cookies();
    cookieStore.set(WORKSPACE_COOKIE, workspace, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 90,
    });
  }

  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Email or password is incorrect, or the account is inactive." };
    }
    throw error; // NEXT_REDIRECT on success
  }
}
