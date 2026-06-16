import { describe, it, expect } from "vitest";
import { debateReducer, initialDebateState } from "@/lib/debateReducer";
import { DebateEventMsg, DoneMsg, ErrorMsg, InterruptMsg } from "@/lib/types";

const evt = (round: number): DebateEventMsg => ({
  type: "debate_event",
  round,
  speaker: "DeadlineHawk",
  content: "Pack it",
  event_type: "proposal",
});

describe("debateReducer", () => {
  it("reset returns the initial state", () => {
    const dirty = { ...initialDebateState, status: "done" as const };
    expect(debateReducer(dirty, { kind: "reset" })).toEqual(initialDebateState);
  });

  it("streaming clears interrupt and error but keeps events", () => {
    const start = { ...initialDebateState, events: [evt(1)], error: "x", status: "error" as const };
    const next = debateReducer(start, { kind: "streaming" });
    expect(next.status).toBe("streaming");
    expect(next.error).toBeNull();
    expect(next.interrupt).toBeNull();
    expect(next.events).toHaveLength(1);
  });

  it("appends debate_event messages in order", () => {
    let s = debateReducer(initialDebateState, { kind: "message", message: evt(1) });
    s = debateReducer(s, { kind: "message", message: evt(1) });
    expect(s.events).toHaveLength(2);
    expect(s.status).toBe("streaming");
  });

  it("interrupt message sets interrupted status and stores the interrupt", () => {
    const msg: InterruptMsg = {
      type: "interrupt",
      interrupt_reason: "Stalled",
      proposals: { DeadlineHawk: "..." },
      thread_id: "t1",
    };
    const s = debateReducer(initialDebateState, { kind: "message", message: msg });
    expect(s.status).toBe("interrupted");
    expect(s.interrupt).toEqual(msg);
  });

  it("done message sets schedule and clears interrupt", () => {
    const withInterrupt = {
      ...initialDebateState,
      interrupt: { type: "interrupt", interrupt_reason: "x", proposals: {}, thread_id: "t" } as InterruptMsg,
    };
    const msg: DoneMsg = {
      type: "done",
      schedule: { week_start: null, blocks: [{ start: "a", end: "b", label: "L", task_id: null }] },
      thread_id: "t1",
    };
    const s = debateReducer(withInterrupt, { kind: "message", message: msg });
    expect(s.status).toBe("done");
    expect(s.schedule?.blocks).toHaveLength(1);
    expect(s.interrupt).toBeNull();
  });

  it("error message sets error status and message", () => {
    const msg: ErrorMsg = { type: "error", message: "boom" };
    const s = debateReducer(initialDebateState, { kind: "message", message: msg });
    expect(s.status).toBe("error");
    expect(s.error).toBe("boom");
  });

  it("done message writes degraded and validationWarnings when present", () => {
    const msg: DoneMsg = {
      type: "done",
      schedule: { week_start: null, blocks: [] },
      thread_id: "t1",
      degraded: true,
      validation_warnings: "Schedule failed semantic validation:\n  - block overlaps busy",
    };
    const s = debateReducer(initialDebateState, { kind: "message", message: msg });
    expect(s.degraded).toBe(true);
    expect(s.validationWarnings).toBe(
      "Schedule failed semantic validation:\n  - block overlaps busy",
    );
  });

  it("done message falls back to false/null when degraded fields are absent", () => {
    const msg: DoneMsg = {
      type: "done",
      schedule: { week_start: null, blocks: [] },
      thread_id: "t1",
    };
    const s = debateReducer(initialDebateState, { kind: "message", message: msg });
    expect(s.degraded).toBe(false);
    expect(s.validationWarnings).toBeNull();
  });

  it("reset clears degraded state back to initial", () => {
    const dirty = {
      ...initialDebateState,
      degraded: true,
      validationWarnings: "boom",
    };
    expect(debateReducer(dirty, { kind: "reset" })).toEqual(initialDebateState);
  });
});
