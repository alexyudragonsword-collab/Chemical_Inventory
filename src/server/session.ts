// Session loading for Server Components and Server Actions.
// The JWT is treated as a session pointer only: the User row is re-read on
// every request so deactivation, role changes and tokenVersion bumps take
// effect immediately.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/server/authz";

export const WORKSPACE_COOKIE = "chemtrack-workspace";

export type CurrentUser = SessionUser & {
  email: string;
  name: string;
  /** Default editable scope, chosen at sign-in, switchable without sign-out. */
  workspaceLabId: string | null;
};

/** Load the signed-in user with memberships, or null. Cached per request. */
export const getSessionUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { labMemberships: { select: { labId: true, isManager: true } } },
  });
  if (!user || !user.isActive) return null;

  const cookieStore = await cookies();
  const requested = cookieStore.get(WORKSPACE_COOKIE)?.value ?? null;
  const memberships = user.labMemberships;
  const workspaceLabId =
    requested && memberships.some((m) => m.labId === requested)
      ? requested
      : (memberships.find((m) => m.isManager)?.labId ?? memberships[0]?.labId ?? null);

  return {
    id: user.id,
    role: user.role,
    memberships,
    email: user.email,
    name: user.name,
    workspaceLabId,
  };
});

/** Like getSessionUser but redirects to sign-in when unauthenticated. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  return user;
}
