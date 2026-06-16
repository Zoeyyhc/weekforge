import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskRow } from "@/components/TaskRow";
import { TaskDraft } from "@/lib/buildRequest";

const draft: TaskDraft = {
  id: "test-t1",
  title: "Write report",
  estimatedMinutes: "120",
  priority: 2,
  hasDeadline: false,
  deadlineWeekday: "Fri",
  preferredDays: [],
  remark: "",
};

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

  it("emits an estimatedMinutes patch on input", async () => {
    const onChange = vi.fn();
    render(<TaskRow draft={{ ...draft, estimatedMinutes: "" }} onChange={onChange} onRemove={vi.fn()} />);
    const input = screen.getByTestId("task-minutes-input") as HTMLInputElement;
    // Use fireEvent to directly set value and trigger change
    fireEvent.change(input, { target: { value: "45" } });
    expect(onChange).toHaveBeenLastCalledWith({ estimatedMinutes: "45" });
  });
});

describe("TaskRow — deadline + preferred days", () => {
  it("hides deadline weekday select when hasDeadline is false", () => {
    render(<TaskRow draft={draft} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryByLabelText(/deadline weekday/i)).toBeNull();
  });

  it("shows deadline weekday select when hasDeadline is true", () => {
    render(<TaskRow draft={{ ...draft, hasDeadline: true }} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByLabelText(/deadline weekday/i)).toBeInTheDocument();
  });

  it("calls onChange with hasDeadline toggled when deadline pill is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TaskRow draft={draft} onChange={onChange} onRemove={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /deadline/i }));
    expect(onChange).toHaveBeenCalledWith({ hasDeadline: true });
  });

  it("adds first preferred day on first pill click", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TaskRow draft={draft} onChange={onChange} onRemove={vi.fn()} />);
    await user.click(screen.getByTestId("day-pill-Wed"));
    expect(onChange).toHaveBeenCalledWith({ preferredDays: ["Wed"] });
  });

  it("adds second preferred day when one is already selected", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TaskRow draft={{ ...draft, preferredDays: ["Wed"] }} onChange={onChange} onRemove={vi.fn()} />
    );
    await user.click(screen.getByTestId("day-pill-Fri"));
    expect(onChange).toHaveBeenCalledWith({ preferredDays: ["Wed", "Fri"] });
  });

  it("removes a preferred day when its pill is clicked again", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TaskRow draft={{ ...draft, preferredDays: ["Wed", "Fri"] }} onChange={onChange} onRemove={vi.fn()} />
    );
    await user.click(screen.getByTestId("day-pill-Wed"));
    expect(onChange).toHaveBeenCalledWith({ preferredDays: ["Fri"] });
  });

  it("does not add a third preferred day (max 2)", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TaskRow draft={{ ...draft, preferredDays: ["Wed", "Fri"] }} onChange={onChange} onRemove={vi.fn()} />
    );
    await user.click(screen.getByTestId("day-pill-Mon"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables a past preferred-day chip and ignores clicks on it", () => {
    const onChange = vi.fn();
    render(
      <TaskRow
        draft={{
          id: "d1",
          title: "T",
          estimatedMinutes: "60",
          priority: 2,
          hasDeadline: false,
          deadlineWeekday: "Fri",
          preferredDays: [],
          remark: "",
        }}
        onChange={onChange}
        onRemove={() => {}}
        disabledDays={["Mon", "Tue"]}
        weekStart="2026-06-15"
      />,
    );
    const monPill = screen.getByTestId("day-pill-Mon");
    expect(monPill).toBeDisabled();
    fireEvent.click(monPill);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("leaves a future day clickable", () => {
    const onChange = vi.fn();
    render(
      <TaskRow
        draft={{
          id: "d1",
          title: "T",
          estimatedMinutes: "60",
          priority: 2,
          hasDeadline: false,
          deadlineWeekday: "Fri",
          preferredDays: [],
          remark: "",
        }}
        onChange={onChange}
        onRemove={() => {}}
        disabledDays={["Mon", "Tue"]}
        weekStart="2026-06-15"
      />,
    );
    fireEvent.click(screen.getByTestId("day-pill-Thu"));
    expect(onChange).toHaveBeenCalledWith({ preferredDays: ["Thu"] });
  });
});
