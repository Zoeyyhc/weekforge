# WeekForge Input Form — Design

**Date:** 2026-06-14
**Status:** Approved

## Goal

Replace the raw-JSON textarea in `frontend/components/TaskForm.tsx` with a structured single-page form for entering tasks, busy blocks, and preferences — keeping the exact same `onStart(req: StartDebateRequest)` contract so `page.tsx` and `useDebateStream` are untouched.

## Background

The current `TaskForm` is a single `<textarea>` holding a JSON blob of the entire `StartDebateRequest`. Users must hand-edit JSON to convene the council. This is fine for development but unfriendly for anyone actually planning a week. We replace it with structured inputs while preserving the upstream/downstream contract.

The backend (`StartDebateRequest`) accepts: `tasks[]`, `busy_blocks[]`, `preferences{}`, `max_rounds`, `require_human_on_stall`.

## Scope decisions (from brainstorming)

- **Input paradigm:** single-page structured form (no multi-step wizard, no JSON escape hatch).
- **Task fields:** core only — `title`, `estimated_minutes`, `priority`. `id` is auto-generated; `category`, `deadline`, `depends_on` are not exposed.
- **Date/time entry:** browser-native `<input type="datetime-local">`, converted to ISO-8601 on submit. No date library.
- **Sections:** Tasks, Busy blocks, Preferences. **Council settings are NOT in the UI** — `max_rounds` and `require_human_on_stall` are sent as fixed defaults.
- **Seed state:** pre-fill a small sample week on load so "Convene the council" works immediately.

## Layout

```
Your week
─────────────────────────────────────
TASKS                          [+ Add task]
  Write Q3 report      [180] min  [P1 ▾]  ✕
  Review 5 PRs         [ 90] min  [P2 ▾]  ✕

BUSY BLOCKS                    [+ Add block]
  Standup   [2026-06-15 10:00] → [11:00]  ✕

PREFERENCES
  Workday  [9] – [18]    Max focus [360] min/day

              [ Convene the council ]
```

Styling matches the existing slate/Tailwind aesthetic (rounded-lg borders, `slate-*` palette, `bg-slate-900` primary button). Error text reuses the existing `text-rose-600` pattern.

## Fields

**Task row**
- `title` — text input.
- `estimated_minutes` — number input (> 0).
- `priority` — select, values 1–4 (labelled P1–P4).
- `id` — auto-generated as `t1`, `t2`, … by index at submit time (not user-editable).

**Busy block row**
- `label` — text input.
- `start`, `end` — `<input type="datetime-local">`. Value (e.g. `2026-06-15T10:00`) converted to ISO-8601 via `new Date(value).toISOString()` on submit.

**Preferences** (inline panel, 3 number inputs)
- `workday_start_hour`, `workday_end_hour`, `max_focus_minutes_per_day`.

**Hidden defaults in the emitted payload**
- `max_rounds: 3`
- `require_human_on_stall: true`

## Component structure

Replaces the current `TaskForm.tsx`. Focused files, each with one responsibility:

- `frontend/components/TaskForm.tsx` — container. Owns draft state (`taskDrafts[]`, `busyBlockDrafts[]`, `prefs`), add/remove handlers, validation, builds the request via the pure helper, and calls `onStart`. Renders the Preferences panel inline (only 3 inputs).
- `frontend/components/TaskRow.tsx` — presentational single task row (title / minutes / priority / remove button). Props: draft + change/remove callbacks.
- `frontend/components/BusyBlockRow.tsx` — presentational single busy-block row (label / start / end / remove button). Props: draft + change/remove callbacks.
- `frontend/lib/buildRequest.ts` — pure function `buildRequest(taskDrafts, busyBlockDrafts, prefs): StartDebateRequest`. Handles `id` generation and `datetime-local → ISO` conversion. No React, unit-testable in isolation.

Draft types (local to the form layer, distinct from the API `TaskInput`/`BusyBlockInput` since drafts hold raw string field values mid-edit):

```ts
interface TaskDraft { title: string; estimatedMinutes: string; priority: number; }
interface BusyBlockDraft { label: string; start: string; end: string; } // start/end are datetime-local strings
interface PrefsDraft { workdayStartHour: string; workdayEndHour: string; maxFocusMinutes: string; }
```

## Data flow

1. Container holds drafts in `useState`, seeded with the sample week.
2. User edits rows; add/remove mutate the draft arrays.
3. On "Convene the council": container validates, then calls `buildRequest(...)` to produce a `StartDebateRequest`, then `onStart(request)`.
4. `page.tsx` / `useDebateStream` consume the request exactly as today.

## Validation

Inline, blocks submit, error shown near the offending field or above the button:
- At least one task with a non-empty title.
- Every task's `estimated_minutes` parses to a number > 0.
- For every busy block, `end` is strictly after `start`.

If validation fails, `onStart` is not called and the first error message is displayed.

## Testing

- `frontend/components/TaskForm.test.tsx` (rewrite): add a task row, fill fields, submit → `onStart` called with the expected request shape; remove a row; empty-title blocks submit and shows an error.
- `frontend/lib/buildRequest.test.ts` (new): pure transform — `id` generation (`t1`, `t2`), `datetime-local → ISO` conversion, defaults (`max_rounds: 3`, `require_human_on_stall: true`) present.
- The existing 33 tests remain green: the `onStart` contract and all other components are unchanged.

## Non-goals

- No deadline/category/dependency entry for tasks.
- No JSON editing mode.
- No council-settings UI.
- No date-picker library or timezone selector (rely on browser-native + `toISOString()`).
