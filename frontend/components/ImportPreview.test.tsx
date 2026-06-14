import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportPreview } from "@/components/ImportPreview";
import { TimeBlock } from "@/lib/types";

const blocks: TimeBlock[] = [
  { start: "2026-06-15T09:00:00+00:00", end: "2026-06-15T10:00:00+00:00", label: "Standup", task_id: null },
  { start: "2026-06-16T13:00:00+00:00", end: "2026-06-16T14:00:00+00:00", label: "Client call", task_id: null },
];

describe("ImportPreview", () => {
  it("lists each imported block's label", () => {
    render(<ImportPreview blocks={blocks} onRemove={() => {}} />);
    expect(screen.getByText("Standup")).toBeInTheDocument();
    expect(screen.getByText("Client call")).toBeInTheDocument();
  });

  it("calls onRemove with the index when a remove button is clicked", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<ImportPreview blocks={blocks} onRemove={onRemove} />);
    const removes = screen.getAllByRole("button", { name: /remove/i });
    await user.click(removes[1]);
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it("shows an empty hint when there are no blocks", () => {
    render(<ImportPreview blocks={[]} onRemove={() => {}} />);
    expect(screen.getByTestId("import-preview-empty")).toBeInTheDocument();
  });
});
