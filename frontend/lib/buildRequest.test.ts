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
    remark: "",
    ...overrides,
  };
}

const tasks: TaskDraft[] = [
  { id: "d1", title: "Write Q3 report", estimatedMinutes: "180", priority: 1, hasDeadline: false, deadlineWeekday: "Fri", preferredDays: [], remark: "" },
  { id: "d2", title: "Review PRs", estimatedMinutes: "90", priority: 2, hasDeadline: false, deadlineWeekday: "Fri", preferredDays: [], remark: "" },
];
const blocks: BusyBlockDraft[] = [
  { id: "d3", label: "Standup", start: "2026-06-15T10:00", end: "2026-06-15T11:00" },
];
const prefs: PrefsDraft = {
  workdayStartHour: "9",
  workdayEndHour: "18",
  maxFocusMinutes: "360",
};
const weekStart = "2026-06-15";

const noBlocks: BusyBlockDraft[] = [];

afterEach(() => vi.useRealTimers());

describe("buildRequest", () => {
  it("generates sequential string ids and numeric fields for tasks", () => {
    const req = buildRequest(tasks, blocks, prefs, weekStart);
    expect(req.tasks).toEqual([
      { id: "t1", title: "Write Q3 report", estimated_minutes: 180, priority: 1, deadline: null },
      { id: "t2", title: "Review PRs", estimated_minutes: 90, priority: 2, deadline: null },
    ]);
  });

  it("converts datetime-local strings to ISO-8601 preserving the instant", () => {
    const req = buildRequest(tasks, blocks, prefs, weekStart);
    const block = req.busy_blocks![0];
    expect(block.label).toBe("Standup");
    // ISO string with timezone designator, and the same instant as the input.
    expect(block.start).toMatch(/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/);
    expect(new Date(block.start).getTime()).toBe(new Date("2026-06-15T10:00").getTime());
    expect(new Date(block.end).getTime()).toBe(new Date("2026-06-15T11:00").getTime());
  });

  it("maps preferences to numbers and sends the local timezone", () => {
    const req = buildRequest(tasks, blocks, prefs, weekStart);
    expect(req.preferences).toEqual({
      workday_start_hour: 9,
      workday_end_hour: 18,
      max_focus_minutes_per_day: 360,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it("always sends the fixed council defaults", () => {
    const req = buildRequest(tasks, blocks, prefs, weekStart);
    expect(req.max_rounds).toBe(3);
    expect(req.require_human_on_stall).toBe(true);
  });

  it("trims task titles and busy-block labels", () => {
    const req = buildRequest(
      [{ id: "d4", title: "  Padded  ", estimatedMinutes: "30", priority: 3, hasDeadline: false, deadlineWeekday: "Fri", preferredDays: [], remark: "" }],
      [{ id: "d5", label: "  Call  ", start: "2026-06-15T10:00", end: "2026-06-15T11:00" }],
      prefs,
      weekStart,
    );
    expect(req.tasks[0].title).toBe("Padded");
    expect(req.busy_blocks![0].label).toBe("Call");
  });
});

describe("buildRequest — deadline", () => {
  it("sets deadline to null when hasDeadline is false", () => {
    const req = buildRequest([makeDraft({ hasDeadline: false })], noBlocks, prefs, weekStart);
    expect(req.tasks[0].deadline).toBeNull();
  });

  it("converts Thu to that Thursday of the selected week at 23:59 local", () => {
    const req = buildRequest(
      [makeDraft({ hasDeadline: true, deadlineWeekday: "Thu" })],
      noBlocks,
      prefs,
      weekStart,
    );
    const d = new Date(req.tasks[0].deadline!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);  // June (0-indexed)
    expect(d.getDate()).toBe(18);  // Thursday
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
  });

  it("converts Mon to that Monday of the selected week", () => {
    const req = buildRequest(
      [makeDraft({ hasDeadline: true, deadlineWeekday: "Mon" })],
      noBlocks,
      prefs,
      weekStart,
    );
    const d = new Date(req.tasks[0].deadline!);
    expect(d.getDate()).toBe(15);
  });

  it("ignores the current date and stays within the selected week", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 19, 8, 0, 0)); // Friday 19 Jun 2026

    const req = buildRequest(
      [makeDraft({ hasDeadline: true, deadlineWeekday: "Mon" })],
      noBlocks,
      prefs,
      weekStart,
    );
    const d = new Date(req.tasks[0].deadline!);
    expect(d.getDate()).toBe(15);
    expect(d.getMonth()).toBe(5); // June
  });

  it("resolves a deadline within the selected (future) week", () => {
    const req = buildRequest(
      [
        {
          id: "d1",
          title: "T",
          estimatedMinutes: "60",
          priority: 1,
          hasDeadline: true,
          deadlineWeekday: "Fri",
          preferredDays: [],
          remark: "",
        },
      ],
      [],
      { workdayStartHour: "9", workdayEndHour: "18", maxFocusMinutes: "360" },
      "2026-06-22",
    );
    const deadline = new Date(req.tasks[0].deadline!);
    expect(deadline.getFullYear()).toBe(2026);
    expect(deadline.getMonth()).toBe(5);
    expect(deadline.getDate()).toBe(26);
    expect(deadline.getHours()).toBe(23);
    expect(deadline.getMinutes()).toBe(59);
  });
});

describe("buildRequest — preferredDays", () => {
  it("maps preferredDays to preferred_days on the task", () => {
    const req = buildRequest([makeDraft({ preferredDays: ["Wed", "Fri"] })], noBlocks, prefs, weekStart);
    expect(req.tasks[0].preferred_days).toEqual(["Wed", "Fri"]);
  });

  it("omits preferred_days when preferredDays is empty", () => {
    const req = buildRequest([makeDraft({ preferredDays: [] })], noBlocks, prefs, weekStart);
    expect(req.tasks[0].preferred_days).toBeUndefined();
  });
});

describe("buildRequest — remark", () => {
  it("includes remark on the task when non-empty", () => {
    const req = buildRequest(
      [makeDraft({ remark: "Do this early in the morning" })],
      noBlocks,
      prefs,
      weekStart,
    );
    expect(req.tasks[0].remark).toBe("Do this early in the morning");
  });

  it("omits remark when blank", () => {
    const req = buildRequest([makeDraft({ remark: "" })], noBlocks, prefs, weekStart);
    expect(req.tasks[0].remark).toBeUndefined();
  });

  it("omits remark when whitespace only", () => {
    const req = buildRequest([makeDraft({ remark: "   " })], noBlocks, prefs, weekStart);
    expect(req.tasks[0].remark).toBeUndefined();
  });
});
