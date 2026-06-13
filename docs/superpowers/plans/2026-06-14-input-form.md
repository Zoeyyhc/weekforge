# Structured Input Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw-JSON textarea in `frontend/components/TaskForm.tsx` with a structured single-page form (tasks, busy blocks, preferences), keeping the same `onStart(req: StartDebateRequest)` contract.

**Architecture:** A pure `buildRequest` helper transforms local draft state into the API request (id generation, datetime→ISO, fixed defaults). Two presentational row components (`TaskRow`, `BusyBlockRow`) render individual rows. `TaskForm` is the container: owns draft state, add/remove handlers, validation, and the Preferences panel inline. `page.tsx` and `useDebateStream` are untouched.

**Tech Stack:** Next.js (App Router, client components), TypeScript, Tailwind, Vitest + React Testing Library + `@testing-library/user-event`.

**Spec:** `docs/superpowers/specs/2026-06-14-input-form-design.md`

**Conventions (match existing code):**
- All commands run from the `frontend/` directory.
- `@/` path alias maps to `frontend/`.
- Interactive components start with `"use client";`.
- Tailwind palette: `slate-*` for neutral, `bg-slate-900` primary button, `text-rose-600` errors.
- Tests use `data-testid` plus `getByRole` where natural.

---

## File Structure

- Create: `frontend/lib/buildRequest.ts` — draft types + pure `buildRequest()`.
- Create: `frontend/lib/buildRequest.test.ts` — unit tests for the transform.
- Create: `frontend/components/TaskRow.tsx` — presentational single task row.
- Create: `frontend/components/TaskRow.test.tsx` — row tests.
- Create: `frontend/components/BusyBlockRow.tsx` — presentational single busy-block row.
- Create: `frontend/components/BusyBlockRow.test.tsx` — row tests.
- Modify (full rewrite): `frontend/components/TaskForm.tsx` — container.
- Modify (full rewrite): `frontend/components/TaskForm.test.tsx` — container tests.

The `onStart` prop signature is unchanged, so `frontend/app/page.tsx` and all other components/tests are untouched.

---

### Task 1: buildRequest helper + draft types

**Files:**
- Create: `frontend/lib/buildRequest.ts`
- Test: `frontend/lib/buildRequest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/lib/buildRequest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildRequest, TaskDraft, BusyBlockDraft, PrefsDraft } from "@/lib/buildRequest";

const tasks: TaskDraft[] = [
  { title: "Write Q3 report", estimatedMinutes: "180", priority: 1 },
  { title: "Review PRs", estimatedMinutes: "90", priority: 2 },
];
const blocks: BusyBlockDraft[] = [
  { label: "Standup", start: "2026-06-15T10:00", end: "2026-06-15T11:00" },
];
const prefs: PrefsDraft = {
  workdayStartHour: "9",
  workdayEndHour: "18",
  maxFocusMinutes: "360",
};

describe("buildRequest", () => {
  it("generates sequential string ids and numeric fields for tasks", () => {
    const req = buildRequest(tasks, blocks, prefs);
    expect(req.tasks).toEqual([
      { id: "t1", title: "Write Q3 report", estimated_minutes: 180, priority: 1 },
      { id: "t2", title: "Review PRs", estimated_minutes: 90, priority: 2 },
    ]);
  });

  it("converts datetime-local strings to ISO-8601 preserving the instant", () => {
    const req = buildRequest(tasks, blocks, prefs);
    const block = req.busy_blocks![0];
    expect(block.label).toBe("Standup");
    // ISO string with timezone designator, and the same instant as the input.
    expect(block.start).toMatch(/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/);
    expect(new Date(block.start).getTime()).toBe(new Date("2026-06-15T10:00").getTime());
    expect(new Date(block.end).getTime()).toBe(new Date("2026-06-15T11:00").getTime());
  });

  it("maps preferences to numbers", () => {
    const req = buildRequest(tasks, blocks, prefs);
    expect(req.preferences).toEqual({
      workday_start_hour: 9,
      workday_end_hour: 18,
      max_focus_minutes_per_day: 360,
    });
  });

  it("always sends the fixed council defaults", () => {
    const req = buildRequest(tasks, blocks, prefs);
    expect(req.max_rounds).toBe(3);
    expect(req.require_human_on_stall).toBe(true);
  });

  it("trims task titles and busy-block labels", () => {
    const req = buildRequest(
      [{ title: "  Padded  ", estimatedMinutes: "30", priority: 3 }],
      [{ label: "  Call  ", start: "2026-06-15T10:00", end: "2026-06-15T11:00" }],
      prefs,
    );
    expect(req.tasks[0].title).toBe("Padded");
    expect(req.busy_blocks![0].label).toBe("Call");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/buildRequest.test.ts`
