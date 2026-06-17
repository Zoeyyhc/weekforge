import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HeraldModal } from "@/components/HeraldModal";
import { InterruptMsg } from "@/lib/types";

const interrupt: InterruptMsg = {
  type: "interrupt",
  interrupt_reason: "The council stalled after 3 rounds without consensus.",
  proposals: {
    DeadlineHawk:
      "Front-load deep work Monday and Tuesday to clear the deadline. Block 9 to 12 both mornings.",
    EnergyGuardian:
      "Spread the work across the week with recovery gaps. No more than three focus hours a day.",
    FocusBatcher:
      "Batch all writing into two long Wednesday blocks. Keep meetings on Thursday.",
  },
  thread_id: "t-123",
};

const noop = () => {};

describe("HeraldModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <HeraldModal open={false} interrupt={interrupt} onSubmit={noop} onDismiss={noop} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there is no interrupt", () => {
    const { container } = render(
      <HeraldModal open interrupt={null} onSubmit={noop} onDismiss={noop} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("proclaims the Herald, the reason, and a stance lead per champion", () => {
    render(<HeraldModal open interrupt={interrupt} onSubmit={noop} onDismiss={noop} />);

    expect(screen.getByText("The Herald")).toBeInTheDocument();
    expect(
      screen.getByText(/stalled after 3 rounds without consensus/i),
    ).toBeInTheDocument();

    // Each champion's stance is named and led with its first line.
    expect(screen.getByText("Deadline Hawk")).toBeInTheDocument();
    expect(screen.getByText("Energy Guardian")).toBeInTheDocument();
    expect(screen.getByText("Focus Batcher")).toBeInTheDocument();
    expect(
      screen.getByText(/Front-load deep work Monday and Tuesday to clear the deadline\./i),
    ).toBeInTheDocument();
  });

  it("leads each stance with the Herald's distilled summary when present", async () => {
    const user = userEvent.setup();
    const summarised: InterruptMsg = {
      ...interrupt,
      proposal_summaries: {
        DeadlineHawk: "Front-load the deadline; pack Monday and Tuesday.",
        EnergyGuardian: "Spread the load; guard recovery between blocks.",
        FocusBatcher: "Batch like with like; defend long focus windows.",
      },
    };
    render(<HeraldModal open interrupt={summarised} onSubmit={noop} onDismiss={noop} />);

    // The Herald's distilled line leads, not the proposal's raw first sentence.
    expect(
      screen.getByText(/Front-load the deadline; pack Monday and Tuesday\./i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Front-load deep work Monday and Tuesday to clear the deadline\./i),
    ).not.toBeInTheDocument();

    // The full proposal is still reachable behind the fold.
    await user.click(screen.getAllByRole("button", { name: /full proposal/i })[0]);
    expect(screen.getByText(/Block 9 to 12 both mornings/i)).toBeInTheDocument();
  });

  it("hides the rest of a proposal until its stance is expanded", async () => {
    const user = userEvent.setup();
    render(<HeraldModal open interrupt={interrupt} onSubmit={noop} onDismiss={noop} />);

    expect(screen.queryByText(/Block 9 to 12 both mornings/i)).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /full proposal/i })[0]);

    expect(screen.getByText(/Block 9 to 12 both mornings/i)).toBeInTheDocument();
  });

  it("siding with a champion submits that ruling", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<HeraldModal open interrupt={interrupt} onSubmit={onSubmit} onDismiss={noop} />);

    await user.click(screen.getByRole("button", { name: /side with the energy guardian/i }));
    await user.click(screen.getByRole("button", { name: /cast your ruling/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatch(/energy guardian/i);
  });

  it("submits free-text and disables the ruling while empty", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<HeraldModal open interrupt={interrupt} onSubmit={onSubmit} onDismiss={noop} />);

    const rule = screen.getByRole("button", { name: /cast your ruling/i });
    expect(rule).toBeDisabled();

    await user.type(
      screen.getByPlaceholderText(/add a constraint, side with a champion, or veto/i),
      "Cap each day at four hours.",
    );
    expect(rule).toBeEnabled();
    await user.click(rule);

    expect(onSubmit).toHaveBeenCalledWith("Cap each day at four hours.");
  });

  it("dismisses to the full debate on the escape key and the read-debate link", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<HeraldModal open interrupt={interrupt} onSubmit={noop} onDismiss={onDismiss} />);

    await user.click(screen.getByRole("button", { name: /read the full debate/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});
