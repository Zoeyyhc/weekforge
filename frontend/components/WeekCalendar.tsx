"use client";

import { format } from "date-fns";
import { Schedule } from "@/lib/types";
import { toCalendarEvents, groupEventsByDay } from "@/lib/calendarEvents";

function formatDuration(start: Date, end: Date): string {
  const mins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function toTimeInput(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function WeekCalendar({
  schedule,
  onEditTime,
  onDelete,
}: {
  schedule: Schedule;
  onEditTime?: (blockIndex: number, field: "start" | "end", timeStr: string) => void;
  onDelete?: (blockIndex: number) => void;
}) {
  if (schedule.blocks.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="schedule-empty">
        The council produced an empty schedule.
      </p>
    );
  }

  const editable = Boolean(onEditTime && onDelete);
  const events = toCalendarEvents(schedule.blocks);
  const days = groupEventsByDay(events);

  return (
    <div
      className="animate-forged scroll-forge max-h-[600px] overflow-y-auto rounded-xl border border-[#272430] bg-gradient-to-b from-[#15171f] to-[#101219] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
      data-testid="week-calendar"
    >
      <ol className="flex flex-col">
        {days.map((day) => (
          <li key={day.key}>
            <div className="sticky top-0 z-10 flex items-baseline justify-between border-b border-[#272430] bg-[#13151c]/95 px-4 py-2.5 backdrop-blur">
              <span className="font-display text-[0.9rem] leading-none tracking-tight text-amber">
                {format(day.date, "EEE")}{" "}
                <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-muted">
                  {format(day.date, "MMM d")}
                </span>
              </span>
              <span className="font-mono text-[0.62rem] font-medium uppercase tracking-[0.18em] text-muted">
                {day.events.length} {day.events.length === 1 ? "block" : "blocks"}
              </span>
            </div>

            <ul className="flex flex-col py-1">
              {day.events.map((e) => (
                <li
                  key={e.blockIndex}
                  className="group flex gap-3.5 px-4 py-3 transition-colors hover:bg-white/[0.025]"
                >
                  <span
                    aria-hidden
                    className="mt-0.5 w-[3px] shrink-0 self-stretch rounded-full transition-shadow"
                    style={{ backgroundColor: e.color, boxShadow: `0 0 8px -1px ${e.color}` }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-sans text-[0.95rem] font-semibold leading-snug text-foreground">
                      {e.title}
                    </p>
                    <p className="mt-1.5 flex items-center gap-2 font-mono text-[0.72rem] text-muted">
                      {editable ? (
                        <>
                          <input
                            type="time"
                            value={toTimeInput(e.start)}
                            onChange={(ev) => onEditTime!(e.blockIndex, "start", ev.target.value)}
                            className="border-0 border-b border-[#272430] bg-transparent font-mono text-[0.72rem] text-muted outline-none focus:border-ember"
                            aria-label={`Start time for ${e.title}`}
                          />
                          <span className="text-border">–</span>
                          <input
                            type="time"
                            value={toTimeInput(e.end)}
                            onChange={(ev) => onEditTime!(e.blockIndex, "end", ev.target.value)}
                            className="border-0 border-b border-[#272430] bg-transparent font-mono text-[0.72rem] text-muted outline-none focus:border-ember"
                            aria-label={`End time for ${e.title}`}
                          />
                        </>
                      ) : (
                        <>
                          <span>{format(e.start, "h:mm a")}</span>
                          <span className="text-border">–</span>
                          <span>{format(e.end, "h:mm a")}</span>
                        </>
                      )}
                      <span className="ml-auto rounded-md border border-white/[0.05] bg-white/[0.04] px-2 py-0.5 text-[0.66rem] text-muted/90">
                        {formatDuration(e.start, e.end)}
                      </span>
                      {editable && (
                        <button
                          type="button"
                          onClick={() => onDelete!(e.blockIndex)}
                          aria-label={`Delete block ${e.title}`}
                          className="ml-1 text-[#3a3530] transition-colors hover:text-rose-400"
                        >
                          ✕
                        </button>
                      )}
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
