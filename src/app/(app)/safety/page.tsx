import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function SafetyHubPage() {
  await requireUser();

  const [openAlerts, conflicts, substanceCount, classified, sdsCurrent] = await Promise.all([
    prisma.alert.count({ where: { status: "OPEN" } }),
    prisma.alert.count({ where: { status: "OPEN", kind: "COMPAT_CONFLICT" } }),
    prisma.substance.count(),
    prisma.ghsClassification.count(),
    prisma.substance.count({ where: { sdsDocuments: { some: { status: "CURRENT" } } } }),
  ]);

  const coverage = substanceCount ? Math.round((sdsCurrent / substanceCount) * 100) : 0;

  const cards = [
    {
      href: "/safety/alerts",
      title: "Alerts",
      detail: `${openAlerts} open — a worklist, not a notification feed`,
    },
    {
      href: "/safety/matrix",
      title: "Storage compatibility",
      detail: conflicts > 0 ? `${conflicts} cabinet${conflicts === 1 ? "" : "s"} in conflict` : "No conflicts detected",
    },
    {
      href: "/safety/classification",
      title: "GHS classification",
      detail: `${classified} of ${substanceCount} substances classified`,
    },
    {
      href: "/safety/sds",
      title: "SDS library",
      detail: `${coverage}% coverage — a chemical without a current SDS is a compliance gap`,
    },
  ];

  return (
    <div>
      <h1 className="text-xl font-semibold text-teal-deep">Safety</h1>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Link key={card.href} href={card.href} className="rounded-lg border border-line bg-white p-4 hover:border-teal">
            <div className="text-sm font-semibold text-teal-deep">{card.title}</div>
            <div className="mt-1 text-xs text-muted">{card.detail}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
