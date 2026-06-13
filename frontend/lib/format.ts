import { TimeBlock } from "@/lib/types";

// Pinned to UTC + en-US so output is deterministic across machines.
const TIME_OPTS: Intl.DateTimeFormatOptions = {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
};
const DAY_OPTS: Intl.DateTimeFormatOptions = {
  timeZone: "UTC",
  weekday: "long",
  month: "short",
  day: "numeric",
};

export function formatTimeRange(startIso: string, endIso: string): string {
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString("en-US", TIME_OPTS);
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}

export function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", DAY_OPTS);
}

export interface DayGroup {
  day: string;
  blocks: TimeBlock[];
}

export function groupBlocksByDay(blocks: TimeBlock[]): DayGroup[] {
  const order: string[] = [];
  const map = new Map<string, TimeBlock[]>();
  const sorted = [...blocks].sort((a, b) => a.start.localeCompare(b.start));
  for (const b of sorted) {
    const key = dayKey(b.start);
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(b);
  }
  return order.map((day) => ({ day, blocks: map.get(day)! }));
}
