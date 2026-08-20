import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/server/authz";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireUser();
  const [pendingFixups, userCount] = await Promise.all([
    prisma.container.count({ where: { pendingCorrection: { not: Prisma.DbNull } } }),
    prisma.user.count(),
  ]);

  const cards = [
    can(user, "manage_users") && {
      href: "/admin/users",
      title: "Users & roles",
      detail: `${userCount} accounts · permission matrix`,
    },
    can(user, "manage_labs") && {
      href: "/admin/labs",
      title: "Labs & locations",
      detail: "Sites, labs, cabinets and shelves",
    },
    can(user, "view_audit") && {
      href: "/admin/audit",
      title: "Audit trail",
      detail: "Every change, immutable and exportable",
    },
    can(user, "resolve_import_fixup") && {
      href: "/admin/import-fixup",
      title: "Import fixup",
      detail: `${pendingFixups} containers pending correction`,
    },
  ].filter(Boolean) as { href: string; title: string; detail: string }[];

  return (
    <div>
      <h1 className="text-xl font-semibold text-teal-deep">Admin</h1>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-lg border border-line bg-card p-4 hover:border-teal"
          >
            <div className="text-sm font-semibold text-teal-deep">{card.title}</div>
            <div className="mt-1 text-xs text-muted">{card.detail}</div>
          </Link>
        ))}
        {cards.length === 0 && (
          <p className="text-sm text-muted">You do not have access to any admin area.</p>
        )}
      </div>
    </div>
  );
}
