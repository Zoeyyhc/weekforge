import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WeekCalendar } from "@/components/WeekCalendar";
import { Schedule } from "@/lib/types";

vi.mock("react-big-calendar", () => ({
  Calendar: ({ events }: { events: { title: string }[] }) => (
    <div data-testid="rbc-calendar">
      {events.map((e, i) => (
        <div key={i} data-testid="rbc-event">{e.title}</div>
      ))}
    </div>
  ),
  dateFnsLocalizer: () => ({}),
}));

const SCHEDULE: Schedule = {
  week_start: null,
  blocks: [
    { label: "Write report", start: "2026-06-15T09:00:00.000Z", end: "2026-06-15T11:00:00.000Z", task_id: "t1" },
    { label: "Review PRs",   start: "2026-06-15T14:00:00.000Z", end: "2026-06-15T17:00:00.000Z", task_id: "t2" },
  ],
};

describe("WeekCalendar", () => {
  it("renders block labels inside the calendar", () => {
    render(<WeekCalendar schedule={SCHEDULE} />);
    expect(screen.getByText("Write report")).toBeInTheDocument();
    expect(screen.getByText("Review PRs")).toBeInTheDocument();
  });

  it("renders the empty-state message when there are no blocks", () => {
    render(<WeekCalendar schedule={{ week_start: null, blocks: [] }} />);
    expect(screen.getByTestId("schedule-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("rbc-calendar")).not.toBeInTheDocument();
  });
});
