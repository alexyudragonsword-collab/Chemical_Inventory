"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-deep"
    >
      Print
    </button>
  );
}
