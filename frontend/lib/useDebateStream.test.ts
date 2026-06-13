import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebateStream } from "@/lib/useDebateStream";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  readyState = 0;
  onerror: ((ev: unknown) => void) | null = null;
  private listeners: Record<string, ((ev: { data: string }) => void)[]> = {};

  constructor(url: string) {
    this.url = url;
    this.readyState = 1;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: { data: string }) => void) {
    (this.listeners[type] ||= []).push(cb);
  }
  emit(type: string, data: unknown) {
    (this.listeners[type] || []).forEach((cb) => cb({ data: JSON.stringify(data) }));
  }
  close() {
    this.readyState = 2;
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ thread_id: "tid-1" }) })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDebateStream", () => {
  it("starts a debate and routes debate_event messages into state", async () => {
    const { result } = renderHook(() => useDebateStream("http://api"));

    await act(async () => {
      await result.current.start({ tasks: [{ id: "t1", title: "X", estimated_minutes: 30 }] });
    });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("http://api/debate/tid-1/stream");

    act(() => {
      MockEventSource.instances[0].emit("debate_event", {
        type: "debate_event",
        round: 1,
        speaker: "DeadlineHawk",
        content: "Pack it",
        event_type: "proposal",
      });
    });

    expect(result.current.state.events).toHaveLength(1);
    expect(result.current.state.status).toBe("streaming");
  });

  it("transitions to done and closes the stream", async () => {
    const { result } = renderHook(() => useDebateStream("http://api"));
    await act(async () => {
      await result.current.start({ tasks: [{ id: "t1", title: "X", estimated_minutes: 30 }] });
    });

    const es = MockEventSource.instances[0];
    act(() => {
      es.emit("done", {
        type: "done",
        schedule: { week_start: null, blocks: [] },
        thread_id: "tid-1",
      });
    });

    expect(result.current.state.status).toBe("done");
    expect(result.current.state.schedule).not.toBeNull();
    expect(es.readyState).toBe(2); // closed
  });

  it("intervene posts then opens a fresh stream to resume", async () => {
    const { result } = renderHook(() => useDebateStream("http://api"));
    await act(async () => {
      await result.current.start({ tasks: [{ id: "t1", title: "X", estimated_minutes: 30 }] });
    });

    act(() => {
      MockEventSource.instances[0].emit("interrupt", {
        type: "interrupt",
        interrupt_reason: "Stalled",
        proposals: {},
        thread_id: "tid-1",
      });
    });
    expect(result.current.state.status).toBe("interrupted");

    await act(async () => {
      await result.current.intervene("Prioritise the report");
    });

    // A second EventSource was opened to resume.
    expect(MockEventSource.instances).toHaveLength(2);
    expect(result.current.state.status).toBe("streaming");
  });
});
