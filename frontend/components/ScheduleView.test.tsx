import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScheduleView } from "@/components/ScheduleView";
import { Schedule } from "@/lib/types";

vi.mock("react-big-calendar", () => ({
  Calendar: ({ events }: { events: { title: string }[] }) => (
    <div data-testid="rbc-calendar">
      {events.map((e, i) => (
        <div key={i}>{e.title}</div>
      ))}
    </div>
  ),
  dateFnsLocalizer: () => ({}),
}));

const SCHEDULE: Schedule = {
  week_start: null,
  blocks: [
    { start: "2026-06-15T09:00:00+00:00", end: "2026-06-15T11:00:00+00:00", label: "Write report", task_id: "t1" },
    { start: "2026-06-16T13:00:00+00:00", end: "2026-06-16T14:00:00+00:00", label: "Review PRs",   task_id: "t2" },
  ],
};

describe("ScheduleView", () => {
  it("renders each block's label", () => {
    render(<ScheduleView schedule={SCHEDULE} />);
    expect(screen.getByText("Write report")).toBeInTheDocument();
    expect(screen.getByText("Review PRs")).toBeInTheDocument();
  });

  it("shows an empty-state message when there are no blocks", () => {
    render(<ScheduleView schedule={{ week_start: null, blocks: [] }} />);
    expect(screen.getByTestId("schedule-empty")).toBeInTheDocument();
  });
});
