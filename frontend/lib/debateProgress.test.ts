import { describe, it, expect } from "vitest";
import { debateProgress } from "@/lib/debateProgress";
import { DebateEventMsg, Speaker, DebateEventType } from "@/lib/types";

const ev = (round: number, speaker: Speaker, event_type: DebateEventType): DebateEventMsg => ({
  type: "debate_event",
  round,
  speaker,
  content: "x",
  event_type,
});

describe("debateProgress", () => {
  it("reports round 0 and no active speaker with no events", () => {
    const p = debateProgress([], 3, "streaming");
    expect(p.currentRound).toBe(0);
    expect(p.activeSpeaker).toBeNull();
    expect(p.maxRounds).toBe(3);
    expect(p.roster.map((r) => r.speaker)).toEqual([
      "DeadlineHawk", "EnergyGuardian", "FocusBatcher", "Arbiter",
    ]);
    expect(p.roster.every((r) => r.action === "waiting")).toBe(true);
  });

  it("uses the latest event for current round and active speaker while streaming", () => {
    const p = debateProgress(
      [ev(1, "DeadlineHawk", "proposal"), ev(2, "EnergyGuardian", "critique")],
      3,
      "streaming",
    );
    expect(p.currentRound).toBe(2);
    expect(p.activeSpeaker).toBe("EnergyGuardian");
  });

  it("maps each debater's latest event to an action and marks the active one", () => {
    const p = debateProgress(
      [ev(1, "DeadlineHawk", "proposal"), ev(1, "EnergyGuardian", "critique")],
      3,
      "streaming",
    );
    const hawk = p.roster.find((r) => r.speaker === "DeadlineHawk")!;
    const guardian = p.roster.find((r) => r.speaker === "EnergyGuardian")!;
    expect(hawk.action).toBe("proposed");
    expect(hawk.active).toBe(false);
    expect(guardian.action).toBe("critiqued");
    expect(guardian.active).toBe(true);
  });

  it("clears the active speaker when not streaming", () => {
    const p = debateProgress([ev(2, "Arbiter", "arbitration")], 3, "done");
    expect(p.activeSpeaker).toBeNull();
    expect(p.roster.find((r) => r.speaker === "Arbiter")!.action).toBe("decided");
  });

  it("clamps current round to maxRounds", () => {
    const p = debateProgress([ev(9, "DeadlineHawk", "proposal")], 3, "streaming");
    expect(p.currentRound).toBe(3);
  });
});
