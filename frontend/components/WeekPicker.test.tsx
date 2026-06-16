import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WeekPicker } from "@/components/WeekPicker";

const NOW = new Date(2026, 5, 17, 10); // Wed 17 Jun 2026, 10:00

describe("WeekPicker", () => {
  it("marks the selected week row as pressed", () => {
    render(<WeekPicker value="2026-06-15" onChange={() => {}} workdayEndHour={18} now={NOW} />);
    expect(screen.getByTestId("week-row-2026-06-15")).toHaveAttribute("aria-pressed", "true");
  });

  it("disables a fully-past week", () => {
    render(<WeekPicker value="2026-06-15" onChange={() => {}} workdayEndHour={18} now={NOW} />);
    expect(screen.getByTestId("week-row-2026-06-08")).toBeDisabled();
  });

  it("selecting a future week calls onChange with its Monday", () => {
    const onChange = vi.fn();
    render(<WeekPicker value="2026-06-15" onChange={onChange} workdayEndHour={18} now={NOW} />);
    fireEvent.click(screen.getByTestId("week-row-2026-06-22"));
    expect(onChange).toHaveBeenCalledWith("2026-06-22");
  });

  it("month nav moves to the next month", () => {
    render(<WeekPicker value="2026-06-15" onChange={() => {}} workdayEndHour={18} now={NOW} />);
    fireEvent.click(screen.getByLabelText("Next month"));
    expect(screen.getByText(/July 2026/)).toBeInTheDocument();
  });

  it("keeps the visible month stable after selecting an adjacent-month week", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <WeekPicker value="2026-06-15" onChange={onChange} workdayEndHour={18} now={NOW} />
    );

    fireEvent.click(screen.getByLabelText("Next month"));
    fireEvent.click(screen.getByTestId("week-row-2026-07-06"));

    expect(onChange).toHaveBeenCalledWith("2026-07-06");

    rerender(<WeekPicker value="2026-07-06" onChange={onChange} workdayEndHour={18} now={NOW} />);

    expect(screen.getByText(/July 2026/)).toBeInTheDocument();
    expect(screen.getByTestId("week-row-2026-07-06")).toHaveAttribute("aria-pressed", "true");
  });
});
