import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFreshActivity } from "@/lib/useFreshActivity";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useFreshActivity", () => {
  it("is false before any activity", () => {
    const { result } = renderHook(({ n }) => useFreshActivity(n, 3000), {
      initialProps: { n: 0 },
    });
    expect(result.current).toBe(false);
  });

  it("becomes true when the count increases, then fades after the window", () => {
    const { result, rerender } = renderHook(({ n }) => useFreshActivity(n, 3000), {
      initialProps: { n: 0 },
    });

    rerender({ n: 1 });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(3001);
    });
    expect(result.current).toBe(false);
  });

  it("re-arms freshness on each new event", () => {
    const { result, rerender } = renderHook(({ n }) => useFreshActivity(n, 3000), {
      initialProps: { n: 1 },
    });
    expect(result.current).toBe(true);

    act(() => vi.advanceTimersByTime(2000));
    rerender({ n: 2 });
    expect(result.current).toBe(true);

    // 2s after the second event — still within the window
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(true);

    // now let it lapse
    act(() => vi.advanceTimersByTime(1001));
    expect(result.current).toBe(false);
  });
});