Expected: FAIL — cannot resolve `@/lib/buildRequest` (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `frontend/lib/buildRequest.ts`:

```ts
import { StartDebateRequest } from "@/lib/types";

export interface TaskDraft {
  title: string;
  estimatedMinutes: string; // raw input value; parsed on build
  priority: number;
}

export interface BusyBlockDraft {
  label: string;
  start: string; // datetime-local value, e.g. "2026-06-15T10:00"
  end: string;
}

export interface PrefsDraft {
  workdayStartHour: string;
  workdayEndHour: string;
  maxFocusMinutes: string;
}

/** Pure transform: form drafts -> the API request the backend expects. */
export function buildRequest(
  tasks: TaskDraft[],
  busyBlocks: BusyBlockDraft[],
  prefs: PrefsDraft,
): StartDebateRequest {
  return {
    tasks: tasks.map((t, i) => ({
      id: `t${i + 1}`,
      title: t.title.trim(),
      estimated_minutes: Number(t.estimatedMinutes),
      priority: t.priority,
    })),
    busy_blocks: busyBlocks.map((b) => ({
      label: b.label.trim(),
      start: new Date(b.start).toISOString(),
      end: new Date(b.end).toISOString(),
    })),
    preferences: {
      workday_start_hour: Number(prefs.workdayStartHour),
      workday_end_hour: Number(prefs.workdayEndHour),
      max_focus_minutes_per_day: Number(prefs.maxFocusMinutes),
    },
    max_rounds: 3,
    require_human_on_stall: true,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/buildRequest.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/buildRequest.ts frontend/lib/buildRequest.test.ts
git commit -m "feat(frontend): add buildRequest transform + draft types"
```

---

### Task 2: TaskRow component

**Files:**
- Create: `frontend/components/TaskRow.tsx`
- Test: `frontend/components/TaskRow.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/components/TaskRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskRow } from "@/components/TaskRow";
import { TaskDraft } from "@/lib/buildRequest";

const draft: TaskDraft = { title: "Write report", estimatedMinutes: "120", priority: 2 };

describe("TaskRow", () => {
  it("renders the draft values", () => {
    render(<TaskRow draft={draft} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByTestId("task-title-input")).toHaveValue("Write report");
    expect(screen.getByTestId("task-minutes-input")).toHaveValue(120);
    expect(screen.getByTestId("task-priority-select")).toHaveValue("2");
  });

  it("emits a title patch on typing", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TaskRow draft={{ ...draft, title: "" }} onChange={onChange} onRemove={vi.fn()} />);
    await user.type(screen.getByTestId("task-title-input"), "A");
    expect(onChange).toHaveBeenCalledWith({ title: "A" });
  });

  it("emits a numeric priority patch on select", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TaskRow draft={draft} onChange={onChange} onRemove={vi.fn()} />);
    await user.selectOptions(screen.getByTestId("task-priority-select"), "4");
    expect(onChange).toHaveBeenCalledWith({ priority: 4 });
  });

  it("calls onRemove when the remove button is clicked", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<TaskRow draft={draft} onChange={vi.fn()} onRemove={onRemove} />);
    await user.click(screen.getByTestId("task-remove"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/TaskRow.test.tsx`
Expected: FAIL — cannot resolve `@/components/TaskRow`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/components/TaskRow.tsx`:

```tsx
"use client";

import { TaskDraft } from "@/lib/buildRequest";

const PRIORITIES = [1, 2, 3, 4];

export function TaskRow({
  draft,
  onChange,
  onRemove,
}: {
  draft: TaskDraft;
  onChange: (patch: Partial<TaskDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2" data-testid="task-row">
      <input
        data-testid="task-title-input"
        value={draft.title}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder="Task title"
        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        data-testid="task-minutes-input"
        type="number"
        min={1}
        value={draft.estimatedMinutes}
        onChange={(e) => onChange({ estimatedMinutes: e.target.value })}
        className="w-20 rounded-lg border border-slate-300 px-2 py-2 text-sm"
        aria-label="Estimated minutes"
      />
      <span className="text-xs text-slate-400">min</span>
      <select
        data-testid="task-priority-select"
        value={draft.priority}
        onChange={(e) => onChange({ priority: Number(e.target.value) })}
        className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
        aria-label="Priority"
      >
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            P{p}
          </option>
        ))}
      </select>
      <button
        type="button"
        data-testid="task-remove"
        onClick={onRemove}
        aria-label="Remove task"
        className="rounded-lg px-2 py-2 text-slate-400 hover:text-rose-600"
      >
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/TaskRow.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/TaskRow.tsx frontend/components/TaskRow.test.tsx
git commit -m "feat(frontend): add TaskRow component"
```

---

### Task 3: BusyBlockRow component

**Files:**
- Create: `frontend/components/BusyBlockRow.tsx`
- Test: `frontend/components/BusyBlockRow.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/components/BusyBlockRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BusyBlockRow } from "@/components/BusyBlockRow";
import { BusyBlockDraft } from "@/lib/buildRequest";

