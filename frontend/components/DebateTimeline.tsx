import { DebateEventMsg } from "@/lib/types";
import { DebateMessage } from "@/components/DebateMessage";
import { RoundDivider } from "@/components/RoundDivider";

export function DebateTimeline({ events }: { events: DebateEventMsg[] }) {
  let lastRound = 0;
  return (
    <div className="flex flex-col gap-2" data-testid="debate-timeline">
      {events.map((event, i) => {
        const showDivider = event.round !== lastRound;
        lastRound = event.round;
        return (
          <div key={i}>
            {showDivider && <RoundDivider round={event.round} />}
            <DebateMessage event={event} />
          </div>
        );
      })}
    </div>
  );
}
