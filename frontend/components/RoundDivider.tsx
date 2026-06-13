export function RoundDivider({ round }: { round: number }) {
  return (
    <div className="my-4 flex items-center gap-3" data-testid="round-divider">
      <div className="h-px flex-1 bg-slate-200" />
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
        Round {round}
      </span>
      <div className="h-px flex-1 bg-slate-200" />
    </div>
  );
}
