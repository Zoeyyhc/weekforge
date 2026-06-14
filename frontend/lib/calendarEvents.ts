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
