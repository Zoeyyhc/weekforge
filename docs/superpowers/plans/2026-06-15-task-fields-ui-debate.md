# Task Fields, Intake UI Redesign & Debate UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. For UI tasks (Tasks 4, 5, 6, 8, 9), ALSO invoke superpowers:frontend-design to push visual polish beyond the baseline classes given here.

**Goal:** Add deadline-weekday + preferred-day fields to tasks, redesign the intake form as a dark "forge table" with glowing cards, and improve the debate experience with word-count caps, Markdown rendering, and round-based tabs.

**Architecture:** Three independent feature areas sequenced to avoid file conflicts. Backend changes are small (one new model field, two prompt additions). Frontend changes layer on top: extend `TaskDraft` → update `TaskRow` → reskin `TaskForm` and `BusyBlockRow` → add `react-markdown` to `DebateMessage` → add round tabs to `DebateTimeline`.

**Tech Stack:** Python 3.12 / Pydantic v2 (backend), Next.js App Router + TypeScript + Tailwind CSS v4 + Vitest + React Testing Library (frontend). Run backend tests with `uv run pytest`. Run frontend tests with `cd frontend && npm test`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/weekforge/models.py` | Modify | Add `preferred_days: list[str] \| None = None` to `Task` |
| `src/weekforge/debate/nodes.py` | Modify | `_fmt_tasks()` formats deadline (human-readable) + preferred days |
| `src/weekforge/debate/debaters.py` | Modify | Append word-count instructions to `propose()` and `critique()` prompts |
| `tests/test_models.py` | Modify | `preferred_days` round-trip tests |
| `tests/debate/test_nodes.py` | Modify | `_fmt_tasks()` includes new fields test |
| `frontend/lib/types.ts` | Modify | Add `preferred_days?: string[] \| null` to `TaskInput` |
| `frontend/lib/buildRequest.ts` | Modify | Extend `TaskDraft`; `deadlineToISO()` helper; map `preferredDays` |
| `frontend/lib/buildRequest.test.ts` | Create | Tests for deadline conversion + preferredDays mapping |
| `frontend/components/TaskRow.tsx` | Modify | Sub-card wrapper; deadline toggle + weekday select; preferred-day pills; color-coded priority; underline + font-mono inputs |
| `frontend/components/TaskRow.test.tsx` | Modify | Update `draft` const; add tests for new interactions |
| `frontend/components/TaskForm.tsx` | Modify | Forge card structure; left accent bar; SEED_TASKS/add-task defaults; Preferences instrument grid; ember separator + CTA |
| `frontend/components/BusyBlockRow.tsx` | Modify | Underline inputs; font-mono on time values |
| `frontend/components/DebateTimeline.tsx` | Modify | Round-based tabs; `status` prop; auto-follow latest round; no more `RoundDivider` |
| `frontend/components/DebateTimeline.test.tsx` | Modify | Rewrite broken timeline tests; add tab + markdown tests |
| `frontend/app/page.tsx` | Modify | Pass `status={state.status}` to `<DebateTimeline>` |

---

## Task 1: Backend — Add `preferred_days` to `Task` model

**Files:**
- Modify: `src/weekforge/models.py`
- Modify: `tests/test_models.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_models.py`:

```python
def test_task_preferred_days_defaults_to_none():
    task = Task(id="t1", title="Write report", estimated_minutes=60)
    assert task.preferred_days is None


def test_task_preferred_days_accepts_ordered_list():
    task = Task(id="t1", title="Write report", estimated_minutes=60, preferred_days=["Wed", "Fri"])
    assert task.preferred_days == ["Wed", "Fri"]


def test_task_preferred_days_accepts_empty_list():
    task = Task(id="t1", title="Write report", estimated_minutes=60, preferred_days=[])
    assert task.preferred_days == []
```

- [ ] **Step 2: Run to verify they fail**

```bash
uv run pytest tests/test_models.py::test_task_preferred_days_defaults_to_none tests/test_models.py::test_task_preferred_days_accepts_ordered_list tests/test_models.py::test_task_preferred_days_accepts_empty_list -v
```

Expected: `AttributeError` — `Task` has no `preferred_days` field.

- [ ] **Step 3: Add the field to `Task` in `src/weekforge/models.py`**

In the `Task` class, after the `depends_on` field:

```python
preferred_days: list[str] | None = None
# Ordered weekday abbreviations: first element is 1st choice, second is 2nd choice.
# Valid values: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"
```

- [ ] **Step 4: Run to verify they pass**

```bash
uv run pytest tests/test_models.py -v
```

Expected: all model tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/models.py tests/test_models.py
git commit -m "feat(backend): add preferred_days field to Task model"
```

---

## Task 2: Backend — Update `_fmt_tasks()` to include new fields

**Files:**
- Modify: `src/weekforge/debate/nodes.py`
- Modify: `tests/debate/test_nodes.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/debate/test_nodes.py` (after the existing imports and fixtures):

```python
def test_fmt_tasks_includes_preferred_days_and_deadline(base_state):
    from weekforge.debate.nodes import _fmt_tasks
    from weekforge.models import Task
    from datetime import datetime, timezone

    state = {
        **base_state,
        "tasks": [
            Task(
                id="t1",
                title="Review PRs",
                estimated_minutes=90,
                priority=2,
                deadline=datetime(2026, 6, 18, 23, 59, tzinfo=timezone.utc),
                preferred_days=["Wed", "Fri"],
            )
        ],
    }
    result = _fmt_tasks(state)
    assert "deadline" in result
    assert "Thu" in result        # Jun 18 2026 is a Thursday
    assert "prefer" in result
    assert "Wed" in result
    assert "Fri" in result
```

