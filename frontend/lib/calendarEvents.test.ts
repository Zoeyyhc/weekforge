import { describe, it, expect } from "vitest";
import { toCalendarEvents, calendarRange } from "@/lib/calendarEvents";
import { TimeBlock } from "@/lib/types";

const BLOCKS: TimeBlock[] = [
  { label: "Write report", start: "2026-06-15T09:00:00.000Z", end: "2026-06-15T11:00:00.000Z", task_id: "t1" },
  { label: "Review PRs",   start: "2026-06-15T14:00:00.000Z", end: "2026-06-15T17:00:00.000Z", task_id: "t2" },
  { label: "Standup",      start: "2026-06-16T09:00:00.000Z", end: "2026-06-16T09:30:00.000Z", task_id: null },
  { label: "Deep Work",    start: "2026-06-16T10:00:00.000Z", end: "2026-06-16T13:00:00.000Z", task_id: "t3" },
  { label: "Planning",     start: "2026-06-17T09:00:00.000Z", end: "2026-06-17T11:00:00.000Z", task_id: "t4" },
  { label: "Extra block",  start: "2026-06-18T10:00:00.000Z", end: "2026-06-18T11:00:00.000Z", task_id: "t5" },
];

describe("toCalendarEvents", () => {
  it("maps label to title and ISO strings to Date objects", () => {
    const events = toCalendarEvents([BLOCKS[0]]);
    expect(events[0].title).toBe("Write report");
    expect(events[0].start).toBeInstanceOf(Date);
    expect(events[0].end).toBeInstanceOf(Date);
    expect(events[0].start.getTime()).toBe(new Date("2026-06-15T09:00:00.000Z").getTime());
    expect(events[0].end.getTime()).toBe(new Date("2026-06-15T11:00:00.000Z").getTime());
  });

  it("assigns colors cycling through the 5-color palette", () => {
    const events = toCalendarEvents(BLOCKS);
    expect(events[0].color).toBe("#f43f5e"); // index 0 → rose
    expect(events[1].color).toBe("#6366f1"); // index 1 → indigo
    expect(events[2].color).toBe("#10b981"); // index 2 → emerald
    expect(events[3].color).toBe("#8b5cf6"); // index 3 → violet
    expect(events[4].color).toBe("#f97316"); // index 4 → orange
    expect(events[5].color).toBe("#f43f5e"); // index 5 wraps back to rose
  });
});

describe("calendarRange", () => {
  it("returns null for an empty block array", () => {
    expect(calendarRange([])).toBeNull();
  });

  it("returns min 30 min before earliest start and max 30 min after latest end", () => {
    const range = calendarRange(BLOCKS)!;
    const THIRTY = 30 * 60 * 1000;
    const expectedMin = new Date("2026-06-15T09:00:00.000Z").getTime() - THIRTY;
    const expectedMax = new Date("2026-06-18T11:00:00.000Z").getTime() + THIRTY;
    expect(range.min.getTime()).toBe(expectedMin);
    expect(range.max.getTime()).toBe(expectedMax);
  });
});
