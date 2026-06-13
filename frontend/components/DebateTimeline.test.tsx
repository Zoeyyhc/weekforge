import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DebateTimeline } from "@/components/DebateTimeline";
import { DebateMessage } from "@/components/DebateMessage";
import { DebateEventMsg } from "@/lib/types";

const mk = (round: number, content: string): DebateEventMsg => ({
  type: "debate_event",
  round,
  speaker: "EnergyGuardian",
  content,
  event_type: "proposal",
});

describe("DebateMessage", () => {
  it("renders the agent label and content", () => {
    render(<DebateMessage event={mk(1, "Protect the mornings")} />);
    expect(screen.getByText("Energy Guardian")).toBeInTheDocument();
    expect(screen.getByText("Protect the mornings")).toBeInTheDocument();
  });
});

describe("DebateTimeline", () => {
  it("renders one message per event", () => {
    render(<DebateTimeline events={[mk(1, "A"), mk(1, "B"), mk(2, "C")]} />);
    expect(screen.getAllByTestId("debate-message")).toHaveLength(3);
  });

  it("shows a round divider when the round number changes", () => {
    render(<DebateTimeline events={[mk(1, "A"), mk(2, "B")]} />);
    const dividers = screen.getAllByTestId("round-divider");
    // One for round 1 (first event) and one for round 2 (change).
    expect(dividers).toHaveLength(2);
  });

  it("renders nothing but the container when there are no events", () => {
    render(<DebateTimeline events={[]} />);
    expect(screen.getByTestId("debate-timeline")).toBeInTheDocument();
    expect(screen.queryByTestId("debate-message")).not.toBeInTheDocument();
  });
});