- [ ] **Step 2: Run to verify it fails**

```bash
uv run pytest tests/debate/test_nodes.py::test_fmt_tasks_includes_preferred_days_and_deadline -v
```

Expected: FAIL — `preferred_days` not in output.

- [ ] **Step 3: Update `_fmt_tasks()` in `src/weekforge/debate/nodes.py`**

Replace the existing `_fmt_tasks` function:

```python
def _fmt_tasks(state: DebateState) -> str:
    lines = []
    for t in state["tasks"]:
        line = f"- [{t.id}] {t.title} ({t.estimated_minutes}min, priority {t.priority}"
        if t.deadline:
            line += f", deadline {t.deadline.strftime('%a %d %b')}"
        if t.category:
            line += f", category: {t.category}"
        if t.preferred_days:
            pref = " · ".join(
                f"{'1st' if i == 0 else '2nd'} {d}"
                for i, d in enumerate(t.preferred_days[:2])
            )
            line += f", prefer: {pref}"
        line += ")"
        lines.append(line)
    return "\n".join(lines) if lines else "No tasks."
```

- [ ] **Step 4: Run to verify it passes**

```bash
uv run pytest tests/debate/test_nodes.py -v
```

Expected: all node tests pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/nodes.py tests/debate/test_nodes.py
git commit -m "feat(backend): format preferred_days and deadline weekday in council context"
```

---

## Task 3: Backend — Word-count caps in `debaters.py`

**Files:**
- Modify: `src/weekforge/debate/debaters.py`

No new tests needed — the change is prompt-only and existing integration tests cover the `propose`/`critique` call paths.

- [ ] **Step 1: Add word-count cap to `propose()` in `src/weekforge/debate/debaters.py`**

In the `propose()` method, change the `description` string's last sentence from:

```python
"Explain your reasoning in 2-3 sentences."
```

to:

```python
"Explain your reasoning in 2-3 sentences. "
"Limit your response to 150 words."
```

Full updated description:

```python
description=(
    f"Given this planning context:\n{context}\n\n"
    "Propose a weekly schedule that best serves YOUR specific objective. "
    "Be concrete: name which tasks go on which days and at what times. "
    "Explain your reasoning in 2-3 sentences. "
    "Limit your response to 150 words."
),
```

- [ ] **Step 2: Add word-count cap to `critique()` in `src/weekforge/debate/debaters.py`**

In the `critique()` method, append to the description:

```python
description=(
    f"Given these proposals from the council:\n{context}\n\n"
    "Critique the proposals from YOUR perspective. "
    "Be specific: which proposals conflict with your objective and why. "
    "Be direct — this is a debate. "
    "Limit your response to 100 words."
),
```

- [ ] **Step 3: Run the full backend suite to confirm nothing broke**

```bash
uv run pytest -v
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/weekforge/debate/debaters.py
git commit -m "feat(backend): add 150/100-word caps to proposal and critique prompts"
```

---

## Task 4: Frontend — Extend `TaskDraft` + `buildRequest()` (types + deadline conversion)

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/lib/buildRequest.ts`
- Create: `frontend/lib/buildRequest.test.ts`

- [ ] **Step 1: Create the failing test file `frontend/lib/buildRequest.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildRequest, TaskDraft, BusyBlockDraft, PrefsDraft } from "@/lib/buildRequest";

function makeDraft(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return {
    id: "draft-1",
    title: "Test task",
    estimatedMinutes: "60",
    priority: 2,
    hasDeadline: false,
    deadlineWeekday: "Fri",
    preferredDays: [],
    ...overrides,
  };
}

const noBlocks: BusyBlockDraft[] = [];
const prefs: PrefsDraft = { workdayStartHour: "9", workdayEndHour: "18", maxFocusMinutes: "360" };

afterEach(() => vi.useRealTimers());

describe("buildRequest — deadline", () => {
  it("sets deadline to null when hasDeadline is false", () => {
    const req = buildRequest([makeDraft({ hasDeadline: false })], noBlocks, prefs);
    expect(req.tasks[0].deadline).toBeNull();
  });

  it("converts Thu to that Thursday of the current week at 23:59 local", () => {
    vi.useFakeTimers();
    // Pin to Mon 15 Jun 2026 at 08:00 local so we can predict Thursday = 18 Jun
    vi.setSystemTime(new Date(2026, 5, 15, 8, 0, 0));

    const req = buildRequest([makeDraft({ hasDeadline: true, deadlineWeekday: "Thu" })], noBlocks, prefs);
    const d = new Date(req.tasks[0].deadline!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);  // June (0-indexed)
    expect(d.getDate()).toBe(18);  // Thursday
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
  });

  it("converts Mon to that Monday (same day when today is Monday)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 8, 0, 0)); // Monday 15 Jun

    const req = buildRequest([makeDraft({ hasDeadline: true, deadlineWeekday: "Mon" })], noBlocks, prefs);
    const d = new Date(req.tasks[0].deadline!);
    expect(d.getDate()).toBe(15);
  });
});

describe("buildRequest — preferredDays", () => {
  it("maps preferredDays to preferred_days on the task", () => {
    const req = buildRequest([makeDraft({ preferredDays: ["Wed", "Fri"] })], noBlocks, prefs);
    expect(req.tasks[0].preferred_days).toEqual(["Wed", "Fri"]);
  });

  it("omits preferred_days when preferredDays is empty", () => {
    const req = buildRequest([makeDraft({ preferredDays: [] })], noBlocks, prefs);
    expect(req.tasks[0].preferred_days).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/Najum/weekforge/frontend && npm test -- buildRequest
```

