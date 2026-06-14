# WeekForge Frontend (Next.js debate timeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. For the component tasks (6–8), ALSO use superpowers:frontend-design to polish visuals beyond the baseline Tailwind given here.

**Goal:** A Next.js/React app that opens the debate as a live, watchable timeline — agents stream their proposals and critiques round by round, the user steps in as arbiter when the council pauses, and the final time-blocked schedule renders with the full reasoning chain.

**Architecture:** A single-page client app. A pure `debateReducer` accumulates SSE messages into view state; a `useDebateStream` hook wires a browser `EventSource` (and the `POST /debate` + `POST .../intervene` fetches) to that reducer. Presentation is split into focused components (timeline, message bubble, intervention panel, schedule view) driven entirely by reducer state. The frontend talks to the Plan 3 FastAPI backend over its SSE contract (`debate_event` / `interrupt` / `done` / `error`).

**Tech Stack:** Next.js (App Router) + TypeScript, Tailwind CSS, Vitest + React Testing Library + jsdom. Lives in `frontend/` beside the Python backend.

---

## Backend contract (already shipped in Plan 3 — do not change the backend)

- `POST {API}/debate` body `StartDebateRequest` → `{ "thread_id": "<hex>" }`
- `GET {API}/debate/{thread_id}/stream` → `text/event-stream`. Each frame is `event: <type>\ndata: <json>\n\n` where `<type>` ∈ `debate_event | interrupt | done | error`:
  - `debate_event`: `{ "type":"debate_event", "round":int, "speaker":"DeadlineHawk|EnergyGuardian|FocusBatcher|Arbiter|Human|System", "content":str, "event_type":"proposal|critique|arbitration|human_intervention|validation_fail|system" }`
  - `interrupt`: `{ "type":"interrupt", "interrupt_reason":str, "proposals":{agent:str}, "thread_id":str }` — stream ends here, no `done` follows.
  - `done`: `{ "type":"done", "schedule": Schedule | null, "thread_id":str }` where `Schedule = { "week_start": str|null, "blocks": [{ "start":iso, "end":iso, "label":str, "task_id":str|null }] }`
  - `error`: `{ "type":"error", "message":str }`
- `POST {API}/debate/{thread_id}/intervene` body `{ "input": str }` → `{ "status":"accepted" }`. The next `GET .../stream` resumes the paused graph.
- CORS allows `http://localhost:3000` (the Next.js dev origin).

**EventSource constraints that shaped this design:** `EventSource` only does GET and cannot send a body — so starting a debate is a `fetch` POST first, then opening the stream by `thread_id`. After an `interrupt` the stream closes; we resume by `POST .../intervene` then opening a *fresh* `EventSource` on the same URL.

---

## File Structure (all under `frontend/`)

```
frontend/
├── package.json              — scripts incl. "test": "vitest run"
├── vitest.config.mts         — jsdom env, react plugin, tsconfig path alias
├── vitest.setup.ts           — jest-dom matchers
├── .env.local.example        — NEXT_PUBLIC_API_BASE_URL
├── app/
│   ├── layout.tsx            — (scaffolded) root layout
│   ├── globals.css           — (scaffolded) Tailwind directives
│   └── page.tsx              — main page: orchestrates form → timeline → intervention → schedule
├── lib/
│   ├── types.ts              — TS types mirroring the SSE contract + request shapes
│   ├── agents.ts             — agentMeta(speaker): label/emoji/colour per agent
│   ├── debateReducer.ts      — pure reducer: SSE messages → DebateState
│   ├── api.ts                — startDebate / sendIntervention / streamUrl (fetch helpers)
│   ├── useDebateStream.ts    — hook: EventSource lifecycle + fetches → reducer
│   └── format.ts             — schedule formatting: group blocks by day, time ranges
└── components/
    ├── DebateMessage.tsx      — one event bubble, styled per agent
    ├── RoundDivider.tsx       — "Round N" separator
    ├── DebateTimeline.tsx     — ordered list of messages with dividers
    ├── InterventionPanel.tsx  — interrupt UI: quick-actions + free text → submit
    ├── ScheduleView.tsx       — final schedule grouped by day
    └── TaskForm.tsx           — sample-prefilled input → start debate
```

Each `lib/*` and `components/*` file is independently testable. Co-locate tests as `<name>.test.ts(x)` next to each file.

---

## Task 1: Scaffold the Next.js app and test tooling

**Files:**
- Create: the whole `frontend/` app (via `create-next-app`)
- Create: `frontend/vitest.config.mts`, `frontend/vitest.setup.ts`, `frontend/.env.local.example`
- Modify: `frontend/package.json` (add test scripts)
- Test: `frontend/lib/smoke.test.ts`

- [ ] **Step 1: Scaffold Next.js (non-interactive)**

Run:
```bash
cd /Users/Najum/weekforge && npx create-next-app@latest frontend --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --yes
```
Expected: creates `frontend/` with `app/`, `package.json`, `tsconfig.json` (with `"@/*": ["./*"]`), Tailwind wired, a `frontend/.gitignore` ignoring `node_modules` and `.next`.

- [ ] **Step 2: Install test tooling**

