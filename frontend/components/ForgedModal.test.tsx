import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForgedModal } from "@/components/ForgedModal";
import { Schedule } from "@/lib/types";

const schedule: Schedule = {
  week_start: null,
  blocks: [
    { start: "2026-06-15T09:00:00", end: "2026-06-15T10:00:00", label: "Deep work", task_id: "t1" },
  ],
};

const warnings =
  "Schedule failed semantic validation:\n  - block 'Deep work' overlaps a busy block";

describe("ForgedModal", () => {
  it("keeps the celebration copy and shows no caution banner when not degraded", () => {
    render(<ForgedModal open schedule={schedule} onClose={() => {}} degraded={false} />);

    expect(screen.getByText("Your week is forged.")).toBeInTheDocument();
    expect(
      screen.getByText(/here's what the crucible produced/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/review them before adding/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/show details/i)).not.toBeInTheDocument();
  });

  it("keeps the title but shows the degraded subtitle and caution banner when degraded", () => {
    render(
      <ForgedModal
        open
        schedule={schedule}
        onClose={() => {}}
        degraded
        validationWarnings={warnings}
      />,
    );

    expect(screen.getByText("Your week is forged.")).toBeInTheDocument();
    expect(
      screen.getByText(/couldn't satisfy every constraint/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/here's what the crucible produced/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/review them before adding to your calendar/i)).toBeInTheDocument();
  });

  it("hides the warning detail behind a collapsed toggle, revealed on click", async () => {
    const user = userEvent.setup();
    render(
      <ForgedModal
        open
        schedule={schedule}
        onClose={() => {}}
        degraded
        validationWarnings={warnings}
      />,
    );

    // Collapsed by default — warning text not yet shown.
    expect(screen.queryByText(/overlaps a busy block/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /show details/i }));

    expect(screen.getByText(/overlaps a busy block/i)).toBeInTheDocument();
  });

  it("omits the details toggle when degraded but warnings are empty", () => {
    render(
      <ForgedModal
        open
        schedule={schedule}
        onClose={() => {}}
        degraded
        validationWarnings={null}
      />,
    );

    expect(screen.getByText(/review them before adding/i)).toBeInTheDocument();
    expect(screen.queryByText(/show details/i)).not.toBeInTheDocument();
  });
});
