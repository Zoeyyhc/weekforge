import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskForm } from "@/components/TaskForm";

describe("TaskForm", () => {
  it("starts with the sample request and submits it parsed", async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<TaskForm onStart={onStart} />);

    await user.click(screen.getByRole("button", { name: /convene the council/i }));

    expect(onStart).toHaveBeenCalledTimes(1);
    const req = onStart.mock.calls[0][0];
    expect(Array.isArray(req.tasks)).toBe(true);
    expect(req.tasks.length).toBeGreaterThan(0);
  });

  it("shows an error and does not submit when the JSON is invalid", async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<TaskForm onStart={onStart} />);

    const textarea = screen.getByTestId("task-form-input");
    await user.clear(textarea);
    await user.type(textarea, "{{ not json ");
    await user.click(screen.getByRole("button", { name: /convene the council/i }));

    expect(screen.getByTestId("form-error")).toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
  });
});
