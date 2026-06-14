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
      <p className="text-sm text-slate-500" data-testid="schedule-empty">
        The council produced an empty schedule.
      </p>
    );
  }

  const defaultDate = new Date(schedule.blocks[0].start);

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white" style={{ height: 600 }}>
      <style>{`
        .rbc-today { background-color: transparent !important; }
        .rbc-header { border-bottom: 1px solid #e2e8f0; color: #475569; font-size: 0.75rem; font-weight: 600; padding: 6px 0; }
        .rbc-time-header-content { border-left: 1px solid #e2e8f0; }
        .rbc-timeslot-group { border-bottom: 1px solid #f1f5f9; }
        .rbc-time-slot { color: #94a3b8; font-size: 0.7rem; }
        .rbc-current-time-indicator { background-color: #6366f1; }
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
              color: "#fff",
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
