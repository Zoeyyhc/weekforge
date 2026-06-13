import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskRow } from "@/components/TaskRow";
import { TaskDraft } from "@/lib/buildRequest";

const draft: TaskDraft = { title: "Write report", estimatedMinutes: "120", priority: 2 };

describe("TaskRow", () => {
  it("renders the draft values", () => {
    render(<TaskRow draft={draft} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByTestId("task-title-input")).toHaveValue("Write report");
    expect(screen.getByTestId("task-minutes-input")).toHaveValue(120);
    expect(screen.getByTestId("task-priority-select")).toHaveValue("2");
  });

  it("emits a title patch on typing", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TaskRow draft={{ ...draft, title: "" }} onChange={onChange} onRemove={vi.fn()} />);
    await user.type(screen.getByTestId("task-title-input"), "A");
    expect(onChange).toHaveBeenCalledWith({ title: "A" });
  });

  it("emits a numeric priority patch on select", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TaskRow draft={draft} onChange={onChange} onRemove={vi.fn()} />);
    await user.selectOptions(screen.getByTestId("task-priority-select"), "4");
    expect(onChange).toHaveBeenCalledWith({ priority: 4 });
  });

  it("calls onRemove when the remove button is clicked", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<TaskRow draft={draft} onChange={vi.fn()} onRemove={onRemove} />);
    await user.click(screen.getByTestId("task-remove"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
