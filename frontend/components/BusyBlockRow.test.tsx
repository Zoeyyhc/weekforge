import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BusyBlockRow } from "@/components/BusyBlockRow";
import { BusyBlockDraft } from "@/lib/buildRequest";

const draft: BusyBlockDraft = {
  label: "Standup",
  start: "2026-06-15T10:00",
  end: "2026-06-15T11:00",
};

describe("BusyBlockRow", () => {
  it("renders the draft values", () => {
    render(<BusyBlockRow draft={draft} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByTestId("busy-label-input")).toHaveValue("Standup");
    expect(screen.getByTestId("busy-start-input")).toHaveValue("2026-06-15T10:00");
    expect(screen.getByTestId("busy-end-input")).toHaveValue("2026-06-15T11:00");
  });

  it("emits a label patch on typing", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BusyBlockRow draft={{ ...draft, label: "" }} onChange={onChange} onRemove={vi.fn()} />);
    await user.type(screen.getByTestId("busy-label-input"), "X");
    expect(onChange).toHaveBeenCalledWith({ label: "X" });
  });

  it("calls onRemove when the remove button is clicked", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<BusyBlockRow draft={draft} onChange={vi.fn()} onRemove={onRemove} />);
    await user.click(screen.getByTestId("busy-remove"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
