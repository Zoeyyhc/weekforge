import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskForm } from "@/components/TaskForm";

describe("TaskForm", () => {
  it("submits the seeded sample week as a StartDebateRequest", async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<TaskForm onStart={onStart} />);

    await user.click(screen.getByRole("button", { name: /convene the council/i }));

    expect(onStart).toHaveBeenCalledTimes(1);
    const req = onStart.mock.calls[0][0];
    expect(req.tasks.length).toBeGreaterThan(0);
    expect(req.tasks[0].id).toBe("t1");
    expect(req.max_rounds).toBe(3);
    expect(req.require_human_on_stall).toBe(true);
  });

  it("adds a task row when Add task is clicked", async () => {
    const user = userEvent.setup();
    render(<TaskForm onStart={vi.fn()} />);

    const before = screen.getAllByTestId("task-row").length;
    await user.click(screen.getByTestId("add-task-btn"));
    expect(screen.getAllByTestId("task-row").length).toBe(before + 1);
  });

  it("removes a task row when its remove button is clicked", async () => {
    const user = userEvent.setup();
    render(<TaskForm onStart={vi.fn()} />);

    const before = screen.getAllByTestId("task-row").length;
    await user.click(screen.getAllByTestId("task-remove")[0]);
    expect(screen.getAllByTestId("task-row").length).toBe(before - 1);
  });

  it("blocks submit and shows an error when no task has a title", async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<TaskForm onStart={onStart} />);

    // Clear every task title.
    for (const input of screen.getAllByTestId("task-title-input")) {
      await user.clear(input);
    }
    await user.click(screen.getByRole("button", { name: /convene the council/i }));

    expect(screen.getByTestId("form-error")).toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("blocks submit when a busy block ends before it starts", async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<TaskForm onStart={onStart} />);

    const end = screen.getAllByTestId("busy-end-input")[0];
    // datetime-local is unreliable with userEvent.type in jsdom; set the value directly.
    fireEvent.change(end, { target: { value: "2026-06-15T09:00" } }); // before the seeded 10:00 start
    await user.click(screen.getByRole("button", { name: /convene the council/i }));

    expect(screen.getByTestId("form-error")).toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("submits successfully when an empty busy block row exists (no crash)", async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<TaskForm onStart={onStart} />);

    // Add a block row but leave it empty (no start/end).
    await user.click(screen.getByTestId("add-block-btn"));
    // Should not throw; empty block is silently dropped.
    await user.click(screen.getByRole("button", { name: /convene the council/i }));

    expect(onStart).toHaveBeenCalledTimes(1);
    const req = onStart.mock.calls[0][0];
    // The seeded block is present but the empty one is dropped.
    expect(req.busy_blocks).toBeDefined();
  });

  it("removing a middle task row does not corrupt the remaining rows", async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<TaskForm onStart={onStart} />);

    // Add a third task row.
    await user.click(screen.getByTestId("add-task-btn"));
    // Fill the new (third) task title.
    const inputs = screen.getAllByTestId("task-title-input");
    await user.clear(inputs[2]);
    await user.type(inputs[2], "Third task");

    // Remove the first row.
    await user.click(screen.getAllByTestId("task-remove")[0]);

    // "Third task" must still be visible — it was in slot 2, now in slot 1.
    expect(screen.getByDisplayValue("Third task")).toBeInTheDocument();
    // And there should be exactly 2 rows left (started with 2, added 1, removed 1).
    expect(screen.getAllByTestId("task-row").length).toBe(2);
  });
});
