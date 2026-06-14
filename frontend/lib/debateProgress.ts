import { DebateEventMsg, Speaker, DebateEventType } from "@/lib/types";
import { DebateStatus } from "@/lib/debateReducer";

export type AgentAction =
  | "proposed" | "critiqued" | "decided" | "intervened" | "waiting";

export interface RosterEntry {
  speaker: Speaker;
  action: AgentAction;
  round: number | null;
  active: boolean;
}

export interface DebateProgress {
  currentRound: number;
  maxRounds: number;
  activeSpeaker: Speaker | null;
  roster: RosterEntry[];
}

// The four debaters, in speaking order, shown in the roster.
const DEBATERS: Speaker[] = ["DeadlineHawk", "EnergyGuardian", "FocusBatcher", "Arbiter"];

const ACTION_BY_EVENT: Record<DebateEventType, AgentAction> = {
  proposal: "proposed",
  critique: "critiqued",
  arbitration: "decided",
  human_intervention: "intervened",
  validation_fail: "waiting",
  system: "waiting",
};

export function debateProgress(
  events: DebateEventMsg[],
  maxRounds: number,
  status: DebateStatus,
): DebateProgress {
  const last = events.length ? events[events.length - 1] : null;
  const rawRound = last ? last.round : 0;
  const currentRound = Math.min(Math.max(rawRound, 0), maxRounds);
  const activeSpeaker = status === "streaming" && last ? last.speaker : null;

  const latest = new Map<Speaker, DebateEventMsg>();
  for (const e of events) latest.set(e.speaker, e);

  const roster: RosterEntry[] = DEBATERS.map((speaker) => {
    const e = latest.get(speaker);
    return {
      speaker,
      action: e ? ACTION_BY_EVENT[e.event_type] : "waiting",
      round: e ? e.round : null,
      active: speaker === activeSpeaker,
    };
  });

  return { currentRound, maxRounds, activeSpeaker, roster };
}
