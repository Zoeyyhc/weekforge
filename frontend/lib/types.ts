export type Speaker =
  | "DeadlineHawk"
  | "EnergyGuardian"
  | "FocusBatcher"
  | "Arbiter"
  | "Human"
  | "System";

export type DebateEventType =
  | "proposal"
  | "critique"
  | "arbitration"
  | "human_intervention"
  | "validation_fail"
  | "system";

export interface DebateEventMsg {
  type: "debate_event";
  round: number;
  speaker: Speaker;
  content: string;
  event_type: DebateEventType;
}

export interface InterruptMsg {
  type: "interrupt";
  interrupt_reason: string;
  proposals: Record<string, string>;
  thread_id: string;
}

export interface TimeBlock {
  start: string;
  end: string;
  label: string;
  task_id: string | null;
}

export interface Schedule {
  week_start: string | null;
  blocks: TimeBlock[];
}

export interface DoneMsg {
  type: "done";
  schedule: Schedule | null;
  thread_id: string;
}

export interface ErrorMsg {
  type: "error";
  message: string;
}

export type DebateMessage = DebateEventMsg | InterruptMsg | DoneMsg | ErrorMsg;

export interface TaskInput {
  id: string;
  title: string;
  estimated_minutes: number;
  deadline?: string | null;
  priority?: number;
  category?: string | null;
  depends_on?: string[];
}

export interface BusyBlockInput {
  start: string;
  end: string;
  label: string;
  task_id?: string | null;
}

export interface PreferencesInput {
  workday_start_hour?: number;
  workday_end_hour?: number;
  max_focus_minutes_per_day?: number;
}

export interface StartDebateRequest {
  tasks: TaskInput[];
  busy_blocks?: BusyBlockInput[];
  preferences?: PreferencesInput;
  max_rounds?: number;
  week_start?: string; // ISO date (YYYY-MM-DD) — tells the council which week to schedule
  // When true (default), a stalled council pauses for your input. Set false to
  // let the Arbiter decide automatically without waiting for a human.
  require_human_on_stall?: boolean;
}
