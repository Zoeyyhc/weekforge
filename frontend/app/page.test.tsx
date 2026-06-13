import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Home from "@/app/page";

describe("Home page", () => {
  it("renders the title and the task form when idle", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: /weekforge/i })).toBeInTheDocument();
    expect(screen.getByTestId("task-form")).toBeInTheDocument();
  });
});