Run:
```bash
cd /Users/Najum/weekforge/frontend && npm install -D vitest@^3 @vitejs/plugin-react jsdom vite-tsconfig-paths @testing-library/react@^16 @testing-library/jest-dom @testing-library/user-event
```
Expected: installs without peer-dependency errors (RTL 16 supports React 19).

- [ ] **Step 3: Create `frontend/vitest.config.mts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

- [ ] **Step 4: Create `frontend/vitest.setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Add test scripts to `frontend/package.json`**

In the `"scripts"` object, add these two entries (keep the scaffolded `dev`/`build`/`start`/`lint`):

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 6: Create `frontend/.env.local.example`**

```bash
# Copy to .env.local. Where the WeekForge FastAPI backend is running.
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

- [ ] **Step 7: Write a smoke test at `frontend/lib/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";

describe("test tooling", () => {
  it("runs and computes", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: Run the smoke test**

Run: `cd /Users/Najum/weekforge/frontend && npm test`
Expected: 1 passed.

- [ ] **Step 9: Commit**

```bash
cd /Users/Najum/weekforge && git add frontend && git commit -m "chore: scaffold Next.js frontend with Vitest + Testing Library"
```
(The `frontend/.gitignore` keeps `node_modules` and `.next` out of the commit.)

---

## Task 2: Domain types + agent metadata

**Files:**
- Create: `frontend/lib/types.ts`
- Create: `frontend/lib/agents.ts`
- Test: `frontend/lib/agents.test.ts`

- [ ] **Step 1: Write the failing test `frontend/lib/agents.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { agentMeta } from "@/lib/agents";

describe("agentMeta", () => {
  it("returns distinct metadata for each debater", () => {
    const hawk = agentMeta("DeadlineHawk");
    const guardian = agentMeta("EnergyGuardian");
    expect(hawk.label).toBe("Deadline Hawk");
    expect(guardian.label).toBe("Energy Guardian");
    expect(hawk.color).not.toBe(guardian.color);
    expect(hawk.emoji).toBeTruthy();
  });

  it("has metadata for Arbiter, Human and System speakers", () => {
    expect(agentMeta("Arbiter").label).toBe("Arbiter");
    expect(agentMeta("Human").label).toBe("You");
    expect(agentMeta("System").label).toBe("System");
  });

  it("falls back to System metadata for an unknown speaker", () => {
    // @ts-expect-error deliberately passing an unknown speaker
    expect(agentMeta("Mystery").label).toBe("System");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/Najum/weekforge/frontend && npm test -- agents`
Expected: FAIL — cannot resolve `@/lib/agents`.

- [ ] **Step 3: Create `frontend/lib/types.ts`**

```ts
// Types mirroring the WeekForge backend SSE contract and request shapes.

export type Speaker =
  | "DeadlineHawk"
  | "EnergyGuardian"
  | "FocusBatcher"
  | "Arbiter"
  | "Human"
  | "System";

export type DebateEventType =
  | "proposal"
  | "critique"
  | "arbitration"
  | "human_intervention"
  | "validation_fail"
  | "system";

export interface DebateEventMsg {
  type: "debate_event";
  round: number;
  speaker: Speaker;
  content: string;
  event_type: DebateEventType;
}

export interface InterruptMsg {
  type: "interrupt";
  interrupt_reason: string;
  proposals: Record<string, string>;
  thread_id: string;
}

export interface TimeBlock {
  start: string;
  end: string;
  label: string;
  task_id: string | null;
}

export interface Schedule {
  week_start: string | null;
  blocks: TimeBlock[];
}

export interface DoneMsg {
  type: "done";
  schedule: Schedule | null;
  thread_id: string;
}

export interface ErrorMsg {
  type: "error";
  message: string;
}

export type DebateMessage = DebateEventMsg | InterruptMsg | DoneMsg | ErrorMsg;

export interface TaskInput {
  id: string;
  title: string;
  estimated_minutes: number;
  deadline?: string | null;
  priority?: number;
  category?: string | null;
  depends_on?: string[];
}

export interface BusyBlockInput {
  start: string;
  end: string;
  label: string;
  task_id?: string | null;
}

export interface PreferencesInput {
  workday_start_hour?: number;
  workday_end_hour?: number;
  max_focus_minutes_per_day?: number;
}

export interface StartDebateRequest {
  tasks: TaskInput[];
  busy_blocks?: BusyBlockInput[];
  preferences?: PreferencesInput;
  max_rounds?: number;
}
```

- [ ] **Step 4: Create `frontend/lib/agents.ts`**

```ts
import { Speaker } from "@/lib/types";

export interface AgentMeta {
  label: string;
  emoji: string;
  color: string; // background + text Tailwind classes
  ring: string;  // border Tailwind class
  tagline: string;
}

const AGENTS: Record<Speaker, AgentMeta> = {
  DeadlineHawk: {
    label: "Deadline Hawk",
    emoji: "🦅",
    color: "bg-rose-50 text-rose-900",
    ring: "border-rose-300",
    tagline: "Hit every deadline",
  },
  EnergyGuardian: {
    label: "Energy Guardian",
    emoji: "🔋",
    color: "bg-emerald-50 text-emerald-900",
    ring: "border-emerald-300",
    tagline: "Protect against burnout",
  },
  FocusBatcher: {
    label: "Focus Batcher",
    emoji: "🎯",
    color: "bg-indigo-50 text-indigo-900",
    ring: "border-indigo-300",
    tagline: "Minimise context-switching",
  },
  Arbiter: {
    label: "Arbiter",
    emoji: "⚖️",
    color: "bg-violet-50 text-violet-900",
    ring: "border-violet-300",
    tagline: "Weigh the trade-offs",
  },
  Human: {
    label: "You",
    emoji: "🧑",
    color: "bg-slate-100 text-slate-900",
    ring: "border-slate-300",
    tagline: "Final arbiter",
  },
  System: {
    label: "System",
    emoji: "⚙️",
    color: "bg-slate-50 text-slate-600",
    ring: "border-slate-200",
    tagline: "Engine",
  },
};

export function agentMeta(speaker: Speaker): AgentMeta {
  return AGENTS[speaker] ?? AGENTS.System;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd /Users/Najum/weekforge/frontend && npm test -- agents`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/Najum/weekforge && git add frontend/lib/types.ts frontend/lib/agents.ts frontend/lib/agents.test.ts && git commit -m "feat: add frontend domain types and agent metadata"
```

---

## Task 3: The debate reducer (pure view-state logic)

**Files:**
- Create: `frontend/lib/debateReducer.ts`
- Test: `frontend/lib/debateReducer.test.ts`

- [ ] **Step 1: Write the failing test `frontend/lib/debateReducer.test.ts`**

```ts
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/Najum/weekforge/frontend && npm test -- debateReducer`
Expected: FAIL — cannot resolve `@/lib/debateReducer`.

- [ ] **Step 3: Create `frontend/lib/debateReducer.ts`**

```ts
import { DebateEventMsg, DebateMessage, InterruptMsg, Schedule } from "@/lib/types";

export type DebateStatus = "idle" | "streaming" | "interrupted" | "done" | "error";

export interface DebateState {
  status: DebateStatus;
  events: DebateEventMsg[];
  interrupt: InterruptMsg | null;
  schedule: Schedule | null;
  error: string | null;
}

export const initialDebateState: DebateState = {
  status: "idle",
  events: [],
  interrupt: null,
  schedule: null,
  error: null,
};

export type DebateAction =
  | { kind: "reset" }
  | { kind: "streaming" }
  | { kind: "message"; message: DebateMessage };

export function debateReducer(state: DebateState, action: DebateAction): DebateState {
  switch (action.kind) {
    case "reset":
      return initialDebateState;
    case "streaming":
      return { ...state, status: "streaming", error: null, interrupt: null };
    case "message": {
      const m = action.message;
      switch (m.type) {
        case "debate_event":
          return { ...state, status: "streaming", events: [...state.events, m] };
        case "interrupt":
          return { ...state, status: "interrupted", interrupt: m };
        case "done":
          return { ...state, status: "done", schedule: m.schedule, interrupt: null };
        case "error":
          return { ...state, status: "error", error: m.message };
        default:
          return state;
      }
    }
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /Users/Najum/weekforge/frontend && npm test -- debateReducer`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/Najum/weekforge && git add frontend/lib/debateReducer.ts frontend/lib/debateReducer.test.ts && git commit -m "feat: add pure debate reducer for SSE view state"
```

---

## Task 4: API client (fetch helpers)

**Files:**
- Create: `frontend/lib/api.ts`
- Test: `frontend/lib/api.test.ts`

- [ ] **Step 1: Write the failing test `frontend/lib/api.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { startDebate, sendIntervention, streamUrl } from "@/lib/api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startDebate", () => {
  it("POSTs the request and returns the thread_id", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ thread_id: "abc123" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const tid = await startDebate({ tasks: [{ id: "t1", title: "X", estimated_minutes: 30 }] }, "http://api");

    expect(tid).toBe("abc123");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api/debate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).tasks[0].id).toBe("t1");
  });

  it("throws when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(
      startDebate({ tasks: [{ id: "t1", title: "X", estimated_minutes: 30 }] }, "http://api"),
    ).rejects.toThrow(/500/);
  });
});

describe("sendIntervention", () => {
  it("POSTs the input to the intervene endpoint", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ status: "accepted" }) }));
    vi.stubGlobal("fetch", fetchMock);

    await sendIntervention("tid-1", "Prioritise the report", "http://api");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api/debate/tid-1/intervene");
    expect(JSON.parse(init.body)).toEqual({ input: "Prioritise the report" });
  });
});

describe("streamUrl", () => {
  it("builds the SSE URL for a thread", () => {
    expect(streamUrl("tid-1", "http://api")).toBe("http://api/debate/tid-1/stream");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/Najum/weekforge/frontend && npm test -- api`
Expected: FAIL — cannot resolve `@/lib/api`.

- [ ] **Step 3: Create `frontend/lib/api.ts`**

```ts
import { StartDebateRequest } from "@/lib/types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

export async function startDebate(
  request: StartDebateRequest,
  base: string = API_BASE,
): Promise<string> {
  const res = await fetch(`${base}/debate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    throw new Error(`Failed to start debate: ${res.status}`);
  }
  const data = await res.json();
  return data.thread_id as string;
}

export async function sendIntervention(
  threadId: string,
  input: string,
  base: string = API_BASE,
): Promise<void> {
  const res = await fetch(`${base}/debate/${threadId}/intervene`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) {
    throw new Error(`Failed to send intervention: ${res.status}`);
  }
}

export function streamUrl(threadId: string, base: string = API_BASE): string {
  return `${base}/debate/${threadId}/stream`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /Users/Najum/weekforge/frontend && npm test -- api`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/Najum/weekforge && git add frontend/lib/api.ts frontend/lib/api.test.ts && git commit -m "feat: add frontend API client for start/intervene/stream"
```

---

## Task 5: `useDebateStream` hook (EventSource lifecycle)

**Files:**
- Create: `frontend/lib/useDebateStream.ts`
- Test: `frontend/lib/useDebateStream.test.ts`

- [ ] **Step 1: Write the failing test `frontend/lib/useDebateStream.test.ts`**

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/Najum/weekforge/frontend && npm test -- useDebateStream`
Expected: FAIL — cannot resolve `@/lib/useDebateStream`.

- [ ] **Step 3: Create `frontend/lib/useDebateStream.ts`**

```ts
"use client";

import { useCallback, useReducer, useRef } from "react";
import {
  debateReducer,
  initialDebateState,
  DebateState,
} from "@/lib/debateReducer";
import { sendIntervention, startDebate, streamUrl } from "@/lib/api";
import { DebateMessage, StartDebateRequest } from "@/lib/types";

const EVENT_TYPES = ["debate_event", "interrupt", "done", "error"] as const;

export interface UseDebateStream {
  state: DebateState;
  start: (request: StartDebateRequest) => Promise<void>;
  intervene: (input: string) => Promise<void>;
  reset: () => void;
}

export function useDebateStream(base?: string): UseDebateStream {
  const [state, dispatch] = useReducer(debateReducer, initialDebateState);
  const sourceRef = useRef<EventSource | null>(null);
  const threadRef = useRef<string | null>(null);

  const closeStream = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const openStream = useCallback(
    (threadId: string) => {
      closeStream();
      dispatch({ kind: "streaming" });
      const es = new EventSource(streamUrl(threadId, base));
      sourceRef.current = es;
      for (const t of EVENT_TYPES) {
        es.addEventListener(t, (ev) => {
          const message = JSON.parse((ev as MessageEvent).data) as DebateMessage;
          dispatch({ kind: "message", message });
          // The stream ends after any non-debate_event frame; stop listening so
          // the browser does not auto-reconnect and re-run the graph.
          if (message.type !== "debate_event") {
            closeStream();
          }
        });
      }
      es.onerror = () => {
        closeStream();
      };
    },
    [base, closeStream],
  );

  const start = useCallback(
    async (request: StartDebateRequest) => {
      dispatch({ kind: "reset" });
      const threadId = await startDebate(request, base);
      threadRef.current = threadId;
      openStream(threadId);
    },
    [base, openStream],
  );

  const intervene = useCallback(
    async (input: string) => {
      const threadId = threadRef.current;
      if (!threadId) return;
      await sendIntervention(threadId, input, base);
      openStream(threadId);
    },
    [base, openStream],
  );

  const reset = useCallback(() => {
    closeStream();
    threadRef.current = null;
    dispatch({ kind: "reset" });
  }, [closeStream]);

  return { state, start, intervene, reset };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /Users/Najum/weekforge/frontend && npm test -- useDebateStream`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/Najum/weekforge && git add frontend/lib/useDebateStream.ts frontend/lib/useDebateStream.test.ts && git commit -m "feat: add useDebateStream hook wiring EventSource to the reducer"
```

---

## Task 6: Timeline components (message, divider, timeline)

> Apply superpowers:frontend-design here to refine spacing/typography beyond the baseline classes.

**Files:**
- Create: `frontend/components/DebateMessage.tsx`
- Create: `frontend/components/RoundDivider.tsx`
- Create: `frontend/components/DebateTimeline.tsx`
- Test: `frontend/components/DebateTimeline.test.tsx`

- [ ] **Step 1: Write the failing test `frontend/components/DebateTimeline.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DebateTimeline } from "@/components/DebateTimeline";
import { DebateMessage } from "@/components/DebateMessage";
import { DebateEventMsg } from "@/lib/types";

const mk = (round: number, content: string): DebateEventMsg => ({
  type: "debate_event",
  round,
  speaker: "EnergyGuardian",
  content,
  event_type: "proposal",
});

describe("DebateMessage", () => {
  it("renders the agent label and content", () => {
    render(<DebateMessage event={mk(1, "Protect the mornings")} />);
    expect(screen.getByText("Energy Guardian")).toBeInTheDocument();
    expect(screen.getByText("Protect the mornings")).toBeInTheDocument();
  });
});

describe("DebateTimeline", () => {
  it("renders one message per event", () => {
    render(<DebateTimeline events={[mk(1, "A"), mk(1, "B"), mk(2, "C")]} />);
    expect(screen.getAllByTestId("debate-message")).toHaveLength(3);
  });

  it("shows a round divider when the round number changes", () => {
    render(<DebateTimeline events={[mk(1, "A"), mk(2, "B")]} />);
    const dividers = screen.getAllByTestId("round-divider");
    // One for round 1 (first event) and one for round 2 (change).
    expect(dividers).toHaveLength(2);
  });

  it("renders nothing but the container when there are no events", () => {
    render(<DebateTimeline events={[]} />);
    expect(screen.getByTestId("debate-timeline")).toBeInTheDocument();
    expect(screen.queryByTestId("debate-message")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/Najum/weekforge/frontend && npm test -- DebateTimeline`
Expected: FAIL — cannot resolve the components.

- [ ] **Step 3: Create `frontend/components/DebateMessage.tsx`**

```tsx
import { DebateEventMsg } from "@/lib/types";
import { agentMeta } from "@/lib/agents";

const EVENT_LABEL: Record<string, string> = {
  proposal: "proposes",
  critique: "critiques",
  arbitration: "decides",
  human_intervention: "intervenes",
  validation_fail: "retrying",
  system: "system",
};

export function DebateMessage({ event }: { event: DebateEventMsg }) {
  const meta = agentMeta(event.speaker);
  return (
    <div
      className={`rounded-lg border p-3 ${meta.color} ${meta.ring}`}
      data-testid="debate-message"
    >
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <span aria-hidden>{meta.emoji}</span>
        <span>{meta.label}</span>
        <span className="text-xs font-normal opacity-70">
          {EVENT_LABEL[event.event_type] ?? event.event_type}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{event.content}</p>
    </div>
  );
}
```

- [ ] **Step 4: Create `frontend/components/RoundDivider.tsx`**

```tsx
export function RoundDivider({ round }: { round: number }) {
  return (
    <div className="my-4 flex items-center gap-3" data-testid="round-divider">
      <div className="h-px flex-1 bg-slate-200" />
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
        Round {round}
      </span>
      <div className="h-px flex-1 bg-slate-200" />
    </div>
  );
}
```

- [ ] **Step 5: Create `frontend/components/DebateTimeline.tsx`**

```tsx
import { DebateEventMsg } from "@/lib/types";
import { DebateMessage } from "@/components/DebateMessage";
import { RoundDivider } from "@/components/RoundDivider";

export function DebateTimeline({ events }: { events: DebateEventMsg[] }) {
  let lastRound = 0;
  return (
    <div className="flex flex-col gap-2" data-testid="debate-timeline">
      {events.map((event, i) => {
        const showDivider = event.round !== lastRound;
        lastRound = event.round;
        return (
          <div key={i}>
            {showDivider && <RoundDivider round={event.round} />}
            <DebateMessage event={event} />
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd /Users/Najum/weekforge/frontend && npm test -- DebateTimeline`
Expected: 4 passed (1 DebateMessage + 3 DebateTimeline).

- [ ] **Step 7: Commit**

```bash
cd /Users/Najum/weekforge && git add frontend/components/DebateMessage.tsx frontend/components/RoundDivider.tsx frontend/components/DebateTimeline.tsx frontend/components/DebateTimeline.test.tsx && git commit -m "feat: add debate timeline, message bubble and round divider components"
```

---

## Task 7: Schedule formatting + intervention panel + schedule view

> Apply superpowers:frontend-design here for visual polish.

**Files:**
- Create: `frontend/lib/format.ts`
- Create: `frontend/components/InterventionPanel.tsx`
- Create: `frontend/components/ScheduleView.tsx`
- Test: `frontend/lib/format.test.ts`, `frontend/components/InterventionPanel.test.tsx`, `frontend/components/ScheduleView.test.tsx`

- [ ] **Step 1: Write the failing test `frontend/lib/format.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { formatTimeRange, dayKey, groupBlocksByDay } from "@/lib/format";
import { TimeBlock } from "@/lib/types";

const block = (start: string, end: string, label: string): TimeBlock => ({
  start,
  end,
  label,
  task_id: null,
});

describe("formatTimeRange", () => {
  it("formats a UTC time range deterministically", () => {
    const out = formatTimeRange("2026-06-15T09:00:00+00:00", "2026-06-15T10:30:00+00:00");
    expect(out).toBe("09:00 AM – 10:30 AM");
  });
});

describe("dayKey", () => {
  it("derives a stable UTC day label", () => {
    expect(dayKey("2026-06-15T09:00:00+00:00")).toBe("Monday, Jun 15");
  });
});

describe("groupBlocksByDay", () => {
  it("groups blocks by day, sorted by start, preserving day order", () => {
    const groups = groupBlocksByDay([
      block("2026-06-16T09:00:00+00:00", "2026-06-16T10:00:00+00:00", "Tue task"),
      block("2026-06-15T14:00:00+00:00", "2026-06-15T15:00:00+00:00", "Mon afternoon"),
      block("2026-06-15T09:00:00+00:00", "2026-06-15T10:00:00+00:00", "Mon morning"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].blocks.map((b) => b.label)).toEqual(["Mon morning", "Mon afternoon"]);
    expect(groups[1].blocks.map((b) => b.label)).toEqual(["Tue task"]);
  });

  it("returns an empty array for no blocks", () => {
    expect(groupBlocksByDay([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/Najum/weekforge/frontend && npm test -- format`
Expected: FAIL — cannot resolve `@/lib/format`.

- [ ] **Step 3: Create `frontend/lib/format.ts`**

```ts
import { TimeBlock } from "@/lib/types";

// Pinned to UTC + en-US so output is deterministic across machines.
const TIME_OPTS: Intl.DateTimeFormatOptions = {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
};
const DAY_OPTS: Intl.DateTimeFormatOptions = {
  timeZone: "UTC",
  weekday: "long",
  month: "short",
  day: "numeric",
};

export function formatTimeRange(startIso: string, endIso: string): string {
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString("en-US", TIME_OPTS);
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}

export function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", DAY_OPTS);
}

export interface DayGroup {
  day: string;
  blocks: TimeBlock[];
}

export function groupBlocksByDay(blocks: TimeBlock[]): DayGroup[] {
  const order: string[] = [];
  const map = new Map<string, TimeBlock[]>();
  const sorted = [...blocks].sort((a, b) => a.start.localeCompare(b.start));
  for (const b of sorted) {
    const key = dayKey(b.start);
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(b);
  }
  return order.map((day) => ({ day, blocks: map.get(day)! }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /Users/Najum/weekforge/frontend && npm test -- format`
Expected: 4 passed.

- [ ] **Step 5: Write the failing test `frontend/components/InterventionPanel.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InterventionPanel } from "@/components/InterventionPanel";
import { InterruptMsg } from "@/lib/types";

const interrupt: InterruptMsg = {
  type: "interrupt",
  interrupt_reason: "The council could not reach consensus.",
  proposals: { DeadlineHawk: "pack it" },
  thread_id: "t1",
};

describe("InterventionPanel", () => {
  it("shows the interrupt reason", () => {
    render(<InterventionPanel interrupt={interrupt} onSubmit={() => {}} />);
    expect(screen.getByText(/could not reach consensus/i)).toBeInTheDocument();
  });

  it("submit is disabled until there is text", async () => {
    render(<InterventionPanel interrupt={interrupt} onSubmit={() => {}} />);
    const button = screen.getByRole("button", { name: /submit/i });
    expect(button).toBeDisabled();
  });

  it("a quick-action fills the box and enables submit, then calls onSubmit with the text", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<InterventionPanel interrupt={interrupt} onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: /side with energy guardian/i }));
    const submit = screen.getByRole("button", { name: /submit/i });
    expect(submit).toBeEnabled();

    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatch(/Energy Guardian/i);
  });
});
```

- [ ] **Step 6: Create `frontend/components/InterventionPanel.tsx`**

```tsx
"use client";

import { useState } from "react";
import { InterruptMsg } from "@/lib/types";

const QUICK_ACTIONS = [
  {
    label: "Side with Deadline Hawk",
    text: "I side with the Deadline Hawk — prioritise hitting deadlines, even if the days are packed.",
  },
  {
    label: "Side with Energy Guardian",
    text: "I side with the Energy Guardian — protect breaks and avoid back-to-back intense work.",
  },
  {
    label: "Side with Focus Batcher",
    text: "I side with the Focus Batcher — group similar tasks and protect long focus blocks.",
  },
];

export function InterventionPanel({
  interrupt,
  onSubmit,
  disabled,
}: {
  interrupt: InterruptMsg;
  onSubmit: (input: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");

  return (
    <div
      className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4"
      data-testid="intervention-panel"
    >
      <h3 className="font-semibold text-amber-900">The council needs you</h3>
      <p className="mt-1 text-sm text-amber-800">{interrupt.interrupt_reason}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => setText(a.text)}
            className="rounded-full border border-amber-400 bg-white px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            {a.label}
          </button>
        ))}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a constraint, side with an agent, or veto…"
        rows={3}
        className="mt-3 w-full rounded-lg border border-amber-300 p-2 text-sm"
      />

      <button
        type="button"
        disabled={disabled || text.trim() === ""}
        onClick={() => onSubmit(text.trim())}
        className="mt-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
      >
        Submit &amp; resume debate
      </button>
    </div>
  );
}
```

- [ ] **Step 7: Write the failing test `frontend/components/ScheduleView.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScheduleView } from "@/components/ScheduleView";
import { Schedule } from "@/lib/types";

describe("ScheduleView", () => {
  it("renders each block's label and time range, grouped by day", () => {
    const schedule: Schedule = {
      week_start: null,
      blocks: [
        { start: "2026-06-15T09:00:00+00:00", end: "2026-06-15T11:00:00+00:00", label: "Write report", task_id: "t1" },
        { start: "2026-06-16T13:00:00+00:00", end: "2026-06-16T14:00:00+00:00", label: "Review PRs", task_id: "t2" },
      ],
    };
    render(<ScheduleView schedule={schedule} />);
    expect(screen.getByText("Write report")).toBeInTheDocument();
    expect(screen.getByText("Review PRs")).toBeInTheDocument();
    expect(screen.getByText("Monday, Jun 15")).toBeInTheDocument();
    expect(screen.getByText("Tuesday, Jun 16")).toBeInTheDocument();
    expect(screen.getByText("09:00 AM – 11:00 AM")).toBeInTheDocument();
  });

  it("shows an empty-state message when there are no blocks", () => {
    render(<ScheduleView schedule={{ week_start: null, blocks: [] }} />);
    expect(screen.getByTestId("schedule-empty")).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Create `frontend/components/ScheduleView.tsx`**

```tsx
import { Schedule } from "@/lib/types";
import { groupBlocksByDay, formatTimeRange } from "@/lib/format";

export function ScheduleView({ schedule }: { schedule: Schedule }) {
  const groups = groupBlocksByDay(schedule.blocks);

  if (groups.length === 0) {
    return (
      <p className="text-sm text-slate-500" data-testid="schedule-empty">
        The council produced an empty schedule.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="schedule-view">
      {groups.map((g) => (
        <div key={g.day}>
          <h4 className="mb-2 text-sm font-semibold text-slate-700">{g.day}</h4>
          <ul className="flex flex-col gap-1">
            {g.blocks.map((b, i) => (
              <li
                key={i}
                className="flex items-baseline justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <span className="font-medium text-slate-900">{b.label}</span>
                <span className="text-slate-500">{formatTimeRange(b.start, b.end)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 9: Run all of this task's tests**

Run: `cd /Users/Najum/weekforge/frontend && npm test -- format InterventionPanel ScheduleView`
Expected: format 4 + InterventionPanel 3 + ScheduleView 2 = 9 passed.

- [ ] **Step 10: Commit**

```bash
cd /Users/Najum/weekforge && git add frontend/lib/format.ts frontend/lib/format.test.ts frontend/components/InterventionPanel.tsx frontend/components/InterventionPanel.test.tsx frontend/components/ScheduleView.tsx frontend/components/ScheduleView.test.tsx && git commit -m "feat: add schedule formatting, intervention panel and schedule view"
```

---

## Task 8: Task form + main page wiring + manual smoke

> Apply superpowers:frontend-design here for the overall page composition.

**Files:**
- Create: `frontend/components/TaskForm.tsx`
- Modify: `frontend/app/page.tsx` (replace the scaffolded content)
- Test: `frontend/components/TaskForm.test.tsx`, `frontend/app/page.test.tsx`

- [ ] **Step 1: Write the failing test `frontend/components/TaskForm.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskForm } from "@/components/TaskForm";

describe("TaskForm", () => {
  it("starts with the sample request and submits it parsed", async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<TaskForm onStart={onStart} />);

    await user.click(screen.getByRole("button", { name: /convene the council/i }));

    expect(onStart).toHaveBeenCalledTimes(1);
    const req = onStart.mock.calls[0][0];
    expect(Array.isArray(req.tasks)).toBe(true);
    expect(req.tasks.length).toBeGreaterThan(0);
  });

  it("shows an error and does not submit when the JSON is invalid", async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<TaskForm onStart={onStart} />);

    const textarea = screen.getByTestId("task-form-input");
    await user.clear(textarea);
    await user.type(textarea, "{ not json ");
    await user.click(screen.getByRole("button", { name: /convene the council/i }));

    expect(screen.getByTestId("form-error")).toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/Najum/weekforge/frontend && npm test -- TaskForm`
Expected: FAIL — cannot resolve `@/components/TaskForm`.

- [ ] **Step 3: Create `frontend/components/TaskForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import { StartDebateRequest } from "@/lib/types";

const SAMPLE: StartDebateRequest = {
  tasks: [
    {
      id: "t1",
      title: "Write Q3 report",
      estimated_minutes: 180,
      priority: 1,
      deadline: "2026-06-17T17:00:00+00:00",
      category: "writing",
    },
    { id: "t2", title: "Review 5 pull requests", estimated_minutes: 90, priority: 2, category: "code" },
    { id: "t3", title: "Prep demo slides", estimated_minutes: 120, priority: 2, category: "writing" },
    { id: "t4", title: "1:1s with the team", estimated_minutes: 60, priority: 3, category: "meetings" },
    { id: "t5", title: "Inbox zero", estimated_minutes: 45, priority: 4, category: "admin" },
  ],
  busy_blocks: [
    { start: "2026-06-15T10:00:00+00:00", end: "2026-06-15T11:00:00+00:00", label: "Standup" },
    { start: "2026-06-16T14:00:00+00:00", end: "2026-06-16T15:30:00+00:00", label: "Client call" },
  ],
  preferences: { workday_start_hour: 9, workday_end_hour: 18, max_focus_minutes_per_day: 360 },
  max_rounds: 3,
};

export function TaskForm({
  onStart,
  disabled,
}: {
  onStart: (req: StartDebateRequest) => void;
  disabled?: boolean;
}) {
  const [json, setJson] = useState(JSON.stringify(SAMPLE, null, 2));
  const [error, setError] = useState<string | null>(null);

  function handleStart() {
    let parsed: StartDebateRequest;
    try {
      parsed = JSON.parse(json) as StartDebateRequest;
    } catch {
      setError("That isn't valid JSON.");
      return;
    }
    if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
      setError("Provide at least one task.");
      return;
    }
    setError(null);
    onStart(parsed);
  }

  return (
    <div className="flex flex-col gap-3" data-testid="task-form">
      <label className="text-sm font-medium text-slate-700">
        Your week — tasks, fixed commitments, and preferences
      </label>
      <textarea
        data-testid="task-form-input"
        value={json}
        onChange={(e) => setJson(e.target.value)}
        spellCheck={false}
        className="h-64 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs"
      />
      {error && (
        <p className="text-sm text-rose-600" data-testid="form-error">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={handleStart}
        disabled={disabled}
        className="self-start rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
      >
        Convene the council
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Write the failing test `frontend/app/page.test.tsx`**

```tsx
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
```

- [ ] **Step 5: Replace `frontend/app/page.tsx` with:**

```tsx
"use client";

import { useDebateStream } from "@/lib/useDebateStream";
import { TaskForm } from "@/components/TaskForm";
import { DebateTimeline } from "@/components/DebateTimeline";
import { InterventionPanel } from "@/components/InterventionPanel";
import { ScheduleView } from "@/components/ScheduleView";
import { DebateStatus } from "@/lib/debateReducer";

const STATUS_STYLE: Record<DebateStatus, string> = {
  idle: "bg-slate-100 text-slate-700",
  streaming: "bg-blue-100 text-blue-800",
  interrupted: "bg-amber-100 text-amber-800",
  done: "bg-emerald-100 text-emerald-800",
  error: "bg-rose-100 text-rose-800",
};

const STATUS_LABEL: Record<DebateStatus, string> = {
  idle: "Ready",
  streaming: "Debating…",
  interrupted: "Awaiting your call",
  done: "Decided",
  error: "Error",
};

function StatusBadge({ status }: { status: DebateStatus }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function Home() {
  const { state, start, intervene, reset } = useDebateStream();
  const showForm = state.status === "idle";

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">WeekForge</h1>
        <p className="mt-1 text-slate-500">
          Watch a council of conflicting-objective agents debate your week — and step in as the
          final arbiter.
        </p>
      </header>

      {showForm && <TaskForm onStart={start} />}

      {!showForm && (
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <StatusBadge status={state.status} />
            <button onClick={reset} className="text-sm text-slate-500 underline">
              Start over
            </button>
          </div>

          {state.error && (
            <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{state.error}</p>
          )}

          {state.interrupt && state.status === "interrupted" && (
            <InterventionPanel interrupt={state.interrupt} onSubmit={intervene} />
          )}

          {state.schedule && state.status === "done" && (
            <section>
              <h2 className="mb-3 text-xl font-semibold text-slate-900">The forged week</h2>
              <ScheduleView schedule={state.schedule} />
            </section>
          )}

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">The debate</h2>
            <DebateTimeline events={state.events} />
          </section>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Run this task's tests**

Run: `cd /Users/Najum/weekforge/frontend && npm test -- TaskForm page`
Expected: TaskForm 2 + page 1 = 3 passed.

- [ ] **Step 7: Run the entire frontend suite**

Run: `cd /Users/Najum/weekforge/frontend && npm test`
Expected: all passing — smoke 1 + agents 3 + debateReducer 6 + api 4 + useDebateStream 3 + DebateTimeline 4 + format 4 + InterventionPanel 3 + ScheduleView 2 + TaskForm 2 + page 1 = **33 passed**.

- [ ] **Step 8: Manual smoke test against the live backend (recommended)**

This needs the Plan 3 backend running with a real `ANTHROPIC_API_KEY`.

Terminal 1 — backend:
```bash
cd /Users/Najum/weekforge && ANTHROPIC_API_KEY=sk-... uv run weekforge-api
```
Terminal 2 — frontend:
```bash
cd /Users/Najum/weekforge/frontend && cp .env.local.example .env.local && npm run dev
```
Open `http://localhost:3000`:
- The task form shows the sample week. Click **Convene the council**.
- Proposals and critiques stream into the timeline, grouped by round.
- If the council stalls, the amber **intervention panel** appears — click a quick-action or type guidance, then **Submit & resume debate**; the timeline continues.
- On convergence, **The forged week** schedule renders, grouped by day, with the debate transcript (the reasoning chain) below it.

- [ ] **Step 9: Commit**

```bash
cd /Users/Najum/weekforge && git add frontend/components/TaskForm.tsx frontend/components/TaskForm.test.tsx frontend/app/page.tsx frontend/app/page.test.tsx && git commit -m "feat: add task form and wire the main debate page"
```

---

## Done criteria

- `cd frontend && npm test` → 33 passed, 0 failed.
- `npm run dev` serves the app at `http://localhost:3000`; against a running backend the full loop works: convene → watch the round-by-round debate → intervene on a stall → resume → see the forged schedule.
- Each agent has a distinct colour/emoji in the timeline (spec §7 avatar/colour requirement).
- The intervention UI offers side-with-an-agent quick actions plus free-text constraint/veto (spec §7 participatory HITL).
- The final schedule renders grouped by day, with the debate transcript persisting below it as the visible reasoning chain (spec §7 output view).
- Pure logic (reducer, api, format, agents) and the EventSource hook are unit-tested; components are render/interaction-tested with Testing Library.

## Spec coverage note

The design spec §7 lists an "expandable reasoning chain (and the trade-offs the Arbiter rejected)". The backend emits the Arbiter's synthesis as a single `arbitration` debate_event whose content is the schedule JSON plus rationale; the visible reasoning chain is therefore the persisted timeline (including that arbitration message), shown beneath the schedule. A separately parsed "rejected trade-offs" panel is intentionally out of scope for v1 — the backend does not emit structured rejected-alternative data, and inventing it would be fabrication. If desired later, it is a backend change (have the Arbiter emit structured rationale) plus a small frontend panel.