Expected: FAIL — `hasDeadline` not a property of `TaskDraft`, functions not found.

- [ ] **Step 3: Add `preferred_days` to `TaskInput` in `frontend/lib/types.ts`**

In the `TaskInput` interface, after `depends_on`:

```ts
preferred_days?: string[] | null;
```

- [ ] **Step 4: Replace `frontend/lib/buildRequest.ts` with the extended version**

```ts
import { StartDebateRequest } from "@/lib/types";

export interface TaskDraft {
  id: string;
  title: string;
  estimatedMinutes: string;
  priority: number;
  hasDeadline: boolean;
  deadlineWeekday: string; // "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"
  preferredDays: string[]; // ordered, max 2: [firstChoice, secondChoice]
}

export interface BusyBlockDraft {
  id: string;
  label: string;
  start: string;
  end: string;
}

export interface PrefsDraft {
  workdayStartHour: string;
  workdayEndHour: string;
  maxFocusMinutes: string;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
};

/** Convert a weekday abbreviation to the ISO datetime of that day at 23:59 local time in the current week. */
function deadlineToISO(weekday: string): string {
  const today = new Date();
  const mondayOffset = (today.getDay() + 6) % 7; // days since Monday (0 = Mon)
  const targetOffset = WEEKDAY_INDEX[weekday] ?? 4;
  const diff = targetOffset - mondayOffset;
  const target = new Date(today);
  target.setDate(today.getDate() + diff);
  target.setHours(23, 59, 0, 0);
  return target.toISOString();
}

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
      deadline: t.hasDeadline ? deadlineToISO(t.deadlineWeekday) : null,
      ...(t.preferredDays.length > 0 && { preferred_days: t.preferredDays }),
    })),
    busy_blocks: busyBlocks.length
      ? busyBlocks.map((b) => ({
          label: b.label.trim(),
          start: new Date(b.start).toISOString(),
          end: new Date(b.end).toISOString(),
        }))
      : undefined,
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

- [ ] **Step 5: Run to verify the tests pass**

```bash
cd /Users/Najum/weekforge/frontend && npm test -- buildRequest
```

Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/buildRequest.ts frontend/lib/buildRequest.test.ts
git commit -m "feat(frontend): extend TaskDraft with deadline weekday + preferred days"
```

---

## Task 5: Frontend — `TaskRow` UI (sub-card + deadline + preferred days + color priority)

> **Frontend-design note:** Invoke superpowers:frontend-design for visual refinement beyond the baseline classes here.

**Files:**
- Modify: `frontend/components/TaskRow.tsx`
- Modify: `frontend/components/TaskRow.test.tsx`

- [ ] **Step 1: Add new tests to `frontend/components/TaskRow.test.tsx`**

At the top of the file, update the `draft` const to include new fields (keeps existing tests green):

```ts
const draft: TaskDraft = {
  id: "test-t1",
  title: "Write report",
  estimatedMinutes: "120",
  priority: 2,
  hasDeadline: false,
  deadlineWeekday: "Fri",
  preferredDays: [],
};
```

Then add a new describe block after the existing ones:

```ts
describe("TaskRow — deadline + preferred days", () => {
  it("hides deadline weekday select when hasDeadline is false", () => {
    render(<TaskRow draft={draft} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryByLabelText(/deadline weekday/i)).toBeNull();
  });

  it("shows deadline weekday select when hasDeadline is true", () => {
    render(<TaskRow draft={{ ...draft, hasDeadline: true }} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByLabelText(/deadline weekday/i)).toBeInTheDocument();
  });

  it("calls onChange with hasDeadline toggled when deadline pill is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TaskRow draft={draft} onChange={onChange} onRemove={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /deadline/i }));
    expect(onChange).toHaveBeenCalledWith({ hasDeadline: true });
  });

  it("adds first preferred day on first pill click", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TaskRow draft={draft} onChange={onChange} onRemove={vi.fn()} />);
    await user.click(screen.getByTestId("day-pill-Wed"));
    expect(onChange).toHaveBeenCalledWith({ preferredDays: ["Wed"] });
  });

  it("adds second preferred day when one is already selected", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TaskRow draft={{ ...draft, preferredDays: ["Wed"] }} onChange={onChange} onRemove={vi.fn()} />
    );
    await user.click(screen.getByTestId("day-pill-Fri"));
    expect(onChange).toHaveBeenCalledWith({ preferredDays: ["Wed", "Fri"] });
  });

  it("removes a preferred day when its pill is clicked again", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TaskRow draft={{ ...draft, preferredDays: ["Wed", "Fri"] }} onChange={onChange} onRemove={vi.fn()} />
    );
    await user.click(screen.getByTestId("day-pill-Wed"));
    expect(onChange).toHaveBeenCalledWith({ preferredDays: ["Fri"] });
  });

  it("does not add a third preferred day (max 2)", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TaskRow draft={{ ...draft, preferredDays: ["Wed", "Fri"] }} onChange={onChange} onRemove={vi.fn()} />
    );
    await user.click(screen.getByTestId("day-pill-Mon")); // already at max
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify new tests fail, existing pass**

```bash
cd /Users/Najum/weekforge/frontend && npm test -- TaskRow
```

Expected: existing 5 tests pass, 7 new tests fail.

- [ ] **Step 3: Replace `frontend/components/TaskRow.tsx`**

```tsx
"use client";

