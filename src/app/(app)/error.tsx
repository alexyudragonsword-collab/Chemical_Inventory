"use client";

// Segment error boundary: an uncaught server error renders this card inside
// the app shell instead of Next's bare "Application error" page.

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border border-line bg-card p-6 text-center">
      <h1 className="text-lg font-semibold text-teal-deep">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">
        The action could not be completed. Nothing was recorded — you can try again, and if it
        keeps failing, share the reference below with your admin.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-muted">Ref: {error.digest}</p>
      )}
      <div className="mt-4 flex justify-center gap-2">
        <button
          onClick={reset}
          className="rounded-md bg-teal px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-deep"
        >
          Try again
        </button>
        <a
          href="/dashboard"
          className="rounded-md border border-line px-4 py-1.5 text-sm text-muted hover:bg-paper"
        >
          Back to dashboard
        </a>
      </div>
    </div>
  );
}
