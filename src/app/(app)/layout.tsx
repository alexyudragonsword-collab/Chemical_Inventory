import Link from "next/link";
import { cookies } from "next/headers";
import { APPEARANCE_COOKIE, normalizeAppearance } from "@/lib/appearance";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/session";
import { can } from "@/server/authz";
import { AppearanceSwitcher } from "@/components/appearance-switcher";
import { GlobalSearch } from "@/components/global-search";
import { SidebarNav } from "@/components/sidebar-nav";
import { signOutAction, switchWorkspaceAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const appearance = normalizeAppearance((await cookies()).get(APPEARANCE_COOKIE)?.value);

  const [workspaceLab, memberLabs, custodyCount] = await Promise.all([
    user.workspaceLabId
      ? prisma.lab.findUnique({ where: { id: user.workspaceLabId }, select: { id: true, code: true, name: true } })
      : null,
    prisma.lab.findMany({
      where: { id: { in: user.memberships.map((m) => m.labId) } },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.container.count({
      where: {
        status: { notIn: ["DISPOSED"] },
        OR: [
          { custodianId: user.id },
          {
            labId: {
              in: user.memberships.filter((m) => m.isManager).map((m) => m.labId),
            },
          },
        ],
      },
    }),
  ]);

  const showAdmin = can(user, "manage_users") || can(user, "view_audit") || can(user, "resolve_import_fixup");

  return (
    <div className="flex min-h-screen">
      <aside className="no-print flex w-52 shrink-0 flex-col bg-nav text-nav-fg">
        <Link href="/dashboard" className="flex items-center gap-2.5 px-4 py-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-nav-accent text-sm font-bold text-white">
            C
          </span>
          <span className="text-lg font-semibold tracking-tight">ChemTrack</span>
        </Link>
        <SidebarNav showAdmin={showAdmin} />
        <div className="mt-auto border-t border-nav-line p-4">
          <div className="text-sm font-medium">{user.name}</div>
          <div className="text-xs text-nav-muted">{roleLabel(user.role)}</div>
          <form action={signOutAction}>
            <button className="mt-2 text-xs text-nav-muted underline-offset-2 hover:text-nav-fg hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex items-center gap-4 border-b border-line bg-card px-6 py-3">
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-3 text-sm">
            <AppearanceSwitcher current={appearance} />
            {memberLabs.length > 0 && (
              <form action={switchWorkspaceAction} className="flex items-center gap-2">
                <span className="text-xs tracking-wide text-muted uppercase">Workspace</span>
                <select
                  name="labId"
                  defaultValue={workspaceLab?.id ?? ""}
                  className="rounded-md border border-line bg-card px-2 py-1 text-sm"
                >
                  {memberLabs.map((lab) => (
                    <option key={lab.id} value={lab.id}>
                      {lab.code} — {lab.name}
                    </option>
                  ))}
                </select>
                <button className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:bg-paper">
                  Switch
                </button>
              </form>
            )}
            <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
              {custodyCount} in my custody
            </span>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}

function roleLabel(role: string): string {
  return role
    .toLowerCase()
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}
