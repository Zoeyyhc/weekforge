import { DebateEventMsg, DebateMessage, InterruptMsg, Schedule } from "@/lib/types";

export type DebateStatus = "idle" | "streaming" | "interrupted" | "done" | "error";

export interface DebateState {
  status: DebateStatus;
  events: DebateEventMsg[];
  interrupt: InterruptMsg | null;
  schedule: Schedule | null;
  error: string | null;
  degraded: boolean;
  validationWarnings: string | null;
}

export const initialDebateState: DebateState = {
  status: "idle",
  events: [],
  interrupt: null,
  schedule: null,
  error: null,
  degraded: false,
  validationWarnings: null,
};

export type DebateAction =
  | { kind: "reset" }
  | { kind: "streaming" }
  | { kind: "message"; message: DebateMessage };

export function debateReducer(state: DebateState, action: DebateAction): DebateState {
  switch (action.kind) {
    case "reset":
      return initialDebateState;
    case "streaming":
      return { ...state, status: "streaming", error: null, interrupt: null };
    case "message": {
      const m = action.message;
      switch (m.type) {
        case "debate_event":
          return { ...state, status: "streaming", events: [...state.events, m] };
        case "interrupt":
          return { ...state, status: "interrupted", interrupt: m };
        case "done":
          return {
            ...state,
            status: "done",
            schedule: m.schedule,
            interrupt: null,
            degraded: m.degraded ?? false,
            validationWarnings: m.validation_warnings ?? null,
          };
        case "error":
          return { ...state, status: "error", error: m.message };
        default:
          return state;
      }
    }
    default:
      return state;
  }
}
