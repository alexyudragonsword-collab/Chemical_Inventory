import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/session";
import { SignUpForm } from "./sign-up-form";

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

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
            Create an account to browse the chemical estate. Your lab manager or an administrator
            grants editing rights once you&apos;re assigned to a lab.
          </p>
        </div>
        <div />
      </div>

      {/* Sign-up form */}
      <div className="flex flex-1 items-center justify-center p-8">
        <SignUpForm />
      </div>
    </div>
  );
}
