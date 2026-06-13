import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InterventionPanel } from "@/components/InterventionPanel";
import { InterruptMsg } from "@/lib/types";

const interrupt: InterruptMsg = {
  type: "interrupt",
  interrupt_reason: "The council could not reach consensus.",
  proposals: { DeadlineHawk: "pack it" },
  thread_id: "t1",
};

describe("InterventionPanel", () => {
  it("shows the interrupt reason", () => {
    render(<InterventionPanel interrupt={interrupt} onSubmit={() => {}} />);
    expect(screen.getByText(/could not reach consensus/i)).toBeInTheDocument();
  });

  it("submit is disabled until there is text", async () => {
    render(<InterventionPanel interrupt={interrupt} onSubmit={() => {}} />);
    const button = screen.getByRole("button", { name: /submit/i });
    expect(button).toBeDisabled();
  });

  it("a quick-action fills the box and enables submit, then calls onSubmit with the text", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<InterventionPanel interrupt={interrupt} onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: /side with energy guardian/i }));
    const submit = screen.getByRole("button", { name: /submit/i });
    expect(submit).toBeEnabled();

    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatch(/Energy Guardian/i);
  });
});
