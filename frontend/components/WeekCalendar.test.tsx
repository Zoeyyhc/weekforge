import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WeekCalendar } from "@/components/WeekCalendar";
import { Schedule } from "@/lib/types";

const SCHEDULE: Schedule = {
  week_start: null,
  blocks: [
    { label: "Write report", start: "2026-06-15T09:00:00.000", end: "2026-06-15T11:00:00.000", task_id: "t1" },
    { label: "Review PRs",   start: "2026-06-15T14:00:00.000", end: "2026-06-15T17:00:00.000", task_id: "t2" },
    { label: "Deep work",    start: "2026-06-16T10:00:00.000", end: "2026-06-16T12:00:00.000", task_id: "t3" },
  ],
};

describe("WeekCalendar", () => {
  it("renders block labels", () => {
    render(<WeekCalendar schedule={SCHEDULE} />);
    expect(screen.getByText("Write report")).toBeInTheDocument();
    expect(screen.getByText("Review PRs")).toBeInTheDocument();
    expect(screen.getByText("Deep work")).toBeInTheDocument();
  });

  it("groups blocks by day with a block count per day", () => {
    render(<WeekCalendar schedule={SCHEDULE} />);
    // Two distinct days -> two day headers (Jun 15 has 2 blocks, Jun 16 has 1).
    expect(screen.getByText("2 blocks")).toBeInTheDocument();
    expect(screen.getByText("1 block")).toBeInTheDocument();
  });

  it("shows a start–end range and duration for a block", () => {
    render(<WeekCalendar schedule={SCHEDULE} />);
    const row = screen.getByText("Write report").closest("li") as HTMLElement;
    expect(within(row).getByText("9:00 AM")).toBeInTheDocument();
    expect(within(row).getByText("11:00 AM")).toBeInTheDocument();
    expect(within(row).getByText("2h")).toBeInTheDocument();
  });

  it("renders the empty-state message when there are no blocks", () => {
    render(<WeekCalendar schedule={{ week_start: null, blocks: [] }} />);
    expect(screen.getByTestId("schedule-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("week-calendar")).not.toBeInTheDocument();
  });
});

describe("WeekCalendar — editable mode", () => {
  it("renders time inputs when onEditTime is provided", () => {
    render(
      <WeekCalendar
        schedule={SCHEDULE}
        onEditTime={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    // Each block row should have two <input type="time"> elements
    const inputs = document.querySelectorAll('input[type="time"]');
    expect(inputs.length).toBe(SCHEDULE.blocks.length * 2); // start + end per block
  });

  it("calls onDelete with the correct block index when delete is clicked", async () => {
    const onDelete = vi.fn();
    render(
      <WeekCalendar schedule={SCHEDULE} onEditTime={vi.fn()} onDelete={onDelete} />,
    );
    const deleteButtons = screen.getAllByRole("button", { name: /delete block/i });
    await userEvent.click(deleteButtons[0]);
    expect(onDelete).toHaveBeenCalledWith(0);
  });

  it("calls onEditTime with block index, field, and new value", () => {
    const onEditTime = vi.fn();
    render(
      <WeekCalendar schedule={SCHEDULE} onEditTime={onEditTime} onDelete={vi.fn()} />,
    );
    const startInputs = document.querySelectorAll<HTMLInputElement>('input[type="time"]');
    fireEvent.change(startInputs[0], { target: { value: "10:30" } });
    expect(onEditTime).toHaveBeenCalledWith(0, "start", "10:30");
  });

  it("does not render delete buttons or time inputs in read-only mode", () => {
    render(<WeekCalendar schedule={SCHEDULE} />);
    expect(screen.queryByRole("button", { name: /delete block/i })).not.toBeInTheDocument();
    expect(document.querySelectorAll('input[type="time"]').length).toBe(0);
  });
});
