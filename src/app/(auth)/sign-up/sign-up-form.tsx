"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUpAction, type SignUpState } from "./actions";

export function SignUpForm() {
  const [state, formAction, pending] = useActionState<SignUpState, FormData>(signUpAction, {});

  const input =
    "mt-1 w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-ink normal-case focus:border-teal focus:ring-2 focus:ring-teal/30 focus:outline-none";

  return (
    <form action={formAction} className="w-full max-w-sm">
      <div className="mb-8 lg:hidden">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-deep text-lg font-bold text-white">
            C
          </div>
          <span className="text-xl font-semibold tracking-tight">ChemTrack</span>
        </div>
      </div>

      <h2 className="text-2xl font-semibold text-teal-deep">Create an account</h2>
      <p className="mt-1 text-sm text-muted">
        New accounts start read-only. An administrator raises your access and assigns your lab.
      </p>

      {state.error && (
        <div className="mt-4 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </div>
      )}

      <label className="mt-6 block text-xs font-semibold tracking-wide text-muted uppercase">
        Full name
        <input name="name" required autoComplete="name" placeholder="L. Wong" className={input} />
      </label>

      <label className="mt-4 block text-xs font-semibold tracking-wide text-muted uppercase">
        Institutional email
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="l.wong@university.edu"
          className={input}
        />
      </label>

      <label className="mt-4 block text-xs font-semibold tracking-wide text-muted uppercase">
        Password (min 8 characters)
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={input}
        />
      </label>

      <label className="mt-4 block text-xs font-semibold tracking-wide text-muted uppercase">
        Confirm password
        <input
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={input}
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-deep disabled:opacity-60"
      >
        {pending ? "Creating account…" : "Create account"}
      </button>

      <p className="mt-4 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-teal hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