const draft: BusyBlockDraft = {
  label: "Standup",
  start: "2026-06-15T10:00",
  end: "2026-06-15T11:00",
};

describe("BusyBlockRow", () => {
  it("renders the draft values", () => {
    render(<BusyBlockRow draft={draft} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByTestId("busy-label-input")).toHaveValue("Standup");
    expect(screen.getByTestId("busy-start-input")).toHaveValue("2026-06-15T10:00");
    expect(screen.getByTestId("busy-end-input")).toHaveValue("2026-06-15T11:00");
  });

  it("emits a label patch on typing", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BusyBlockRow draft={{ ...draft, label: "" }} onChange={onChange} onRemove={vi.fn()} />);
    await user.type(screen.getByTestId("busy-label-input"), "X");
    expect(onChange).toHaveBeenCalledWith({ label: "X" });
  });

  it("calls onRemove when the remove button is clicked", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<BusyBlockRow draft={draft} onChange={vi.fn()} onRemove={onRemove} />);
    await user.click(screen.getByTestId("busy-remove"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/BusyBlockRow.test.tsx`
Expected: FAIL — cannot resolve `@/components/BusyBlockRow`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/components/BusyBlockRow.tsx`:

```tsx
"use client";

import { BusyBlockDraft } from "@/lib/buildRequest";

export function BusyBlockRow({
  draft,
  onChange,
  onRemove,
}: {
  draft: BusyBlockDraft;
  onChange: (patch: Partial<BusyBlockDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2" data-testid="busy-block-row">
      <input
        data-testid="busy-label-input"
        value={draft.label}
        onChange={(e) => onChange({ label: e.target.value })}
        placeholder="Commitment"
        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        data-testid="busy-start-input"
        type="datetime-local"
        value={draft.start}
        onChange={(e) => onChange({ start: e.target.value })}
        className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
        aria-label="Start"
      />
      <span className="text-xs text-slate-400">→</span>
      <input
        data-testid="busy-end-input"
        type="datetime-local"
        value={draft.end}
        onChange={(e) => onChange({ end: e.target.value })}
        className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
        aria-label="End"
      />
      <button
        type="button"
        data-testid="busy-remove"
        onClick={onRemove}
        aria-label="Remove busy block"
        className="rounded-lg px-2 py-2 text-slate-400 hover:text-rose-600"
      >
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/BusyBlockRow.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/BusyBlockRow.tsx frontend/components/BusyBlockRow.test.tsx
git commit -m "feat(frontend): add BusyBlockRow component"
```

---

### Task 4: TaskForm container (rewrite)

**Files:**
- Modify (full rewrite): `frontend/components/TaskForm.tsx`
- Test (full rewrite): `frontend/components/TaskForm.test.tsx`

This task replaces the JSON-textarea form with the structured container. The old test (JSON parsing) is removed and replaced — the `onStart` prop contract is identical, so `page.tsx` is unaffected.

- [ ] **Step 1: Write the failing test (rewrite)**

Replace the entire contents of `frontend/components/TaskForm.test.tsx` with:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskForm } from "@/components/TaskForm";

describe("TaskForm", () => {
  it("submits the seeded sample week as a StartDebateRequest", async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<TaskForm onStart={onStart} />);

    await user.click(screen.getByRole("button", { name: /convene the council/i }));

    expect(onStart).toHaveBeenCalledTimes(1);
    const req = onStart.mock.calls[0][0];
    expect(req.tasks.length).toBeGreaterThan(0);
    expect(req.tasks[0].id).toBe("t1");
    expect(req.max_rounds).toBe(3);
    expect(req.require_human_on_stall).toBe(true);
  });

  it("adds a task row when Add task is clicked", async () => {
    const user = userEvent.setup();
    render(<TaskForm onStart={vi.fn()} />);

    const before = screen.getAllByTestId("task-row").length;
    await user.click(screen.getByTestId("add-task-btn"));
    expect(screen.getAllByTestId("task-row").length).toBe(before + 1);
  });

  it("removes a task row when its remove button is clicked", async () => {
    const user = userEvent.setup();
    render(<TaskForm onStart={vi.fn()} />);

    const before = screen.getAllByTestId("task-row").length;
    await user.click(screen.getAllByTestId("task-remove")[0]);
    expect(screen.getAllByTestId("task-row").length).toBe(before - 1);
  });

  it("blocks submit and shows an error when no task has a title", async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<TaskForm onStart={onStart} />);

    // Clear every task title.
    for (const input of screen.getAllByTestId("task-title-input")) {
      await user.clear(input);
    }
    await user.click(screen.getByRole("button", { name: /convene the council/i }));

    expect(screen.getByTestId("form-error")).toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("blocks submit when a busy block ends before it starts", async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<TaskForm onStart={onStart} />);

    const end = screen.getAllByTestId("busy-end-input")[0];
    // datetime-local is unreliable with userEvent.type in jsdom; set the value directly.
    fireEvent.change(end, { target: { value: "2026-06-15T09:00" } }); // before the seeded 10:00 start
    await user.click(screen.getByRole("button", { name: /convene the council/i }));

    expect(screen.getByTestId("form-error")).toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/TaskForm.test.tsx`
Expected: FAIL — the current JSON-based `TaskForm` has no `add-task-btn` / `task-row` testids, so the add/remove/validation tests fail.

- [ ] **Step 3: Write minimal implementation (rewrite)**

Replace the entire contents of `frontend/components/TaskForm.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { StartDebateRequest } from "@/lib/types";
import {
  buildRequest,
  TaskDraft,
  BusyBlockDraft,
  PrefsDraft,
} from "@/lib/buildRequest";
import { TaskRow } from "@/components/TaskRow";
import { BusyBlockRow } from "@/components/BusyBlockRow";

const SEED_TASKS: TaskDraft[] = [
  { title: "Write Q3 report", estimatedMinutes: "180", priority: 1 },
  { title: "Review 5 pull requests", estimatedMinutes: "90", priority: 2 },
];
const SEED_BLOCKS: BusyBlockDraft[] = [
  { label: "Standup", start: "2026-06-15T10:00", end: "2026-06-15T11:00" },
];
const SEED_PREFS: PrefsDraft = {
  workdayStartHour: "9",
  workdayEndHour: "18",
  maxFocusMinutes: "360",
};

const EMPTY_TASK: TaskDraft = { title: "", estimatedMinutes: "60", priority: 2 };
const EMPTY_BLOCK: BusyBlockDraft = { label: "", start: "", end: "" };

function validate(tasks: TaskDraft[], blocks: BusyBlockDraft[]): string | null {
  const titled = tasks.filter((t) => t.title.trim() !== "");
  if (titled.length === 0) return "Add at least one task with a title.";
  if (titled.some((t) => !(Number(t.estimatedMinutes) > 0)))
    return "Every task needs an estimate greater than 0 minutes.";
  for (const b of blocks) {
    if (b.start && b.end && new Date(b.end) <= new Date(b.start))
      return "Each busy block must end after it starts.";
  }
  return null;
}

export function TaskForm({
  onStart,
  disabled,
}: {
  onStart: (req: StartDebateRequest) => void;
  disabled?: boolean;
}) {
  const [tasks, setTasks] = useState<TaskDraft[]>(SEED_TASKS);
  const [blocks, setBlocks] = useState<BusyBlockDraft[]>(SEED_BLOCKS);
  const [prefs, setPrefs] = useState<PrefsDraft>(SEED_PREFS);
  const [error, setError] = useState<string | null>(null);

  function patchTask(i: number, patch: Partial<TaskDraft>) {
    setTasks((prev) => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }
  function patchBlock(i: number, patch: Partial<BusyBlockDraft>) {
    setBlocks((prev) => prev.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  }

  function handleStart() {
    const err = validate(tasks, blocks);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    // Drop tasks with empty titles before building the request.
    const titledTasks = tasks.filter((t) => t.title.trim() !== "");
    onStart(buildRequest(titledTasks, blocks, prefs));
  }

  return (
    <div className="flex flex-col gap-6" data-testid="task-form">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Tasks</h2>
          <button
            type="button"
            data-testid="add-task-btn"
            onClick={() => setTasks((prev) => [...prev, { ...EMPTY_TASK }])}
            className="text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            + Add task
          </button>
        </div>
        {tasks.map((t, i) => (
          <TaskRow
            key={i}
            draft={t}
            onChange={(patch) => patchTask(i, patch)}
            onRemove={() => setTasks((prev) => prev.filter((_, j) => j !== i))}
          />
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Busy blocks
          </h2>
          <button
            type="button"
            data-testid="add-block-btn"
            onClick={() => setBlocks((prev) => [...prev, { ...EMPTY_BLOCK }])}
            className="text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            + Add block
          </button>
        </div>
        {blocks.map((b, i) => (
          <BusyBlockRow
            key={i}
            draft={b}
            onChange={(patch) => patchBlock(i, patch)}
            onRemove={() => setBlocks((prev) => prev.filter((_, j) => j !== i))}
          />
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Preferences</h2>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
          <label className="flex items-center gap-1">
            Workday
            <input
              data-testid="pref-start"
              type="number"
              min={0}
              max={23}
              value={prefs.workdayStartHour}
              onChange={(e) => setPrefs({ ...prefs, workdayStartHour: e.target.value })}
              className="w-16 rounded-lg border border-slate-300 px-2 py-1"
              aria-label="Workday start hour"
            />
            –
            <input
              data-testid="pref-end"
              type="number"
              min={0}
              max={23}
              value={prefs.workdayEndHour}
              onChange={(e) => setPrefs({ ...prefs, workdayEndHour: e.target.value })}
              className="w-16 rounded-lg border border-slate-300 px-2 py-1"
              aria-label="Workday end hour"
            />
          </label>
          <label className="flex items-center gap-1">
            Max focus
            <input
              data-testid="pref-focus"
              type="number"
              min={0}
              value={prefs.maxFocusMinutes}
              onChange={(e) => setPrefs({ ...prefs, maxFocusMinutes: e.target.value })}
              className="w-20 rounded-lg border border-slate-300 px-2 py-1"
              aria-label="Max focus minutes per day"
            />
            min/day
          </label>
        </div>
      </section>

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/TaskForm.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full frontend suite**

Run: `npx vitest run`
Expected: PASS — all suites green. Test count rises from 33 (old TaskForm had 2 tests; now buildRequest 5 + TaskRow 4 + BusyBlockRow 3 + TaskForm 5 = 17 in place of 2, so ~48 total). No suite should fail; `page.test.tsx` and others are unaffected because the `onStart` contract is unchanged.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/TaskForm.tsx frontend/components/TaskForm.test.tsx
git commit -m "feat(frontend): replace JSON textarea with structured input form"
```

---

## Notes for the implementer

- **`frontend/AGENTS.md` warns this is a non-standard Next.js build.** Before writing component code, skim the relevant guide under `frontend/node_modules/next/dist/docs/` if anything about client components or imports looks unfamiliar. The patterns above mirror existing components (`InterventionPanel.tsx`, `DebateMessage.tsx`), so they should hold.
- **datetime-local + timezone:** `new Date("2026-06-15T10:00")` parses as local time; `.toISOString()` emits the equivalent UTC instant with a `Z` suffix — valid ISO-8601 the backend accepts. Tests assert the instant via `getTime()` rather than the literal string, so they pass regardless of the runner's timezone.
- **Do not touch** `frontend/app/page.tsx`, `frontend/lib/useDebateStream.ts`, or `frontend/lib/types.ts` — the `StartDebateRequest` shape and `onStart` prop are unchanged.
