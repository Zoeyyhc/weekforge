import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScheduleView } from "@/components/ScheduleView";
import { Schedule } from "@/lib/types";

describe("ScheduleView", () => {
  it("renders each block's label and time range, grouped by day", () => {
    const schedule: Schedule = {
      week_start: null,
      blocks: [
        { start: "2026-06-15T09:00:00+00:00", end: "2026-06-15T11:00:00+00:00", label: "Write report", task_id: "t1" },
        { start: "2026-06-16T13:00:00+00:00", end: "2026-06-16T14:00:00+00:00", label: "Review PRs", task_id: "t2" },
      ],
    };
    render(<ScheduleView schedule={schedule} />);
    expect(screen.getByText("Write report")).toBeInTheDocument();
    expect(screen.getByText("Review PRs")).toBeInTheDocument();
    expect(screen.getByText("Monday, Jun 15")).toBeInTheDocument();
    expect(screen.getByText("Tuesday, Jun 16")).toBeInTheDocument();
    expect(screen.getByText("09:00 AM – 11:00 AM")).toBeInTheDocument();
  });

  it("shows an empty-state message when there are no blocks", () => {
    render(<ScheduleView schedule={{ week_start: null, blocks: [] }} />);
    expect(screen.getByTestId("schedule-empty")).toBeInTheDocument();
  });
});
