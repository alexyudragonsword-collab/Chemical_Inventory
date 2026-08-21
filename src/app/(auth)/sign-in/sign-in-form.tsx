"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction, type SignInState } from "./actions";

export function SignInForm({ labs }: { labs: { id: string; code: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState<SignInState, FormData>(signInAction, {});

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

      <h2 className="text-2xl font-semibold text-teal-deep">Sign in</h2>
      <p className="mt-1 text-sm text-muted">Use your institutional account.</p>

      {state.error && (
        <div className="mt-4 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </div>
      )}

      <label className="mt-6 block text-xs font-semibold tracking-wide text-muted uppercase">
        Institutional email
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="l.wong@university.edu"
          className="mt-1 w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-ink normal-case focus:border-teal focus:ring-2 focus:ring-teal/30 focus:outline-none"
        />
      </label>

      <label className="mt-4 block text-xs font-semibold tracking-wide text-muted uppercase">
        Password
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="mt-1 w-full rounded-md border border-line bg-card px-3 py-2 text-sm focus:border-teal focus:ring-2 focus:ring-teal/30 focus:outline-none"
        />
      </label>

      <label className="mt-4 block text-xs font-semibold tracking-wide text-muted uppercase">
        Default workspace
        <select
          name="workspace"
          className="mt-1 w-full rounded-md border border-line bg-card px-3 py-2 text-sm normal-case focus:border-teal focus:outline-none"
          defaultValue=""
        >
          <option value="">My default lab</option>
          {labs.map((lab) => (
            <option key={lab.id} value={lab.id}>
              {lab.code} — {lab.name}
            </option>
          ))}
        </select>
      </label>

      <p className="mt-3 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-ink">
        The workspace sets your default editable scope. You can switch labs later without signing
        out; everything outside your custody stays visible, read-only.
      </p>

      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-deep disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <p className="mt-4 text-center text-sm text-muted">
        New here?{" "}
        <Link href="/sign-up" className="font-medium text-teal hover:underline">
          Create an account
        </Link>
      </p>

      <p className="mt-4 text-center text-xs text-muted">
        Session expires after 12 h · SSO and 2FA for controlled substances arrive in a later
        release
      </p>
    </form>
  );
}
