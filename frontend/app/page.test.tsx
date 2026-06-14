import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Home from "@/app/page";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ connected: false }) })));
});

describe("Home page", () => {
  it("renders the wordmark and the task form when idle", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: /weekforge/i })).toBeInTheDocument();
    expect(screen.getByTestId("task-form")).toBeInTheDocument();
  });
});
