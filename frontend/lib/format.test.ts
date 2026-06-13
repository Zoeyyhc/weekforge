import { describe, it, expect } from "vitest";
import { formatTimeRange, dayKey, groupBlocksByDay } from "@/lib/format";
import { TimeBlock } from "@/lib/types";

const block = (start: string, end: string, label: string): TimeBlock => ({
  start,
  end,
  label,
  task_id: null,
});

describe("formatTimeRange", () => {
  it("formats a UTC time range deterministically", () => {
    const out = formatTimeRange("2026-06-15T09:00:00+00:00", "2026-06-15T10:30:00+00:00");
    expect(out).toBe("09:00 AM – 10:30 AM");
  });
});

describe("dayKey", () => {
  it("derives a stable UTC day label", () => {
    expect(dayKey("2026-06-15T09:00:00+00:00")).toBe("Monday, Jun 15");
  });
});

describe("groupBlocksByDay", () => {
  it("groups blocks by day, sorted by start, preserving day order", () => {
    const groups = groupBlocksByDay([
      block("2026-06-16T09:00:00+00:00", "2026-06-16T10:00:00+00:00", "Tue task"),
      block("2026-06-15T14:00:00+00:00", "2026-06-15T15:00:00+00:00", "Mon afternoon"),
      block("2026-06-15T09:00:00+00:00", "2026-06-15T10:00:00+00:00", "Mon morning"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].blocks.map((b) => b.label)).toEqual(["Mon morning", "Mon afternoon"]);
    expect(groups[1].blocks.map((b) => b.label)).toEqual(["Tue task"]);
  });

  it("returns an empty array for no blocks", () => {
    expect(groupBlocksByDay([])).toEqual([]);
  });
});
