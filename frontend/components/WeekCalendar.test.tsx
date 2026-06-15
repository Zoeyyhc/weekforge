import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
