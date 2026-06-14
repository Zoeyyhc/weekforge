import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DebateStatusBand } from "@/components/DebateStatusBand";
import { DebateProgress } from "@/lib/debateProgress";

const base: DebateProgress = {
  currentRound: 2,
  maxRounds: 3,
  activeSpeaker: "EnergyGuardian",
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
});
