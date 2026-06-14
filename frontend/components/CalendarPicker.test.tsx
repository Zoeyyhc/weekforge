import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalendarPicker } from "@/components/CalendarPicker";
import { CalendarInfo } from "@/lib/api";

const calendars: CalendarInfo[] = [
  { id: "p", summary: "me@x", primary: true, selected_by_default: true },
  { id: "h", summary: "US Holidays", primary: false, selected_by_default: false },
];

describe("CalendarPicker", () => {
  it("renders a checkbox per calendar, checked when selected", () => {
    render(<CalendarPicker calendars={calendars} selectedIds={["p"]} onToggle={() => {}} />);
    expect(screen.getByRole("checkbox", { name: /me@x/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /US Holidays/ })).not.toBeChecked();
  });

  it("calls onToggle with the calendar id when clicked", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<CalendarPicker calendars={calendars} selectedIds={["p"]} onToggle={onToggle} />);
    await user.click(screen.getByRole("checkbox", { name: /US Holidays/ }));
    expect(onToggle).toHaveBeenCalledWith("h");
  });
});
