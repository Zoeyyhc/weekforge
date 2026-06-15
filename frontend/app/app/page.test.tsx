import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Home from "./page";

function mockFetch(connected: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/auth/google/status"))
        return { ok: true, json: async () => ({ connected }) };
      return { ok: true, json: async () => ({}) };
    }),
  );
}

beforeEach(() => {
  mockFetch(false);
});

describe("Home page — login gate", () => {
  it("shows the login screen when not connected", async () => {
    render(<Home />);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /sign in with google/i })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("task-form")).not.toBeInTheDocument();
  });

  it("shows the task form when connected", async () => {
    mockFetch(true);
    render(<Home />);
    await waitFor(() => expect(screen.getByTestId("task-form")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /sign in with google/i })).not.toBeInTheDocument();
  });

  it("renders nothing while status is loading", () => {
    // fetch never resolves — statusKnown stays false
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<Home />);
    expect(screen.queryByTestId("task-form")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign in with google/i })).not.toBeInTheDocument();
  });
});
