import { describe, it, expect, vi, afterEach } from "vitest";
import { buildRequest, TaskDraft, BusyBlockDraft, PrefsDraft } from "@/lib/buildRequest";

function makeDraft(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return {
    id: "draft-1",
    title: "Test task",
    estimatedMinutes: "60",
    priority: 2,
    hasDeadline: false,
    deadlineWeekday: "Fri",
    preferredDays: [],
    ...overrides,
  };
}

const tasks: TaskDraft[] = [
  { id: "d1", title: "Write Q3 report", estimatedMinutes: "180", priority: 1, hasDeadline: false, deadlineWeekday: "Fri", preferredDays: [] },
  { id: "d2", title: "Review PRs", estimatedMinutes: "90", priority: 2, hasDeadline: false, deadlineWeekday: "Fri", preferredDays: [] },
];
const blocks: BusyBlockDraft[] = [
  { id: "d3", label: "Standup", start: "2026-06-15T10:00", end: "2026-06-15T11:00" },
];
const prefs: PrefsDraft = {
  workdayStartHour: "9",
  workdayEndHour: "18",
  maxFocusMinutes: "360",
};

const noBlocks: BusyBlockDraft[] = [];

afterEach(() => vi.useRealTimers());

describe("buildRequest", () => {
  it("generates sequential string ids and numeric fields for tasks", () => {
    const req = buildRequest(tasks, blocks, prefs);
    expect(req.tasks).toEqual([
      { id: "t1", title: "Write Q3 report", estimated_minutes: 180, priority: 1, deadline: null },
      { id: "t2", title: "Review PRs", estimated_minutes: 90, priority: 2, deadline: null },
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
      [{ id: "d4", title: "  Padded  ", estimatedMinutes: "30", priority: 3, hasDeadline: false, deadlineWeekday: "Fri", preferredDays: [] }],
      [{ id: "d5", label: "  Call  ", start: "2026-06-15T10:00", end: "2026-06-15T11:00" }],
      prefs,
    );
    expect(req.tasks[0].title).toBe("Padded");
    expect(req.busy_blocks![0].label).toBe("Call");
  });
});

describe("buildRequest — deadline", () => {
  it("sets deadline to null when hasDeadline is false", () => {
    const req = buildRequest([makeDraft({ hasDeadline: false })], noBlocks, prefs);
    expect(req.tasks[0].deadline).toBeNull();
  });

  it("converts Thu to that Thursday of the current week at 23:59 local", () => {
    vi.useFakeTimers();
    // Pin to Mon 15 Jun 2026 at 08:00 local so we can predict Thursday = 18 Jun
    vi.setSystemTime(new Date(2026, 5, 15, 8, 0, 0));

    const req = buildRequest([makeDraft({ hasDeadline: true, deadlineWeekday: "Thu" })], noBlocks, prefs);
    const d = new Date(req.tasks[0].deadline!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);  // June (0-indexed)
    expect(d.getDate()).toBe(18);  // Thursday
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
  });

  it("converts Mon to that Monday (same day when today is Monday)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 8, 0, 0)); // Monday 15 Jun

    const req = buildRequest([makeDraft({ hasDeadline: true, deadlineWeekday: "Mon" })], noBlocks, prefs);
    const d = new Date(req.tasks[0].deadline!);
    expect(d.getDate()).toBe(15);
  });

  it("wraps to next week when the target day is in the past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 19, 8, 0, 0)); // Friday 19 Jun 2026

    const req = buildRequest([makeDraft({ hasDeadline: true, deadlineWeekday: "Mon" })], noBlocks, prefs);
    const d = new Date(req.tasks[0].deadline!);
    // Mon is 5 days before Friday → diff = -5, should wrap to next Mon (22 Jun)
    expect(d.getDate()).toBe(22);
    expect(d.getMonth()).toBe(5); // June
  });
});

describe("buildRequest — preferredDays", () => {
  it("maps preferredDays to preferred_days on the task", () => {
    const req = buildRequest([makeDraft({ preferredDays: ["Wed", "Fri"] })], noBlocks, prefs);
    expect(req.tasks[0].preferred_days).toEqual(["Wed", "Fri"]);
  });

  it("omits preferred_days when preferredDays is empty", () => {
    const req = buildRequest([makeDraft({ preferredDays: [] })], noBlocks, prefs);
    expect(req.tasks[0].preferred_days).toBeUndefined();
  });
});
