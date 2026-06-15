import { StartDebateRequest } from "@/lib/types";

export interface TaskDraft {
  id: string;
  title: string;
  estimatedMinutes: string; // raw input value; parsed on build
  priority: number;
  hasDeadline: boolean;
  deadlineWeekday: string; // "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"
  preferredDays: string[]; // ordered, max 2: [firstChoice, secondChoice]
}

export interface BusyBlockDraft {
  id: string;
  label: string;
  start: string; // datetime-local value, e.g. "2026-06-15T10:00"
  end: string;
}

export interface PrefsDraft {
  workdayStartHour: string;
  workdayEndHour: string;
  maxFocusMinutes: string;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
};

/** Convert a weekday abbreviation to the ISO datetime of that day at 23:59 local time in the current week. */
function deadlineToISO(weekday: string): string {
  const today = new Date();
  const mondayOffset = (today.getDay() + 6) % 7; // days since Monday (0 = Mon)
  const targetOffset = WEEKDAY_INDEX[weekday] ?? 4;
  const diff = targetOffset - mondayOffset;
  const target = new Date(today);
  target.setDate(today.getDate() + diff);
  target.setHours(23, 59, 0, 0);
  return target.toISOString();
}

/** Pure transform: form drafts -> the API request the backend expects. */
export function buildRequest(
  tasks: TaskDraft[],
  busyBlocks: BusyBlockDraft[],
  prefs: PrefsDraft,
): StartDebateRequest {
  return {
    tasks: tasks.map((t, i) => ({
      id: `t${i + 1}`,
      title: t.title.trim(),
      estimated_minutes: Number(t.estimatedMinutes),
      priority: t.priority,
      deadline: t.hasDeadline ? deadlineToISO(t.deadlineWeekday) : null,
      ...(t.preferredDays.length > 0 && { preferred_days: t.preferredDays }),
    })),
    busy_blocks: busyBlocks.length
      ? busyBlocks.map((b) => ({
          label: b.label.trim(),
          start: new Date(b.start).toISOString(),
          end: new Date(b.end).toISOString(),
        }))
      : undefined,
    preferences: {
      workday_start_hour: Number(prefs.workdayStartHour),
      workday_end_hour: Number(prefs.workdayEndHour),
      max_focus_minutes_per_day: Number(prefs.maxFocusMinutes),
    },
    max_rounds: 3,
    require_human_on_stall: true,
  };
}
