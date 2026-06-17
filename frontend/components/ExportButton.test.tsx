import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { ExportButton } from "@/components/ExportButton";

afterEach(() => vi.restoreAllMocks());

describe("ExportButton", () => {
  it("downloads the returned .ics blob", async () => {
    const blob = new Blob(["BEGIN:VCALENDAR"], { type: "text/calendar" });
    const onExport = vi.fn().mockResolvedValue(blob);
    const createUrl = vi.fn().mockReturnValue("blob:fake");
    const revokeUrl = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<ExportButton onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: /download \.ics/i }));

    await waitFor(() => expect(onExport).toHaveBeenCalled());
    expect(createUrl).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalled();
  });
});
