# Plan B — Week Picker + Disable Past Days (frontend UX)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick which natural (Mon–Sun) week to plan via a month-calendar picker — defaulting to the current week, greying out past weeks and a current week with no schedulable days left — and disable already-passed days in each task's day-preference and deadline selectors.

**Architecture:** A new pure helper module `lib/weekWindow.ts` mirrors Plan A's now-aware window math on the client (it is the single source of "what's in the past"). A new client component `WeekPicker.tsx` renders a month grid where clicking a week-row selects that week's Monday. `weekStart` becomes React state in `page.tsx` (was a hardcoded "Monday of current week"); it drives the debate payload **and** Google import/export. `TaskForm` hosts the picker and passes the selected week + the disabled-days set down to each `TaskRow`, which greys out past day-preference chips and deadline options.

**Tech Stack:** Next.js (client components only — `"use client"`, browser `Date`, React state, Tailwind), Vitest + React Testing Library.

> **Next.js version caveat (CLAUDE.md / frontend/AGENTS.md red line):** this repo's Next.js differs from training data — read `node_modules/next/dist/docs/` before using any Next API. **This plan uses no Next server/router APIs** (pure client components + libs), so the risk is low, but still skim AGENTS.md before starting.

---

## Window rules (must match Plan A exactly)

```
earliest schedulable date = today if now is before workday_end_hour, else tomorrow   (date granularity)
week is selectable          = its Sunday >= earliest                                  (not fully past)
default week                = current week if selectable, else next week
day is "past" in a week      = that day's date < earliest
```

These live once in `lib/weekWindow.ts`. The frontend *prevents* picking past weeks/days; Plan A's backend Rule 5 *enforces* it defensively.

---

## File Structure

- **Create** `frontend/lib/weekWindow.ts` — pure date helpers (the past/window source of truth).
- **Create** `frontend/components/WeekPicker.tsx` — month-grid week selector.
- **Modify** `frontend/app/app/page.tsx` — `weekStart` state + default; pass to `TaskForm`; drive Google import/export from the selected week.
- **Modify** `frontend/components/TaskForm.tsx` — host `WeekPicker`; compute disabled days; pass selected week down; thread `weekStart` into the built request; prune now-past preferred days.
- **Modify** `frontend/components/TaskRow.tsx` — disable past day-preference chips and deadline options.
- **Modify** `frontend/lib/buildRequest.ts` — `deadlineToISO` resolves within the *selected* week.
- **Create** `frontend/lib/weekWindow.test.ts`, `frontend/components/WeekPicker.test.tsx`; **Modify** `frontend/components/TaskRow.test.tsx`, `frontend/lib/buildRequest.test.ts`.

---

## Task 1: `lib/weekWindow.ts` pure helpers

**Files:**
- Create: `frontend/lib/weekWindow.ts`
- Create: `frontend/lib/weekWindow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/lib/weekWindow.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  weekMonday, weekSunday, earliestSchedulableDate, isWeekSelectable,
  defaultWeekMonday, isPastDay, toISODate, fromISODate, monthWeeks,
} from "@/lib/weekWindow";

const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h);

describe("weekWindow", () => {
  it("weekMonday returns the Monday of the week", () => {
    expect(toISODate(weekMonday(at(2026, 6, 17)))).toBe("2026-06-15"); // Wed -> Mon 15
    expect(toISODate(weekMonday(at(2026, 6, 15)))).toBe("2026-06-15"); // Mon -> itself
  });

  it("earliest is today when before work-day end, tomorrow when after", () => {
    expect(toISODate(earliestSchedulableDate(at(2026, 6, 17, 10), 18))).toBe("2026-06-17");
    expect(toISODate(earliestSchedulableDate(at(2026, 6, 17, 20), 18))).toBe("2026-06-18");
  });

  it("current week selectable on a weekday; past week not", () => {
    const now = at(2026, 6, 17, 10);
    expect(isWeekSelectable(weekMonday(now), now, 18)).toBe(true);
    expect(isWeekSelectable(weekMonday(at(2026, 6, 10)), now, 18)).toBe(false); // last week
  });

  it("current week NOT selectable when it's Sunday past work hours", () => {
    const now = at(2026, 6, 21, 20); // Sunday 20:00
    expect(isWeekSelectable(weekMonday(now), now, 18)).toBe(false);
    expect(toISODate(defaultWeekMonday(now, 18))).toBe("2026-06-22"); // rolls to next week
  });

  it("isPastDay flags days before today in the current week, none in a future week", () => {
    const now = at(2026, 6, 17, 10); // Wed
    const thisMon = weekMonday(now);
    expect(isPastDay("Mon", thisMon, now, 18)).toBe(true);
    expect(isPastDay("Wed", thisMon, now, 18)).toBe(false);
    const nextMon = fromISODate("2026-06-22");
    expect(isPastDay("Mon", nextMon, now, 18)).toBe(false);
  });

  it("monthWeeks returns each week-row Monday covering the month", () => {
    const weeks = monthWeeks(at(2026, 6, 1)).map(toISODate);
    expect(weeks[0]).toBe("2026-06-01"); // Jun 1 is a Monday
    expect(weeks).toContain("2026-06-29");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run lib/weekWindow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `frontend/lib/weekWindow.ts`:

```ts
import { Weekday } from "@/lib/buildRequest";

