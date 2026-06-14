import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DebateStatusBand } from "@/components/DebateStatusBand";
import { DebateProgress } from "@/lib/debateProgress";

const base: DebateProgress = {
  currentRound: 2,
  maxRounds: 3,
  activeSpeaker: "EnergyGuardian",
  lastSpeaker: "EnergyGuardian",
  roster: [],
};

describe("DebateStatusBand", () => {
  it("shows the current round out of max", () => {
    render(<DebateStatusBand progress={base} status="streaming" />);
    expect(screen.getByTestId("round-counter")).toHaveTextContent("2");
    expect(screen.getByTestId("round-counter")).toHaveTextContent("3");
  });

  it("names the active speaker while streaming", () => {
    render(<DebateStatusBand progress={base} status="streaming" />);
    expect(screen.getByTestId("now-speaking")).toHaveTextContent(/Energy Guardian/);
  });

  it("shows a decided state when done", () => {
    render(
      <DebateStatusBand
        progress={{ ...base, activeSpeaker: null }}
        status="done"
      />,
    );
    expect(screen.getByTestId("now-speaking")).toHaveTextContent(/decided/i);
  });

  it("renders one progress segment per round", () => {
    render(<DebateStatusBand progress={base} status="streaming" />);
    expect(screen.getAllByTestId("round-segment")).toHaveLength(3);
  });

  it("shows a deliberating state during a silent gap (streaming, no active speaker)", () => {
    render(
      <DebateStatusBand
        progress={{
          ...base,
          activeSpeaker: null,
          lastSpeaker: "FocusBatcher",
          roster: [
            { speaker: "FocusBatcher", action: "critiqued", round: 2, active: false },
          ],
        }}
        status="streaming"
      />,
    );
    expect(screen.getByTestId("now-speaking")).toHaveTextContent(/deliberating/i);
    // does NOT falsely claim the last speaker is speaking
    expect(screen.getByTestId("now-speaking")).not.toHaveTextContent(/is speaking/i);
    // surfaces the last contributor as context
    expect(screen.getByTestId("now-speaking")).toHaveTextContent(/Focus Batcher/);
  });

  it("shows convening before any events arrive", () => {
    render(
      <DebateStatusBand
        progress={{ ...base, currentRound: 0, activeSpeaker: null, lastSpeaker: null, roster: [] }}
        status="streaming"
      />,
    );
    expect(screen.getByTestId("now-speaking")).toHaveTextContent(/convening/i);
  });
});
