export function RoundDivider({ round }: { round: number }) {
  return (
    <div className="my-4 flex items-center gap-3" data-testid="round-divider">
      <div className="h-px flex-1 bg-gradient-to-r from-transparent to-amber/40" />
      <span className="text-xs font-medium uppercase tracking-wide text-amber">
        Round {round}
      </span>
      <div className="h-px flex-1 bg-gradient-to-l from-transparent to-amber/40" />
    </div>
  );
}
