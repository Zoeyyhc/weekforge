"use client";

import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import { Schedule } from "@/lib/types";
import { toCalendarEvents, calendarRange, CalendarEvent } from "@/lib/calendarEvents";

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: { "en-US": enUS },
});

export function WeekCalendar({ schedule }: { schedule: Schedule }) {
  const events = toCalendarEvents(schedule.blocks);
  const range = calendarRange(schedule.blocks);

  if (schedule.blocks.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="schedule-empty">
        The council produced an empty schedule.
      </p>
    );
  }

  const defaultDate = new Date(schedule.blocks[0].start);

  return (
    <div
      className="animate-forged rounded-xl border border-border overflow-hidden bg-surface"
      style={{ height: 600 }}
      data-testid="week-calendar"
    >
      <style>{`
        .rbc-time-view, .rbc-time-header, .rbc-time-content { border-color: #2a2620; }
        .rbc-today { background-color: rgba(245,166,35,0.06) !important; }
        .rbc-header { border-bottom: 1px solid #2a2620; color: #8a8578; font-size: 0.75rem; font-weight: 600; padding: 6px 0; }
        .rbc-time-header-content { border-left: 1px solid #2a2620; }
        .rbc-timeslot-group { border-bottom: 1px solid #1d2026; }
        .rbc-time-slot { color: #6f6a5e; font-size: 0.7rem; }
        .rbc-label { color: #8a8578; }
        .rbc-current-time-indicator { background-color: #ff6b35; }
      `}</style>
      <Calendar
        localizer={localizer}
        events={events}
        defaultView="week"
        views={["week"]}
        toolbar={false}
        defaultDate={defaultDate}
        min={range?.min}
        max={range?.max}
        eventPropGetter={(event: object) => {
          const e = event as CalendarEvent;
          return {
            style: {
              backgroundColor: e.color,
              borderColor: e.color,
              color: "#0f1115",
              borderRadius: "4px",
              fontSize: "0.75rem",
              fontWeight: 600,
            },
          };
        }}
      />
    </div>
  );
}
