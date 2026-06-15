"use client";

import { format } from "date-fns";
import { Schedule } from "@/lib/types";
import { toCalendarEvents, groupEventsByDay } from "@/lib/calendarEvents";

// "2h", "1h 30m", "45m" — compact, human-readable block length.
function formatDuration(start: Date, end: Date): string {
  const mins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function WeekCalendar({ schedule }: { schedule: Schedule }) {
  if (schedule.blocks.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="schedule-empty">
        The council produced an empty schedule.
      </p>
    );
  }

  const events = toCalendarEvents(schedule.blocks);
  const days = groupEventsByDay(events);

  return (
    <div
      className="animate-forged max-h-[560px] overflow-y-auto rounded-xl border border-border bg-surface"
      data-testid="week-calendar"
    >
      <ol className="flex flex-col">
        {days.map((day) => (
          <li key={day.key}>
            {/* Day header — sticks while its blocks scroll past. */}
            <div className="sticky top-0 z-10 flex items-baseline justify-between border-b border-border bg-surface/95 px-3 py-2 backdrop-blur">
              <span className="text-xs font-bold uppercase tracking-wider text-amber">
                {format(day.date, "EEE")}{" "}
                <span className="text-muted">{format(day.date, "MMM d")}</span>
              </span>
              <span className="text-[0.65rem] font-medium uppercase tracking-wide text-muted">
                {day.events.length} {day.events.length === 1 ? "block" : "blocks"}
              </span>
            </div>

            <ul className="flex flex-col">
              {day.events.map((e, i) => (
                <li
                  key={i}
                  className="group flex gap-3 px-3 py-2.5 transition-colors hover:bg-white/[0.025]"
                >
                  {/* Glowing colored spine keyed to the block. */}
                  <span
                    aria-hidden
                    className="mt-0.5 w-[3px] shrink-0 self-stretch rounded-full"
                    style={{
                      backgroundColor: e.color,
                      boxShadow: `0 0 8px -1px ${e.color}`,
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold leading-snug text-foreground">
                      {e.title}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[0.7rem] text-muted">
                      <span>{format(e.start, "h:mm a")}</span>
                      <span className="text-border">–</span>
                      <span>{format(e.end, "h:mm a")}</span>
                      <span className="ml-auto rounded bg-white/[0.04] px-1.5 py-0.5 text-[0.65rem] text-muted/90">
                        {formatDuration(e.start, e.end)}
                      </span>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
