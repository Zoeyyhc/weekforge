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
          className="flex gap-1 border-b border-border pb-2 overflow-x-auto"
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
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition ${
                  isActive
                    ? "bg-surface text-foreground border border-border"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Round {round}
                {isLive && (
                  <span
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber"
                    data-testid="live-dot"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {(rounds.get(activeTab) ?? []).map((event, i) => (
          <DebateMessage key={i} event={event} />
        ))}
      </div>
    </div>
  );
}
