"use client";

import { useState, useRef, useEffect } from "react";
import { DebateEventMsg } from "@/lib/types";
import { DebateMessage } from "@/components/DebateMessage";
import { DebateStatus } from "@/lib/debateReducer";

export function DebateTimeline({
  events,
  status = "streaming",
}: {
  events: DebateEventMsg[];
  status?: DebateStatus;
}) {
  // Group events by round
  const rounds = new Map<number, DebateEventMsg[]>();
  for (const event of events) {
    if (!rounds.has(event.round)) rounds.set(event.round, []);
    rounds.get(event.round)!.push(event);
  }
  const roundNumbers = Array.from(rounds.keys()).sort((a, b) => a - b);
  const latestRound = roundNumbers[roundNumbers.length - 1] ?? 1;

  const [activeTab, setActiveTab] = useState<number>(latestRound);
  const userSelectedRef = useRef(false);

  // Auto-follow: while streaming and user hasn't manually picked a tab, show latest round
  useEffect(() => {
    if (status === "streaming" && !userSelectedRef.current) {
      setActiveTab(latestRound);
    }
  }, [latestRound, status]);

  function handleTabClick(round: number) {
    if (status === "streaming") {
      // Re-enable auto-follow when clicking the latest round; opt out otherwise
      userSelectedRef.current = round !== latestRound;
    }
    setActiveTab(round);
  }

  return (
    <div className="flex flex-col gap-3" data-testid="debate-timeline">
      {roundNumbers.length > 0 && (
        <div
          className="scroll-forge flex gap-1.5 overflow-x-auto border-b border-border pb-2"
          role="tablist"
          aria-label="Debate rounds"
        >
          {roundNumbers.map((round) => {
            const isActive = round === activeTab;
            const isLive = round === latestRound && status === "streaming";
            return (
              <button
                key={round}
                role="tab"
                aria-selected={isActive}
                data-testid={`round-tab-${round}`}
                onClick={() => handleTabClick(round)}
                className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-1.5 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] transition-all duration-300 ${
                  isActive
                    ? "border border-ember/40 bg-ember/[0.07] text-amber shadow-[0_0_18px_-8px_var(--ember)]"
                    : "border border-transparent text-muted hover:text-foreground"
                }`}
              >
                <span>Round {round}</span>
                {isLive && (
                  <span
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber shadow-[0_0_6px_var(--amber)]"
                    data-testid="live-dot"
                  />
                )}
                {/* Molten underline that ignites under the active round. */}
                <span
                  aria-hidden
                  className={`absolute inset-x-2 -bottom-[9px] h-px origin-center bg-gradient-to-r from-transparent via-ember to-transparent transition-transform duration-300 ${
                    isActive ? "scale-x-100" : "scale-x-0"
                  }`}
                />
              </button>
            );
          })}
        </div>
      )}

      {/* Re-keyed on the active round so a switch re-triggers the settle-in. */}
      <div key={activeTab} className="animate-round-settle flex flex-col gap-2">
        {(rounds.get(activeTab) ?? []).map((event, i) => (
          <DebateMessage key={i} event={event} />
        ))}
      </div>
    </div>
  );
}
