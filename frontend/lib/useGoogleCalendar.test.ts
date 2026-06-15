import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useGoogleCalendar } from "@/lib/useGoogleCalendar";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/google/status")) return { ok: true, json: async () => ({ connected: true }) };
      if (url.endsWith("/auth/google/disconnect") && init?.method === "POST")
        return { ok: true, json: async () => ({}) };
      if (url.includes("/calendar/google/calendars")) return {
        ok: true,
        json: async () => ({ calendars: [{ id: "p", summary: "me", primary: true, selected_by_default: true }] }),
      };
      if (url.includes("/calendar/google/busy")) return {
        ok: true,
        json: async () => ({ busy_blocks: [{ start: "s", end: "e", label: "Standup", task_id: null }] }),
      };
      return { ok: true, json: async () => ({}) };
    }),
  );
});

afterEach(() => vi.restoreAllMocks());

describe("useGoogleCalendar", () => {
  it("statusKnown is false initially, true after status resolves", async () => {
    const { result } = renderHook(() => useGoogleCalendar("http://api"));
    expect(result.current.statusKnown).toBe(false);
    await waitFor(() => expect(result.current.statusKnown).toBe(true));
  });

  it("loads connection status on mount", async () => {
    const { result } = renderHook(() => useGoogleCalendar("http://api"));
    await waitFor(() => expect(result.current.connected).toBe(true));
  });

  it("loads calendars and tracks selection", async () => {
    const { result } = renderHook(() => useGoogleCalendar("http://api"));
    await act(async () => { await result.current.loadCalendars(); });
    expect(result.current.calendars).toHaveLength(1);
    expect(result.current.selectedIds).toEqual(["p"]);
    act(() => result.current.toggleCalendar("p"));
    expect(result.current.selectedIds).toEqual([]);
  });

  it("imports busy blocks for the selected calendars", async () => {
    const { result } = renderHook(() => useGoogleCalendar("http://api"));
    await act(async () => { await result.current.loadCalendars(); });
    let blocks: import("@/lib/types").TimeBlock[] | undefined;
    await act(async () => { blocks = await result.current.importWeek("2026-06-15"); });
    expect(blocks).toHaveLength(1);
    expect(blocks![0].label).toBe("Standup");
  });

  it("disconnect POSTs and sets connected to false", async () => {
    const { result } = renderHook(() => useGoogleCalendar("http://api"));
    await waitFor(() => expect(result.current.connected).toBe(true));
    await act(async () => { await result.current.disconnect(); });
    expect(result.current.connected).toBe(false);
  });
});
