import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CouncilRoster } from "@/components/CouncilRoster";
import { RosterEntry } from "@/lib/debateProgress";

const roster: RosterEntry[] = [
  { speaker: "DeadlineHawk", action: "proposed", round: 1, active: false },
  { speaker: "EnergyGuardian", action: "critiqued", round: 2, active: true },
  { speaker: "FocusBatcher", action: "waiting", round: null, active: false },
  { speaker: "Arbiter", action: "waiting", round: null, active: false },
];

describe("CouncilRoster", () => {
  it("renders a row per agent with its label", () => {
    render(<CouncilRoster roster={roster} />);
    expect(screen.getByText("Deadline Hawk")).toBeInTheDocument();
    expect(screen.getByText("Energy Guardian")).toBeInTheDocument();
    expect(screen.getByText("Focus Batcher")).toBeInTheDocument();
    expect(screen.getByText("Arbiter")).toBeInTheDocument();
  });

  it("marks the active agent's row", () => {
    render(<CouncilRoster roster={roster} />);
    const active = screen.getByTestId("roster-EnergyGuardian");
    expect(active).toHaveAttribute("data-active", "true");
  });

  it("shows each agent's last action label", () => {
    render(<CouncilRoster roster={roster} />);
    expect(screen.getByTestId("roster-DeadlineHawk")).toHaveTextContent(/proposed/i);
    expect(screen.getByTestId("roster-FocusBatcher")).toHaveTextContent(/waiting/i);
  });
});
