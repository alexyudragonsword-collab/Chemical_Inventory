import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/server/session";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  const [containerCount, labCount, siteCount, sdsStats, labs] = await Promise.all([
    prisma.container.count({ where: { status: { notIn: ["DISPOSED"] } } }),
    prisma.lab.count(),
    prisma.site.count(),
    sdsCoverage(),
    prisma.lab.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);

  return (
    <div className="flex min-h-screen">
      {/* Brand panel */}
      <div className="hidden flex-1 flex-col justify-between bg-teal-deep p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal text-lg font-bold">
            C
          </div>
          <span className="text-xl font-semibold tracking-tight">ChemTrack</span>
        </div>
        <div>
          <h1 className="text-4xl leading-tight font-semibold">
            Every bottle
            <br />
            accounted for.
          </h1>
          <p className="mt-4 max-w-md text-white/70">
            Sign in to see the full estate — and to adjust the chemicals in your own custody.
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-6">
          <Stat value={containerCount.toLocaleString("en-US")} label="containers tracked" />
          <Stat value={String(labCount)} label={`labs across ${siteCount} site${siteCount === 1 ? "" : "s"}`} />
          <Stat value={sdsStats} label="SDS coverage" />
        </dl>
      </div>

      {/* Sign-in form */}
      <div className="flex flex-1 items-center justify-center p-8">
        <SignInForm labs={labs} />
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="text-3xl font-semibold">{value}</dt>
      <dd className="mt-1 text-sm text-white/60">{label}</dd>
    </div>
  );
}

async function sdsCoverage(): Promise<string> {
  const total = await prisma.substance.count();
  if (total === 0) return "—";
  const withSds = await prisma.substance.count({
    where: { sdsDocuments: { some: { status: "CURRENT" } } },
  });
  return `${Math.round((withSds / total) * 100)}%`;
}
