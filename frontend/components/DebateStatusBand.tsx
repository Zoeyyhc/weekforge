import { DebateProgress, AgentAction } from "@/lib/debateProgress";
import { DebateStatus } from "@/lib/debateReducer";
import { agentMeta } from "@/lib/agents";

const PAST_ACTION: Record<AgentAction, string> = {
  proposed: "proposed",
  critiqued: "critiqued",
  decided: "decided",
  intervened: "intervened",
  waiting: "spoke",
};

export function DebateStatusBand({
  progress,
  status,
}: {
  progress: DebateProgress;
  status: DebateStatus;
}) {
  const { currentRound, maxRounds, activeSpeaker, lastSpeaker, roster } = progress;
  const meta = activeSpeaker ? agentMeta(activeSpeaker) : null;

  // During streaming the council works silently between bursts (convergence-check,
  // arbitration). When no one is the live speaker but events exist, say so honestly
  // rather than freezing on the last burst's speaker.
  const deliberating = status === "streaming" && !activeSpeaker && lastSpeaker !== null;
  const lastMeta = lastSpeaker ? agentMeta(lastSpeaker) : null;
  const lastAction = lastSpeaker
    ? roster.find((r) => r.speaker === lastSpeaker)?.action ?? "waiting"
    : "waiting";

  let caption: string;
  if (status === "done") caption = "The council decided.";
  else if (status === "interrupted") caption = "Awaiting your call.";
  else if (status === "error") caption = "Something broke.";
  else if (meta) caption = `${meta.label} is speaking…`;
  else if (deliberating) caption = "The council is deliberating…";
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
        {!meta && deliberating && <span aria-hidden>⏳</span>}
        <span className="font-medium">{caption}</span>
        {deliberating && lastMeta && (
          <span className="text-xs text-muted">
            (last: <span aria-hidden>{lastMeta.emoji}</span> {lastMeta.label}{" "}
            {PAST_ACTION[lastAction]})
          </span>
        )}
        {status === "streaming" && (meta || deliberating) && (
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
