export function Placeholder({ title, milestone }: { title: string; milestone: string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold text-teal-deep">{title}</h1>
      <div className="mt-6 rounded-lg border border-dashed border-line bg-card px-6 py-16 text-center text-sm text-muted">
        This area arrives in {milestone}.
      </div>
    </div>
  );
}
