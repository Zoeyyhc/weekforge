import { StartDebateRequest } from "@/lib/types";

export interface TaskDraft {
  id: string;
  title: string;
  estimatedMinutes: string; // raw input value; parsed on build
  priority: number;
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
