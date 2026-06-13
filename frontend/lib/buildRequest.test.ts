import { describe, it, expect } from "vitest";
import { buildRequest, TaskDraft, BusyBlockDraft, PrefsDraft } from "@/lib/buildRequest";

const tasks: TaskDraft[] = [
  { title: "Write Q3 report", estimatedMinutes: "180", priority: 1 },
  { title: "Review PRs", estimatedMinutes: "90", priority: 2 },
];
const blocks: BusyBlockDraft[] = [
  { label: "Standup", start: "2026-06-15T10:00", end: "2026-06-15T11:00" },
];
const prefs: PrefsDraft = {
  workdayStartHour: "9",
  workdayEndHour: "18",
  maxFocusMinutes: "360",
};

describe("buildRequest", () => {
  it("generates sequential string ids and numeric fields for tasks", () => {
    const req = buildRequest(tasks, blocks, prefs);
    expect(req.tasks).toEqual([
      { id: "t1", title: "Write Q3 report", estimated_minutes: 180, priority: 1 },
      { id: "t2", title: "Review PRs", estimated_minutes: 90, priority: 2 },
    ]);
  });

  it("converts datetime-local strings to ISO-8601 preserving the instant", () => {
    const req = buildRequest(tasks, blocks, prefs);
    const block = req.busy_blocks![0];
    expect(block.label).toBe("Standup");
    // ISO string with timezone designator, and the same instant as the input.
    expect(block.start).toMatch(/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/);
    expect(new Date(block.start).getTime()).toBe(new Date("2026-06-15T10:00").getTime());
    expect(new Date(block.end).getTime()).toBe(new Date("2026-06-15T11:00").getTime());
  });

  it("maps preferences to numbers", () => {
    const req = buildRequest(tasks, blocks, prefs);
    expect(req.preferences).toEqual({
      workday_start_hour: 9,
      workday_end_hour: 18,
      max_focus_minutes_per_day: 360,
    });
  });

  it("always sends the fixed council defaults", () => {
    const req = buildRequest(tasks, blocks, prefs);
    expect(req.max_rounds).toBe(3);
    expect(req.require_human_on_stall).toBe(true);
  });

  it("trims task titles and busy-block labels", () => {
    const req = buildRequest(
      [{ title: "  Padded  ", estimatedMinutes: "30", priority: 3 }],
      [{ label: "  Call  ", start: "2026-06-15T10:00", end: "2026-06-15T11:00" }],
      prefs,
    );
    expect(req.tasks[0].title).toBe("Padded");
    expect(req.busy_blocks![0].label).toBe("Call");
  });
});
