import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportButton } from "@/components/ExportButton";

describe("ExportButton", () => {
  it("calls onExport when clicked and shows the written count", async () => {
    const onExport = vi.fn(async () => ({ written: 3, calendar_url: "http://cal" }));
    const user = userEvent.setup();
    render(<ExportButton onExport={onExport} />);

    await user.click(screen.getByRole("button", { name: /add to google calendar/i }));

    expect(onExport).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("export-result")).toHaveTextContent(/3/);
    expect(screen.getByRole("link", { name: /open google calendar/i })).toHaveAttribute("href", "http://cal");
  });

  it("shows the pre-click safety note about existing events never changing", () => {
    const onExport = vi.fn(async () => ({ written: 0, calendar_url: "http://cal" }));
    render(<ExportButton onExport={onExport} />);

    expect(screen.getByText(/your existing events are never changed/i)).toBeInTheDocument();
  });

  it("shows the reassuring refresh wording on success, with the calendar link", async () => {
    const onExport = vi.fn(async () => ({ written: 5, calendar_url: "http://cal" }));
    const user = userEvent.setup();
    render(<ExportButton onExport={onExport} />);

    await user.click(screen.getByRole("button", { name: /add to google calendar/i }));

    const result = await screen.findByTestId("export-result");
    expect(result).toHaveTextContent(/wrote 5 events/i);
    expect(result).toHaveTextContent(/left everything else untouched/i);
    expect(screen.getByRole("link", { name: /open google calendar/i })).toHaveAttribute(
      "href",
      "http://cal",
    );
  });

  it("shows an error message when export fails", async () => {
    const onExport = vi.fn(async () => { throw new Error("auth expired"); });
    const user = userEvent.setup();
    render(<ExportButton onExport={onExport} />);

    await user.click(screen.getByRole("button", { name: /add to google calendar/i }));

    expect(await screen.findByTestId("export-error")).toHaveTextContent(/auth expired/i);
  });
});
