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

  const hue = meta?.hue ?? "var(--ember)";

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-[#272430] bg-gradient-to-b from-[#15171f] to-[#101219] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
      data-testid="debate-status-band"
    >
      {/* Molten heat-haze backdrop, brightening while the council is live. */}
      <div
        aria-hidden
        className="forge-mesh animate-mesh-drift pointer-events-none absolute inset-0 transition-opacity duration-700"
        style={{ opacity: status === "streaming" ? 0.5 : 0.25 }}
      />
      <div className="relative flex items-center justify-between">
        <div
          className="font-mono text-[0.7rem] uppercase tracking-[0.28em] text-muted"
          data-testid="round-counter"
        >
          Round{" "}
          <span className="font-display text-2xl tracking-normal text-ember [text-shadow:0_0_18px_rgba(255,107,53,0.45)]">
            {currentRound}
          </span>{" "}
          <span className="text-muted">/ {maxRounds}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {Array.from({ length: maxRounds }).map((_, i) => (
            <span
              key={i}
              data-testid="round-segment"
              className={`h-1.5 w-7 rounded-full transition-all duration-500 ${
                i < currentRound
                  ? "bg-amber shadow-[0_0_8px_-1px_var(--amber)]"
                  : "bg-border"
              }`}
            />
          ))}
        </div>
      </div>
      <div
        className="relative mt-3 flex items-center gap-2 text-sm"
        data-testid="now-speaking"
        aria-live="polite"
      >
        {meta && <span aria-hidden>{meta.emoji}</span>}
        {!meta && deliberating && <span aria-hidden>⏳</span>}
        <span
          className="font-display text-[0.95rem]"
          style={meta ? { color: hue } : undefined}
        >
          {caption}
        </span>
        {deliberating && lastMeta && (
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-muted">
            (last: <span aria-hidden>{lastMeta.emoji}</span> {lastMeta.label}{" "}
            {PAST_ACTION[lastAction]})
          </span>
        )}
        {status === "streaming" && (meta || deliberating) && (
          <span className="ml-auto flex gap-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: hue }} />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:150ms]" style={{ background: hue }} />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:300ms]" style={{ background: hue }} />
          </span>
        )}
      </div>
    </div>
  );
}
