import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("renders markdown bold as a <strong> element", () => {
    render(<DebateMessage event={mk(1, "This is **important**")} />);
    const strong = document.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("important");
  });
});

describe("DebateTimeline", () => {
  it("renders the container with no tabs when there are no events", () => {
    render(<DebateTimeline events={[]} />);
    expect(screen.getByTestId("debate-timeline")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByTestId("debate-message")).not.toBeInTheDocument();
  });

  it("renders one tab per distinct round", () => {
    render(
      <DebateTimeline events={[mk(1, "R1 msg"), mk(1, "R1 msg2"), mk(2, "R2 msg")]} />
    );
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByTestId("round-tab-1")).toBeInTheDocument();
    expect(screen.getByTestId("round-tab-2")).toBeInTheDocument();
  });

  it("shows only the active tab's messages by default (latest round)", () => {
    render(
      <DebateTimeline events={[mk(1, "Round one"), mk(2, "Round two")]} />
    );
    expect(screen.getByText("Round two")).toBeInTheDocument();
    expect(screen.queryByText("Round one")).not.toBeInTheDocument();
  });

  it("switches displayed messages when a tab is clicked", async () => {
    const user = userEvent.setup();
    render(
      <DebateTimeline events={[mk(1, "Round one"), mk(2, "Round two")]} />
    );
    await user.click(screen.getByTestId("round-tab-1"));
    expect(screen.getByText("Round one")).toBeInTheDocument();
    expect(screen.queryByText("Round two")).not.toBeInTheDocument();
  });

  it("auto-follows the latest round while streaming", () => {
    const { rerender } = render(
      <DebateTimeline events={[mk(1, "R1")]} status="streaming" />
    );
    expect(screen.getByText("R1")).toBeInTheDocument();

    rerender(
      <DebateTimeline events={[mk(1, "R1"), mk(2, "R2")]} status="streaming" />
    );
    expect(screen.getByText("R2")).toBeInTheDocument();
    expect(screen.queryByText("R1")).not.toBeInTheDocument();
  });

  it("pins view to the clicked tab and does not auto-follow when user selects an earlier round", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DebateTimeline events={[mk(1, "R1"), mk(2, "R2")]} status="streaming" />
    );
    // User clicks Round 1 to opt out of auto-follow
    await user.click(screen.getByTestId("round-tab-1"));
    expect(screen.getByText("R1")).toBeInTheDocument();

    // A new round arrives but view should NOT chase to it
    rerender(
      <DebateTimeline events={[mk(1, "R1"), mk(2, "R2"), mk(3, "R3")]} status="streaming" />
    );
    expect(screen.getByText("R1")).toBeInTheDocument();
    expect(screen.queryByText("R3")).not.toBeInTheDocument();
  });

  it("re-enables auto-follow when user clicks the latest round tab while streaming", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DebateTimeline events={[mk(1, "R1"), mk(2, "R2")]} status="streaming" />
    );
    // First click an earlier tab to opt out
    await user.click(screen.getByTestId("round-tab-1"));
    expect(screen.getByText("R1")).toBeInTheDocument();

    // Click the latest tab to re-enable auto-follow
    await user.click(screen.getByTestId("round-tab-2"));

    // A new round arrives — should now auto-follow
    rerender(
      <DebateTimeline events={[mk(1, "R1"), mk(2, "R2"), mk(3, "R3")]} status="streaming" />
    );
    expect(screen.getByText("R3")).toBeInTheDocument();
    expect(screen.queryByText("R1")).not.toBeInTheDocument();
  });

  it("shows a live pulse dot on the latest round tab while streaming", () => {
    render(
      <DebateTimeline events={[mk(1, "R1"), mk(2, "R2")]} status="streaming" />
    );
    expect(screen.getByTestId("live-dot")).toBeInTheDocument();
  });

  it("does not show a live dot when status is done", () => {
    render(
      <DebateTimeline events={[mk(1, "R1"), mk(2, "R2")]} status="done" />
    );
    expect(screen.queryByTestId("live-dot")).not.toBeInTheDocument();
  });
});
