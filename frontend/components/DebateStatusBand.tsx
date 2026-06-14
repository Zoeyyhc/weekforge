import { DebateProgress } from "@/lib/debateProgress";
import { DebateStatus } from "@/lib/debateReducer";
import { agentMeta } from "@/lib/agents";

export function DebateStatusBand({
  progress,
  status,
}: {
  progress: DebateProgress;
  status: DebateStatus;
}) {
  const { currentRound, maxRounds, activeSpeaker } = progress;
  const meta = activeSpeaker ? agentMeta(activeSpeaker) : null;

  let caption: string;
  if (status === "done") caption = "The council decided.";
  else if (status === "interrupted") caption = "Awaiting your call.";
  else if (status === "error") caption = "Something broke.";
  else if (meta) caption = `${meta.label} is speaking…`;
  else caption = "Convening the council…";

  return (
    <div className="rounded-xl border border-border bg-surface p-4" data-testid="debate-status-band">
      <div className="flex items-center justify-between">
        <div className="text-lg font-extrabold tracking-tight" data-testid="round-counter">
          ROUND <span className="text-ember">{currentRound}</span>{" "}
          <span className="font-semibold text-muted">/ {maxRounds}</span>
        </div>
        <div className="flex items-center gap-1">
          {Array.from({ length: maxRounds }).map((_, i) => (
            <span
              key={i}
              data-testid="round-segment"
              className={`h-1.5 w-6 rounded-full ${
                i < currentRound ? "bg-amber" : "bg-border"
              }`}
            />
          ))}
        </div>
      </div>
      <div
        className="mt-3 flex items-center gap-2 text-sm"
        data-testid="now-speaking"
        aria-live="polite"
      >
        {meta && <span aria-hidden>{meta.emoji}</span>}
        <span className="font-medium">{caption}</span>
        {status === "streaming" && meta && (
          <span className="ml-auto flex gap-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber [animation-delay:300ms]" />
          </span>
        )}
      </div>
    </div>
  );
}