import { TaskDraft } from "@/lib/buildRequest";

const PRIORITIES = [1, 2, 3, 4, 5];

const PRIORITY_COLORS: Record<number, string> = {
  1: "text-rose-400",
  2: "text-amber",
  3: "text-muted",
  4: "text-[#4a4845]",
  5: "text-[#3a3530]",
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function TaskRow({
  draft,
  onChange,
  onRemove,
}: {
  draft: TaskDraft;
  onChange: (patch: Partial<TaskDraft>) => void;
  onRemove: () => void;
}) {
  function handleDayClick(day: string) {
    const idx = draft.preferredDays.indexOf(day);
    if (idx >= 0) {
      onChange({ preferredDays: draft.preferredDays.filter((d) => d !== day) });
    } else if (draft.preferredDays.length < 2) {
      onChange({ preferredDays: [...draft.preferredDays, day] });
    }
  }

  return (
    <div
      className="rounded-lg border border-[#2a2620] bg-[#111318] p-3 flex flex-col gap-2"
      data-testid="task-row"
    >
      {/* Row 1: title · estimate · priority · remove */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          data-testid="task-title-input"
          aria-label="Task title"
          value={draft.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Task title"
          className="flex-1 bg-transparent border-0 border-b border-[#2a2620] focus:border-ember outline-none text-sm text-foreground placeholder:text-[#3a3530] py-1 transition-colors"
        />
        <input
          data-testid="task-minutes-input"
          type="number"
          min={1}
          value={draft.estimatedMinutes}
          onChange={(e) => onChange({ estimatedMinutes: e.target.value })}
          className="w-16 bg-transparent border-0 border-b border-[#2a2620] focus:border-ember outline-none text-sm font-mono text-foreground py-1 text-right transition-colors"
          aria-label="Estimated minutes"
        />
        <span className="text-xs text-[#4a4845] font-mono" aria-hidden="true">min</span>
        <select
          data-testid="task-priority-select"
          value={draft.priority}
          onChange={(e) => onChange({ priority: Number(e.target.value) })}
          className={`bg-[#0f1115] border border-[#2a2620] rounded-md px-2 py-1 text-xs font-bold transition-colors ${PRIORITY_COLORS[draft.priority] ?? "text-muted"}`}
          aria-label="Priority"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p} className="bg-[#16191f] text-foreground">
              P{p}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="task-remove"
          onClick={onRemove}
          aria-label="Remove task"
          className="text-[#3a3530] hover:text-rose-400 px-1 transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Row 2: deadline toggle + weekday select */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Toggle deadline"
          onClick={() => onChange({ hasDeadline: !draft.hasDeadline })}
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border transition-colors ${
            draft.hasDeadline
              ? "bg-rose-950/40 border-rose-400/60 text-rose-300"
              : "bg-[#1a1e26] border-[#2a2620] text-[#4a4845] hover:text-muted"
          }`}
        >
          📅 deadline
        </button>
        {draft.hasDeadline && (
          <select
            aria-label="Deadline weekday"
            value={draft.deadlineWeekday}
            onChange={(e) => onChange({ deadlineWeekday: e.target.value })}
            className="bg-transparent border-b border-rose-400/40 text-rose-300 text-xs font-mono px-1 py-0.5 outline-none"
          >
            {DAYS.map((d) => (
              <option key={d} value={d} className="bg-[#16191f]">
                {d}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Row 3: preferred days */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-[#3a3530] font-mono uppercase tracking-wider mr-1">
          prefer
        </span>
        {DAYS.map((day) => {
          const pos = draft.preferredDays.indexOf(day);
          const isFirst = pos === 0;
          const isSecond = pos === 1;
          return (
            <button
              key={day}
              type="button"
              data-testid={`day-pill-${day}`}
              onClick={() => handleDayClick(day)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold border transition-all ${
                isFirst
                  ? "bg-ember/30 text-ember border-ember/60 shadow-[0_0_8px_rgba(255,107,53,0.3)] scale-105"
                  : isSecond
                  ? "bg-amber/25 text-amber border-amber/50"
                  : "bg-[#1a1e26] text-[#4a4845] border-[#2a2620] hover:text-muted"
              }`}
            >
              {isFirst ? "① " : isSecond ? "② " : ""}
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify all TaskRow tests pass**

```bash
cd /Users/Najum/weekforge/frontend && npm test -- TaskRow
```

Expected: 12 tests pass (5 existing + 7 new).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/TaskRow.tsx frontend/components/TaskRow.test.tsx
git commit -m "feat(ui): TaskRow — deadline toggle, preferred-day pills, sub-card, color-coded priority"
```

---

## Task 6: Frontend — `TaskForm` forge card layout + Preferences instrument grid + CTA

> **Frontend-design note:** Invoke superpowers:frontend-design for layout composition and visual polish.

**Files:**
- Modify: `frontend/components/TaskForm.tsx`

- [ ] **Step 1: Run existing TaskForm tests to confirm baseline**

```bash
cd /Users/Najum/weekforge/frontend && npm test -- TaskForm
```

Expected: all pass. Note which testids are used — they must survive the reskin.

- [ ] **Step 2: Replace `frontend/components/TaskForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import React from "react";
import { StartDebateRequest } from "@/lib/types";
import {
  buildRequest,
  TaskDraft,
  BusyBlockDraft,
  PrefsDraft,
} from "@/lib/buildRequest";
import { TaskRow } from "@/components/TaskRow";
import { BusyBlockRow } from "@/components/BusyBlockRow";

let _draftIdCounter = 0;
function nextDraftId(): string {
  return `draft-${++_draftIdCounter}`;
}

const EMPTY_TASK_DRAFT = (): TaskDraft => ({
  id: nextDraftId(),
  title: "",
  estimatedMinutes: "60",
  priority: 2,
  hasDeadline: false,
  deadlineWeekday: "Fri",
  preferredDays: [],
});

const SEED_TASKS: TaskDraft[] = [
  { id: nextDraftId(), title: "Write Q3 report", estimatedMinutes: "180", priority: 1, hasDeadline: false, deadlineWeekday: "Fri", preferredDays: [] },
  { id: nextDraftId(), title: "Review 5 pull requests", estimatedMinutes: "90", priority: 2, hasDeadline: false, deadlineWeekday: "Fri", preferredDays: [] },
];
const SEED_BLOCKS: BusyBlockDraft[] = [
  { id: nextDraftId(), label: "Standup", start: "2026-06-15T10:00", end: "2026-06-15T11:00" },
];
const SEED_PREFS: PrefsDraft = {
  workdayStartHour: "9",
  workdayEndHour: "18",
  maxFocusMinutes: "360",
};

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

function ForgeCard({
  children,
  barClass,
}: {
  children: React.ReactNode;
  barClass: string;
}) {
  return (
    <div className="flex rounded-xl bg-[#1c2030] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className={`w-1 self-stretch rounded-l-xl shrink-0 ${barClass}`} aria-hidden="true" />
      <div className="flex-1 p-4 flex flex-col gap-3">{children}</div>
    </div>
  );
}

export function TaskForm({
  onStart,
  disabled,
  googleSlot,
}: {
  onStart: (req: StartDebateRequest) => void;
  disabled?: boolean;
  googleSlot?: React.ReactNode;
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
    if (err) { setError(err); return; }
    setError(null);
    const titledTasks = tasks.filter((t) => t.title.trim() !== "");
    const populatedBlocks = blocks.filter((b) => b.start !== "" && b.end !== "");
    onStart(buildRequest(titledTasks, populatedBlocks, prefs));
  }

  return (
    <div className="flex flex-col gap-4" data-testid="task-form">

      {/* ── Tasks card ── */}
      <ForgeCard barClass="bg-gradient-to-b from-rose-400 to-ember">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-foreground">
            ⚔ Tasks
          </h2>
          <button
            type="button"
            data-testid="add-task-btn"
            onClick={() => setTasks((prev) => [...prev, EMPTY_TASK_DRAFT()])}
            className="text-xs font-medium text-ember underline hover:text-amber transition-colors"
          >
            + Add task
          </button>
        </div>
        {tasks.map((t, i) => (
          <TaskRow
            key={t.id}
            draft={t}
            onChange={(patch) => patchTask(i, patch)}
            onRemove={() => setTasks((prev) => prev.filter((_, j) => j !== i))}
          />
        ))}
      </ForgeCard>

      {/* ── Busy Blocks card ── */}
      <ForgeCard barClass="bg-gradient-to-b from-cyan-400 to-indigo-500">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-foreground">
            🗓 Busy Blocks
          </h2>
          <button
            type="button"
            data-testid="add-block-btn"
            onClick={() => setBlocks((prev) => [...prev, { id: nextDraftId(), label: "", start: "", end: "" }])}
            className="text-xs font-medium text-ember underline hover:text-amber transition-colors"
          >
            + Add block
          </button>
        </div>
        {googleSlot}
        {blocks.map((b, i) => (
          <BusyBlockRow
            key={b.id}
            draft={b}
            onChange={(patch) => patchBlock(i, patch)}
            onRemove={() => setBlocks((prev) => prev.filter((_, j) => j !== i))}
          />
        ))}
      </ForgeCard>

      {/* ── Preferences card ── */}
      <ForgeCard barClass="bg-gradient-to-b from-emerald-400 to-cyan-400">
        <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-foreground">
          ⚙ Preferences
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-[#2a2620] bg-[#111318] p-3">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted mb-2">🕘 Start</div>
            <input
              data-testid="pref-start"
              type="number"
              min={0}
              max={23}
              value={prefs.workdayStartHour}
              onChange={(e) => setPrefs({ ...prefs, workdayStartHour: e.target.value })}
              className="w-full bg-transparent border-0 border-b border-[#2a2620] focus:border-ember outline-none font-mono text-lg font-bold text-foreground py-1 transition-colors"
              aria-label="Workday start hour"
            />
          </div>
          <div className="rounded-lg border border-[#2a2620] bg-[#111318] p-3">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted mb-2">🕕 End</div>
            <input
              data-testid="pref-end"
              type="number"
              min={0}
              max={23}
              value={prefs.workdayEndHour}
              onChange={(e) => setPrefs({ ...prefs, workdayEndHour: e.target.value })}
              className="w-full bg-transparent border-0 border-b border-[#2a2620] focus:border-ember outline-none font-mono text-lg font-bold text-foreground py-1 transition-colors"
              aria-label="Workday end hour"
            />
          </div>
          <div className="rounded-lg border border-[#2a2620] bg-[#111318] p-3">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted mb-2">🎯 Max Focus</div>
            <div className="flex items-baseline gap-1">
              <input
                data-testid="pref-focus"
                type="number"
                min={0}
                value={prefs.maxFocusMinutes}
                onChange={(e) => setPrefs({ ...prefs, maxFocusMinutes: e.target.value })}
                className="w-full bg-transparent border-0 border-b border-[#2a2620] focus:border-ember outline-none font-mono text-lg font-bold text-foreground py-1 transition-colors"
                aria-label="Max focus minutes per day"
              />
              <span className="font-mono text-xs text-muted shrink-0">min</span>
            </div>
          </div>
        </div>
      </ForgeCard>

      {error && (
        <p className="text-sm text-rose-300" data-testid="form-error">
          {error}
        </p>
      )}

      {/* ── Ember separator + CTA ── */}
      <div className="border-t border-ember/20 pt-4">
        <button
          type="button"
          onClick={handleStart}
          disabled={disabled}
          className="w-full rounded-xl bg-gradient-to-br from-ember to-amber px-6 py-3 text-sm font-black uppercase tracking-[0.2em] text-[#1a0e00] shadow-[0_4px_24px_rgba(255,107,53,0.35)] hover:shadow-[0_4px_32px_rgba(255,107,53,0.5)] transition-shadow disabled:opacity-50"
        >
          ⚒ Convene the Council
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run TaskForm tests**

```bash
cd /Users/Najum/weekforge/frontend && npm test -- TaskForm
```

Expected: all existing TaskForm tests pass (testids unchanged: `task-form`, `add-task-btn`, `add-block-btn`, `pref-start`, `pref-end`, `pref-focus`, `form-error`).

- [ ] **Step 4: Commit**

```bash
git add frontend/components/TaskForm.tsx
git commit -m "feat(ui): forge card layout, instrument preferences grid, ember CTA"
```

---

## Task 7: Frontend — `BusyBlockRow` underline inputs + font-mono

> **Frontend-design note:** Invoke superpowers:frontend-design for visual polish.

**Files:**
- Modify: `frontend/components/BusyBlockRow.tsx`

- [ ] **Step 1: Run existing BusyBlockRow tests to confirm baseline**

```bash
cd /Users/Najum/weekforge/frontend && npm test -- BusyBlockRow
```

- [ ] **Step 2: Replace `frontend/components/BusyBlockRow.tsx`**

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
    <div
      className="flex items-center gap-2 rounded-lg border border-[#2a2620] bg-[#111318] px-3 py-2"
      data-testid="busy-block-row"
    >
      <input
        type="text"
        data-testid="busy-label-input"
        aria-label="Commitment label"
        value={draft.label}
        onChange={(e) => onChange({ label: e.target.value })}
        placeholder="Commitment"
        className="flex-1 bg-transparent border-0 border-b border-[#2a2620] focus:border-ember outline-none text-sm text-foreground placeholder:text-[#3a3530] py-1 transition-colors"
      />
      <input
        data-testid="busy-start-input"
        type="datetime-local"
        value={draft.start}
        onChange={(e) => onChange({ start: e.target.value })}
        className="bg-transparent border-0 border-b border-[#2a2620] focus:border-ember outline-none text-sm font-mono text-foreground py-1 transition-colors"
        aria-label="Start time"
      />
      <span className="text-xs text-[#4a4845] font-mono" aria-hidden="true">→</span>
      <input
        data-testid="busy-end-input"
        type="datetime-local"
        value={draft.end}
        onChange={(e) => onChange({ end: e.target.value })}
        className="bg-transparent border-0 border-b border-[#2a2620] focus:border-ember outline-none text-sm font-mono text-foreground py-1 transition-colors"
        aria-label="End time"
      />
      <button
        type="button"
        data-testid="busy-remove"
        onClick={onRemove}
        aria-label="Remove busy block"
        className="text-[#3a3530] hover:text-rose-400 px-1 transition-colors"
      >
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Run BusyBlockRow tests**

```bash
cd /Users/Najum/weekforge/frontend && npm test -- BusyBlockRow
```

Expected: all existing tests pass (testids unchanged).

- [ ] **Step 4: Commit**

```bash
git add frontend/components/BusyBlockRow.tsx
git commit -m "feat(ui): BusyBlockRow underline inputs and font-mono time values"
```

---

## Task 8: Frontend — `react-markdown` + `DebateMessage`

**Files:**
- Modify: `frontend/package.json` (add dependency)
- Modify: `frontend/components/DebateTimeline.test.tsx` (add markdown test to existing `DebateMessage` describe block)
- Modify: `frontend/components/DebateMessage.tsx`

- [ ] **Step 1: Install `react-markdown`**

```bash
cd /Users/Najum/weekforge/frontend && npm install react-markdown
```

Expected: `package.json` and `package-lock.json` updated, no peer-dep errors.

- [ ] **Step 2: Add the failing markdown test to `frontend/components/DebateTimeline.test.tsx`**

Inside the existing `describe("DebateMessage", ...)` block, add:

```ts
it("renders markdown bold as a <strong> element", () => {
  render(<DebateMessage event={mk(1, "This is **important**")} />);
  const strong = document.querySelector("strong");
  expect(strong).not.toBeNull();
  expect(strong?.textContent).toBe("important");
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd /Users/Najum/weekforge/frontend && npm test -- DebateTimeline
```

Expected: new markdown test FAIL — renders `**important**` as plain text, not `<strong>`.

- [ ] **Step 4: Replace `frontend/components/DebateMessage.tsx`**

```tsx
import ReactMarkdown from "react-markdown";
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
      className={`animate-rise-in rounded-lg border-l-2 p-3 ${meta.color} ${meta.ring}`}
      data-testid="debate-message"
    >
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <span aria-hidden>{meta.emoji}</span>
        <span>{meta.label}</span>
        <span className="text-xs font-normal opacity-70">
          {EVENT_LABEL[event.event_type] ?? event.event_type}
        </span>
      </div>
      <div className="text-sm leading-relaxed [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_strong]:font-bold [&_h3]:font-semibold [&_h3]:text-base [&_h3]:mb-1 [&_h4]:font-semibold [&_h4]:mb-1 [&_p]:mb-1 last:[&_p]:mb-0">
        <ReactMarkdown>{event.content}</ReactMarkdown>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run to verify all DebateMessage tests pass**

```bash
cd /Users/Najum/weekforge/frontend && npm test -- DebateTimeline
```

Expected: `DebateMessage` describe block — all tests including new markdown test pass. `DebateTimeline` describe block — existing tests may now fail (they'll be fixed in Task 9).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/DebateMessage.tsx frontend/components/DebateTimeline.test.tsx frontend/package.json package-lock.json 2>/dev/null; git add frontend/package-lock.json 2>/dev/null; true
git add frontend/components/DebateMessage.tsx frontend/components/DebateTimeline.test.tsx frontend/package.json
git commit -m "feat(ui): render debate messages as Markdown via react-markdown"
```

---

## Task 9: Frontend — `DebateTimeline` round-based tabs

> **Frontend-design note:** Invoke superpowers:frontend-design for tab bar visual polish.

**Files:**
- Modify: `frontend/components/DebateTimeline.tsx`
- Modify: `frontend/components/DebateTimeline.test.tsx` (rewrite broken timeline tests + add tab tests)
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Rewrite `DebateTimeline` tests in `frontend/components/DebateTimeline.test.tsx`**

Replace the entire `describe("DebateTimeline", ...)` block (keep the `describe("DebateMessage", ...)` block intact):

```ts
import userEvent from "@testing-library/user-event";
import { DebateStatus } from "@/lib/debateReducer";

// (mk helper already defined at top of file)

describe("DebateTimeline", () => {
  it("renders the container with no tabs when there are no events", () => {
    render(<DebateTimeline events={[]} />);
    expect(screen.getByTestId("debate-timeline")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByTestId("debate-message")).not.toBeInTheDocument();
  });

  it("renders one tab per distinct round", () => {
    render(
      <DebateTimeline events={[mk(1, "R1 msg"), mk(1, "R1 msg2"), mk(2, "R2 msg")]} />
    );
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByTestId("round-tab-1")).toBeInTheDocument();
    expect(screen.getByTestId("round-tab-2")).toBeInTheDocument();
  });

  it("shows only the active tab's messages by default (latest round)", () => {
    render(
      <DebateTimeline events={[mk(1, "Round one"), mk(2, "Round two")]} />
    );
    expect(screen.getByText("Round two")).toBeInTheDocument();
    expect(screen.queryByText("Round one")).not.toBeInTheDocument();
  });

  it("switches displayed messages when a tab is clicked", async () => {
    const user = userEvent.setup();
    render(
      <DebateTimeline events={[mk(1, "Round one"), mk(2, "Round two")]} />
    );
    await user.click(screen.getByTestId("round-tab-1"));
    expect(screen.getByText("Round one")).toBeInTheDocument();
    expect(screen.queryByText("Round two")).not.toBeInTheDocument();
  });

  it("auto-follows the latest round while streaming", () => {
    const { rerender } = render(
      <DebateTimeline events={[mk(1, "R1")]} status="streaming" />
    );
    expect(screen.getByText("R1")).toBeInTheDocument();

    rerender(
      <DebateTimeline events={[mk(1, "R1"), mk(2, "R2")]} status="streaming" />
    );
    expect(screen.getByText("R2")).toBeInTheDocument();
    expect(screen.queryByText("R1")).not.toBeInTheDocument();
  });

  it("shows a live pulse dot on the latest round tab while streaming", () => {
    render(
      <DebateTimeline events={[mk(1, "R1"), mk(2, "R2")]} status="streaming" />
    );
    expect(screen.getByTestId("live-dot")).toBeInTheDocument();
  });

  it("does not show a live dot when status is done", () => {
    render(
      <DebateTimeline events={[mk(1, "R1"), mk(2, "R2")]} status="done" />
    );
    expect(screen.queryByTestId("live-dot")).not.toBeInTheDocument();
  });
});
```

Note: also add `import { DebateStatus } from "@/lib/debateReducer";` to the imports at the top of the file.

- [ ] **Step 2: Run to confirm new tests fail, DebateMessage tests still pass**

```bash
cd /Users/Najum/weekforge/frontend && npm test -- DebateTimeline
```

Expected: DebateMessage tests pass; all DebateTimeline tests fail.

- [ ] **Step 3: Replace `frontend/components/DebateTimeline.tsx`**

```tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { DebateEventMsg } from "@/lib/types";
import { DebateStatus } from "@/lib/debateReducer";
import { DebateMessage } from "@/components/DebateMessage";

export function DebateTimeline({
  events,
  status = "streaming",
}: {
  events: DebateEventMsg[];
  status?: DebateStatus;
}) {
  // Group events by round, preserving insertion order.
  const rounds = new Map<number, DebateEventMsg[]>();
  for (const event of events) {
    if (!rounds.has(event.round)) rounds.set(event.round, []);
    rounds.get(event.round)!.push(event);
  }
  const roundNumbers = Array.from(rounds.keys()).sort((a, b) => a - b);
  const latestRound = roundNumbers[roundNumbers.length - 1] ?? 1;

  const [activeTab, setActiveTab] = useState<number>(latestRound);
  const userSelectedRef = useRef(false);

  // Auto-follow: while streaming and the user has not manually picked a tab,
  // always show the latest round.
  useEffect(() => {
    if (status === "streaming" && !userSelectedRef.current) {
      setActiveTab(latestRound);
    }
  }, [latestRound, status]);

  function handleTabClick(round: number) {
    // Clicking the latest-round tab while streaming re-enables auto-follow.
    userSelectedRef.current = !(status === "streaming" && round === latestRound);
    setActiveTab(round);
  }

  return (
    <div className="flex flex-col gap-3" data-testid="debate-timeline">
      {roundNumbers.length > 0 && (
        <div
          className="flex gap-1 border-b border-border pb-2 overflow-x-auto"
          role="tablist"
          aria-label="Debate rounds"
        >
          {roundNumbers.map((round) => {
            const isActive = round === activeTab;
            const isLive = round === latestRound && status === "streaming";
            return (
              <button
                key={round}
                role="tab"
                aria-selected={isActive}
                data-testid={`round-tab-${round}`}
                onClick={() => handleTabClick(round)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition ${
                  isActive
                    ? "bg-surface text-foreground border border-border"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Round {round}
                {isLive && (
                  <span
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber"
                    data-testid="live-dot"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {(rounds.get(activeTab) ?? []).map((event, i) => (
          <DebateMessage key={i} event={event} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify all DebateTimeline tests pass**

```bash
cd /Users/Najum/weekforge/frontend && npm test -- DebateTimeline
```

Expected: all DebateMessage tests + all DebateTimeline tests pass.

- [ ] **Step 5: Update `frontend/app/page.tsx` to pass `status` to `DebateTimeline`**

Find the `<DebateTimeline events={state.events} />` line and change it to:

```tsx
<DebateTimeline events={state.events} status={state.status} />
```

- [ ] **Step 6: Run the full frontend suite**

```bash
cd /Users/Najum/weekforge/frontend && npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/DebateTimeline.tsx frontend/components/DebateTimeline.test.tsx frontend/app/page.tsx
git commit -m "feat(ui): round-based tabs in DebateTimeline with auto-follow"
```

---

## Task 10: Full test run + manual smoke

- [ ] **Step 1: Run the full backend suite**

```bash
cd /Users/Najum/weekforge && uv run pytest -v
```

Expected: all tests green.

- [ ] **Step 2: Run the full frontend suite**

```bash
cd /Users/Najum/weekforge/frontend && npm test
```

Expected: all tests green.

- [ ] **Step 3: Build the frontend to catch type errors**

```bash
cd /Users/Najum/weekforge/frontend && npm run build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Start backend + frontend and smoke-test**

Terminal 1:
```bash
cd /Users/Najum/weekforge && set -a && source .env && set +a && uv run weekforge-api
```

Terminal 2:
```bash
cd /Users/Najum/weekforge/frontend && npm run dev
```

Open `http://localhost:3000`. Walk through:

1. **Intake form:** verify forge cards render with colored left bars (rose for Tasks, cyan for Busy Blocks, emerald for Preferences); Preferences shows 3 instrument tiles; CTA has ember gradient and ⚒ prefix.
2. **Task fields:** add a task; click "📅 deadline" pill → turns rose + weekday select appears; click day pills → ① ember, ② amber, third click ignores.
3. **Debate:** convene → war-room layout; DebateStatusBand shows round/speaker; DebateTimeline shows tab bar with live dot on latest round; click older tab to review, latest tab to resume auto-follow; messages render Markdown (bold, bullets).
4. **Done:** forged-week calendar reveals with ember shimmer; "Add to Google Calendar" appears if Google connected.

- [ ] **Step 5: Verify `prefers-reduced-motion`**

In browser DevTools → Rendering → Emulate `prefers-reduced-motion: reduce`. Confirm no animations play, layout is intact.
