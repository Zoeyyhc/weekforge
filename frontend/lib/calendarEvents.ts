import { TimeBlock } from "@/lib/types";

const PALETTE = ["#f43f5e", "#6366f1", "#10b981", "#8b5cf6", "#f97316"];

export interface CalendarEvent {
  title: string;
  start: Date;
  end: Date;
  color: string;
}

export function toCalendarEvents(blocks: TimeBlock[]): CalendarEvent[] {
  return blocks.map((b, i) => ({
    title: b.label,
    start: new Date(b.start),
    end: new Date(b.end),
    color: PALETTE[i % PALETTE.length],
  }));
}

export function calendarRange(blocks: TimeBlock[]): { min: Date; max: Date } | null {
  if (blocks.length === 0) return null;
  const starts = blocks.map((b) => new Date(b.start).getTime());
  const ends = blocks.map((b) => new Date(b.end).getTime());
  const THIRTY = 30 * 60 * 1000;
  return {
    min: new Date(Math.min(...starts) - THIRTY),
    max: new Date(Math.max(...ends) + THIRTY),
  };
}

export interface DayGroup {
  /** Local YYYY-MM-DD key, used for sorting/keys. */
  key: string;
  /** Local midnight Date for the day, for header formatting. */
  date: Date;
  events: CalendarEvent[];
}

// Local-time YYYY-MM-DD so blocks land on the day the user sees, not the UTC day.
function localDayKey(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Groups calendar events into per-day buckets, sorted chronologically by day and
 * by start time within each day. Only days that contain events appear — empty
 * days are dropped so the agenda has no dead space.
 */
export function groupEventsByDay(events: CalendarEvent[]): DayGroup[] {
  const buckets = new Map<string, DayGroup>();
  for (const e of events) {
    const key = localDayKey(e.start);
    let group = buckets.get(key);
    if (!group) {
      const date = new Date(e.start);
      date.setHours(0, 0, 0, 0);
      group = { key, date, events: [] };
      buckets.set(key, group);
    }
    group.events.push(e);
  }
  const groups = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const g of groups) {
    g.events.sort((a, b) => a.start.getTime() - b.start.getTime());
  }
  return groups;
}