const WEEKDAY_INDEX: Record<Weekday, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
};

function atMidnight(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Monday (local midnight) of the week containing `d`. */
export function weekMonday(d: Date): Date {
  const c = atMidnight(d);
  const day = (c.getDay() + 6) % 7; // 0 = Monday
  c.setDate(c.getDate() - day);
  return c;
}

/** Sunday (local midnight) of the week starting at `monday`. */
export function weekSunday(monday: Date): Date {
  const c = new Date(monday);
  c.setDate(c.getDate() + 6);
  return c;
}

/** Earliest schedulable local date (midnight): today if `now` is before the
 * work-day end hour, otherwise tomorrow (today's window is already over). */
export function earliestSchedulableDate(now: Date, workdayEndHour: number): Date {
  const today = atMidnight(now);
  if (now.getHours() + now.getMinutes() / 60 >= workdayEndHour) {
    today.setDate(today.getDate() + 1);
  }
  return today;
}

/** A natural week is selectable when it is not entirely in the past. */
export function isWeekSelectable(monday: Date, now: Date, workdayEndHour: number): boolean {
  return weekSunday(monday).getTime() >= earliestSchedulableDate(now, workdayEndHour).getTime();
}

/** The week to preselect: current week if still schedulable, else next week. */
export function defaultWeekMonday(now: Date, workdayEndHour: number): Date {
  const m = weekMonday(now);
  if (isWeekSelectable(m, now, workdayEndHour)) return m;
  const next = new Date(m);
  next.setDate(next.getDate() + 7);
  return next;
}

/** Within the week starting `monday`, is this weekday already past? */
export function isPastDay(weekday: Weekday, monday: Date, now: Date, workdayEndHour: number): boolean {
  const dayDate = new Date(monday);
  dayDate.setDate(dayDate.getDate() + WEEKDAY_INDEX[weekday]);
  return atMidnight(dayDate).getTime() < earliestSchedulableDate(now, workdayEndHour).getTime();
}

/** "YYYY-MM-DD" in local time. */
export function toISODate(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Parse "YYYY-MM-DD" to a Date at local midnight. */
export function fromISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Full ISO with the browser offset at local midnight (for Google import/export). */
export function toLocalMidnightISO(isoDate: string): string {
  const d = fromISODate(isoDate);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const h = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
  const m = String(Math.abs(off) % 60).padStart(2, "0");
  return `${toISODate(d)}T00:00:00${sign}${h}:${m}`;
}

/** The Monday of every week-row needed to display the month containing `viewMonth`. */
export function monthWeeks(viewMonth: Date): Date[] {
  const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const last = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0);
  const weeks: Date[] = [];
  let cursor = weekMonday(first);
  while (cursor.getTime() <= last.getTime()) {
    weeks.push(new Date(cursor));
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run lib/weekWindow.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/weekWindow.ts frontend/lib/weekWindow.test.ts
git commit -m "feat(fe): now-aware week-window date helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `WeekPicker.tsx` month-grid component

**Files:**
- Create: `frontend/components/WeekPicker.tsx`
- Create: `frontend/components/WeekPicker.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/components/WeekPicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WeekPicker } from "@/components/WeekPicker";

const NOW = new Date(2026, 5, 17, 10); // Wed 17 Jun 2026, 10:00

describe("WeekPicker", () => {
  it("marks the selected week row as pressed", () => {
    render(<WeekPicker value="2026-06-15" onChange={() => {}} workdayEndHour={18} now={NOW} />);
    expect(screen.getByTestId("week-row-2026-06-15")).toHaveAttribute("aria-pressed", "true");
  });

  it("disables a fully-past week", () => {
    render(<WeekPicker value="2026-06-15" onChange={() => {}} workdayEndHour={18} now={NOW} />);
    expect(screen.getByTestId("week-row-2026-06-08")).toBeDisabled();
  });

  it("selecting a future week calls onChange with its Monday", () => {
    const onChange = vi.fn();
    render(<WeekPicker value="2026-06-15" onChange={onChange} workdayEndHour={18} now={NOW} />);
    fireEvent.click(screen.getByTestId("week-row-2026-06-22"));
    expect(onChange).toHaveBeenCalledWith("2026-06-22");
  });

  it("month nav moves to the next month", () => {
    render(<WeekPicker value="2026-06-15" onChange={() => {}} workdayEndHour={18} now={NOW} />);
    fireEvent.click(screen.getByLabelText("Next month"));
    expect(screen.getByText(/July 2026/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run components/WeekPicker.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `WeekPicker`**

Create `frontend/components/WeekPicker.tsx`:

```tsx
"use client";

import { useState } from "react";
import {
  fromISODate, toISODate, isWeekSelectable, monthWeeks,
} from "@/lib/weekWindow";

const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function WeekPicker({
  value,
  onChange,
  workdayEndHour,
  now = new Date(),
}: {
  value: string; // selected Monday, "YYYY-MM-DD"
  onChange: (mondayISO: string) => void;
  workdayEndHour: number;
  now?: Date;
}) {
  const selected = fromISODate(value);
  const [viewMonth, setViewMonth] = useState(
    () => new Date(selected.getFullYear(), selected.getMonth(), 1),
  );
  const weeks = monthWeeks(viewMonth);

  const shift = (delta: number) =>
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  return (
    <div data-testid="week-picker" className="rounded-xl border border-[#272430] bg-[#101219] p-3">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label="Previous month" onClick={() => shift(-1)}
          className="px-2 text-muted hover:text-ember">◀</button>
        <span className="font-mono text-xs uppercase tracking-wider text-muted">
          {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
        </span>
        <button type="button" aria-label="Next month" onClick={() => shift(1)}
          className="px-2 text-muted hover:text-ember">▶</button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1 text-center font-mono text-[10px] text-[#4a4845]">
        {DOW.map((d) => <span key={d}>{d}</span>)}
      </div>

      <div className="flex flex-col gap-1">
        {weeks.map((monday) => {
          const iso = toISODate(monday);
          const selectable = isWeekSelectable(monday, now, workdayEndHour);
          const isSelected = iso === value;
          return (
            <button
              key={iso}
              type="button"
              data-testid={`week-row-${iso}`}
              disabled={!selectable}
              aria-pressed={isSelected}
              onClick={() => onChange(iso)}
              className={`grid grid-cols-7 gap-1 rounded-md border px-1 py-1 text-center text-[11px] transition-colors ${
                isSelected
                  ? "border-ember/60 bg-ember/20 text-ember"
                  : selectable
                  ? "border-[#272430] text-muted hover:border-ember/40"
                  : "border-transparent text-[#3a3530] opacity-40 cursor-not-allowed"
              }`}
            >
              {Array.from({ length: 7 }, (_, i) => {
                const day = new Date(monday);
                day.setDate(day.getDate() + i);
                const inMonth = day.getMonth() === viewMonth.getMonth();
                return (
                  <span key={i} className={inMonth ? "" : "opacity-40"}>
                    {day.getDate()}
                  </span>
                );
              })}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run components/WeekPicker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/WeekPicker.tsx frontend/components/WeekPicker.test.tsx
git commit -m "feat(fe): month-grid WeekPicker (past weeks disabled)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wire `weekStart` state + picker through `page.tsx` and `TaskForm`

The selected week now drives the debate payload AND Google import/export.

**Files:**
- Modify: `frontend/app/app/page.tsx`
- Modify: `frontend/components/TaskForm.tsx`

- [ ] **Step 1: `weekStart` becomes state in `page.tsx`**

In `frontend/app/app/page.tsx`:

1. Add imports:

```tsx
import { defaultWeekMonday, toISODate, toLocalMidnightISO } from "@/lib/weekWindow";
```

2. Replace `const weekStart = currentWeekStart();` with:

```tsx
  const [weekStart, setWeekStart] = useState(() => toISODate(defaultWeekMonday(new Date(), 18)));
```

3. Replace every `currentWeekStartLocal()` call (the Google import at ~line 132 and the export `onExport` at ~line 265) with `toLocalMidnightISO(weekStart)`, so import/export follow the selected week. You may then delete the now-unused `currentWeekStart` and `currentWeekStartLocal` functions (keep `mondayLocal` only if still referenced; otherwise remove it too).

4. Find where `<TaskForm ... onSubmit={handleStart} />` is rendered and add two props:

```tsx
          weekStart={weekStart}
          onWeekChange={setWeekStart}
```

`handleStart` already does `week_start: weekStart` — leave it.

- [ ] **Step 2: `TaskForm` hosts the picker + computes disabled days**

In `frontend/components/TaskForm.tsx`:

1. Add imports:

```tsx
import { WeekPicker } from "@/components/WeekPicker";
import { fromISODate, isPastDay } from "@/lib/weekWindow";
```

2. Extend the component's props to accept `weekStart` and `onWeekChange` (add to the existing props type/destructure):

```tsx
  weekStart,
  onWeekChange,
}: {
  // ...existing props...
  weekStart: string;
  onWeekChange: (mondayISO: string) => void;
})
```

3. Compute the disabled days for the selected week (uses the prefs draft's work-day end). Place near the top of the component body, after `prefs` state exists:

```tsx
  const DAYS_ALL: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const workdayEnd = Number(prefs.workdayEndHour) || 18;
  const disabledDays: Weekday[] = DAYS_ALL.filter((d) =>
    isPastDay(d, fromISODate(weekStart), new Date(), workdayEnd),
  );
```

4. Render the picker at the top of the intake form (e.g. just inside the tasks step, before the task rows):

```tsx
      <WeekPicker value={weekStart} onChange={onWeekChange} workdayEndHour={workdayEnd} />
```

5. Pass `disabledDays` and `weekStart` to each `<TaskRow ... />` (Task 4 consumes them):

```tsx
          disabledDays={disabledDays}
          weekStart={weekStart}
```

6. Prune now-past preferred days when the week changes — add an effect:

```tsx
  React.useEffect(() => {
    setTasks((prev) =>
      prev.map((t) =>
        t.preferredDays.some((d) => disabledDays.includes(d))
          ? { ...t, preferredDays: t.preferredDays.filter((d) => !disabledDays.includes(d)) }
          : t,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, prefs.workdayEndHour]);
```

(Use whatever the tasks state setter is actually named in this file.)

- [ ] **Step 3: Run the frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS. (Existing `TaskForm` tests may need the two new required props — if a test renders `<TaskForm>` directly, add `weekStart="2026-06-15"` and `onWeekChange={() => {}}`. If that breaks several tests, make the props optional with sensible defaults instead.)

- [ ] **Step 4: Commit**

```bash
git add frontend/app/app/page.tsx frontend/components/TaskForm.tsx
git commit -m "feat(fe): selected week drives debate payload, import/export, and day-disabling

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Disable past days in `TaskRow` (preference chips + deadline) and resolve deadlines in the selected week

**Files:**
- Modify: `frontend/components/TaskRow.tsx`
- Modify: `frontend/lib/buildRequest.ts`
- Modify: `frontend/components/TaskRow.test.tsx`, `frontend/lib/buildRequest.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/components/TaskRow.test.tsx` (import what the file already imports for rendering a row; add a `disabledDays` prop):

```tsx
it("disables a past preferred-day chip and ignores clicks on it", () => {
  const onChange = vi.fn();
  render(
    <TaskRow
      draft={{ id: "d1", title: "T", estimatedMinutes: "60", priority: 2,
               hasDeadline: false, deadlineWeekday: "Fri", preferredDays: [], remark: "" }}
      onChange={onChange}
      onRemove={() => {}}
      disabledDays={["Mon", "Tue"]}
      weekStart="2026-06-15"
    />,
  );
  const monPill = screen.getByTestId("day-pill-Mon");
  expect(monPill).toBeDisabled();
  fireEvent.click(monPill);
  expect(onChange).not.toHaveBeenCalled();
});

it("leaves a future day clickable", () => {
  const onChange = vi.fn();
  render(
    <TaskRow
      draft={{ id: "d1", title: "T", estimatedMinutes: "60", priority: 2,
               hasDeadline: false, deadlineWeekday: "Fri", preferredDays: [], remark: "" }}
      onChange={onChange}
      onRemove={() => {}}
      disabledDays={["Mon", "Tue"]}
      weekStart="2026-06-15"
    />,
  );
  fireEvent.click(screen.getByTestId("day-pill-Thu"));
  expect(onChange).toHaveBeenCalledWith({ preferredDays: ["Thu"] });
});
```

Append to `frontend/lib/buildRequest.test.ts`:

```ts
it("resolves a deadline within the selected (future) week", () => {
  const req = buildRequest(
    [{ id: "d1", title: "T", estimatedMinutes: "60", priority: 1, hasDeadline: true,
       deadlineWeekday: "Fri", preferredDays: [], remark: "" }],
    [], { workdayStartHour: "9", workdayEndHour: "18", maxFocusMinutes: "360" },
    "2026-06-22", // selected week = 22–28 Jun
  );
  // Friday of that week is 2026-06-26
  expect(req.tasks[0].deadline!.startsWith("2026-06-26")).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run components/TaskRow.test.tsx lib/buildRequest.test.ts`
Expected: FAIL — `TaskRow` has no `disabledDays` prop; `buildRequest` has no `weekStart` arg.

- [ ] **Step 3a: Disable past chips + deadline options in `TaskRow`**

In `frontend/components/TaskRow.tsx`:

1. Extend the props:

```tsx
export function TaskRow({
  draft,
  onChange,
  onRemove,
  disabledDays = [],
  weekStart,
}: {
  draft: TaskDraft;
  onChange: (patch: Partial<TaskDraft>) => void;
  onRemove: () => void;
  disabledDays?: Weekday[];
  weekStart?: string;
}) {
```

2. Guard `handleDayClick`:

```tsx
  function handleDayClick(day: Weekday) {
    if (disabledDays.includes(day)) return;
    const idx = draft.preferredDays.indexOf(day);
    if (idx >= 0) {
      onChange({ preferredDays: draft.preferredDays.filter((d) => d !== day) });
    } else if (draft.preferredDays.length < 2) {
      onChange({ preferredDays: [...draft.preferredDays, day] });
    }
  }
```

3. In the prefer-chips `DAYS.map`, mark disabled chips. Add `const isDisabled = disabledDays.includes(day);` inside the map and apply to the button:

```tsx
                <button
                  key={day}
                  type="button"
                  data-testid={`day-pill-${day}`}
                  disabled={isDisabled}
                  onClick={() => handleDayClick(day)}
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-all ${
                    isDisabled
                      ? "border-transparent bg-[#0f1014] text-[#2c2a28] opacity-40 cursor-not-allowed line-through"
                      : isFirst
                      ? "scale-105 border-ember/60 bg-ember/30 text-ember shadow-[0_0_8px_rgba(255,107,53,0.3)]"
                      : isSecond
                      ? "border-amber/50 bg-amber/25 text-amber"
                      : "border-[#272430] bg-[#14161d] text-[#4a4845] hover:text-muted"
                  }`}
                >
```

4. In the deadline-weekday `<select>` (the `DAYS.map` that renders `<option>`s), disable past options:

```tsx
                <option key={d} value={d} disabled={disabledDays.includes(d)} className="bg-[#16191f]">
                  {d}
                </option>
```

- [ ] **Step 3b: Resolve deadlines within the selected week in `buildRequest.ts`**

In `frontend/lib/buildRequest.ts`, change `deadlineToISO` to take the selected week's Monday, and thread it through `buildRequest`:

```ts
/** ISO datetime of `weekday` at 23:59 local within the week starting `mondayISO` ("YYYY-MM-DD"). */
function deadlineToISO(weekday: Weekday, mondayISO: string): string {
  const [y, m, d] = mondayISO.split("-").map(Number);
  const target = new Date(y, m - 1, d);          // selected week's Monday
  target.setDate(target.getDate() + WEEKDAY_INDEX[weekday]);
  target.setHours(23, 59, 0, 0);
  return target.toISOString();
}

export function buildRequest(
  tasks: TaskDraft[],
  busyBlocks: BusyBlockDraft[],
  prefs: PrefsDraft,
  weekStart: string,
): StartDebateRequest {
  return {
    tasks: tasks.map((t, i) => ({
      // ...
      deadline: t.hasDeadline ? deadlineToISO(t.deadlineWeekday, weekStart) : null,
      // ...
    })),
    // ...rest unchanged
  };
}
```

Then update the **single** call site in `TaskForm.tsx` to pass `weekStart`:

```tsx
    const req = buildRequest(tasks, busyBlocks, prefs, weekStart);
```

(Find the existing `buildRequest(tasks, busyBlocks, prefs)` call in `TaskForm.tsx` and add the 4th argument.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run`
Expected: PASS — new TaskRow + buildRequest tests green, existing suite green. (If an existing `buildRequest` test called it with 3 args, update that call to pass a `weekStart` like `"2026-06-15"`.)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/TaskRow.tsx frontend/lib/buildRequest.ts frontend/components/TaskRow.test.tsx frontend/lib/buildRequest.test.ts
git commit -m "feat(fe): disable past days in preference + deadline selectors; deadlines resolve in selected week

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Full frontend suite: `cd frontend && npx vitest run`. Expected: all green.
- [ ] Lint/build sanity (per repo norm): `cd frontend && npm run lint` (and `npm run build` if quick). Expected: no new errors.
- [ ] Manual smoke (optional): `npm run dev`, confirm the picker defaults to the current week, past weeks are greyed, picking next week updates the planned week, and past day-chips are greyed/non-clickable.

---

## Self-Review notes (author)

- **Coverage:** week selection → Tasks 2–3; default-to-next-when-current-week-used-up → Task 1 (`defaultWeekMonday`) + Task 2; disable past weeks → Task 2; disable past preference days → Task 4; disable past deadline days + resolve deadline in selected week → Task 4; selected week drives import/export → Task 3.
- **Consistency with Plan A:** `lib/weekWindow.ts` uses the same rule (`earliest = today if before workday_end else tomorrow`; `selectable = sunday >= earliest`) as Plan A's `compute_week_window`, so the UI never offers a week/day the backend Rule 5 would reject.
- **Type consistency:** `Weekday` imported from `buildRequest`; `WeekPicker` props `{ value, onChange, workdayEndHour, now? }`; `TaskRow` gains `disabledDays?`, `weekStart?`; `buildRequest(tasks, busy, prefs, weekStart)`.
- **Risk:** existing tests that construct `<TaskForm>` / call `buildRequest(...)` with the old arity must be updated (called out in Task 3 Step 3 and Task 4 Step 4). No backend changes.
- **Next.js:** client-only; no server/router APIs touched (AGENTS.md caveat noted but not triggered).
```
