# WeekForge Visual Week Calendar — Design

**Date:** 2026-06-14
**Status:** Approved

## Goal

Replace the flat-list `ScheduleView` with a time-grid week calendar so "The forged week" output looks like a real calendar, not a bullet list. The calendar is a **read-only output view** — blocks come from the debate result, not from user interaction.

## Background

The current `ScheduleView` renders `TimeBlock[]` as a plain list grouped by day (label + time range text per row). It works but undersells the output — a week of AI-scheduled blocks deserves a visual week grid. The upstream contract (`schedule: Schedule` prop, `page.tsx` untouched) must not change.

The backend returns:
```ts
interface Schedule {
  week_start: string | null;
  blocks: TimeBlock[];          // each has start, end (ISO), label, task_id
}
```

## Decisions (from brainstorming)

- **Layout:** Time-grid week view (react-big-calendar week view) — vertical time axis, day columns, blocks sized by duration. Looks like Google Calendar.
- **Color scheme:** Rainbow by index — blocks cycle through a 5-color palette (rose → indigo → emerald → violet → orange). Color is decorative, not semantic.
- **Time range:** Dynamic — window spans `min(block.start) − 30 min` to `max(block.end) + 30 min`. Always fits the data, never clips.
- **Interactivity:** None — read-only. No click-to-edit, no navigation arrows, no drag-and-drop.
- **Google Calendar sync:** Out of scope. This spec covers display only; sync is a separate future spec.

## Component Structure

Three focused files. `page.tsx` and `useDebateStream` are **not touched**.

### `frontend/lib/calendarEvents.ts` (new)

Pure transform: `TimeBlock[] → CalendarEvent[]`. No React. Fully unit-testable.

```ts
import { TimeBlock } from "@/lib/types";

const PALETTE = ["#f43f5e", "#6366f1", "#10b981", "#8b5cf6", "#f97316"];
// rose-500 / indigo-500 / emerald-500 / violet-500 / orange-500

export interface CalendarEvent {
  title: string;
  start: Date;
  end: Date;
  color: string;
}

export function toCalendarEvents(blocks: TimeBlock[]): CalendarEvent[] {
  return blocks.map((b, i) => ({
    title: b.label,
    start: new Date(b.start),
    end: new Date(b.end),
    color: PALETTE[i % PALETTE.length],
  }));
}

export function calendarRange(blocks: TimeBlock[]): { min: Date; max: Date } | null {
  if (blocks.length === 0) return null;
  const starts = blocks.map((b) => new Date(b.start).getTime());
  const ends   = blocks.map((b) => new Date(b.end).getTime());
  const THIRTY = 30 * 60 * 1000;
  return {
    min: new Date(Math.min(...starts) - THIRTY),
    max: new Date(Math.max(...ends)   + THIRTY),
  };
}
```

### `frontend/components/WeekCalendar.tsx` (new)

Wraps `react-big-calendar` in week view. Receives `schedule: Schedule`.

Key implementation details:
- Localizer: `dateFnsLocalizer` from `react-big-calendar/lib/localizers/date-fns` with `date-fns` locale
- View: `"week"` (fixed, no toolbar so no navigation arrows)
- `eventPropGetter`: returns `{ style: { backgroundColor: event.color, borderColor: event.color } }` for each block
- `min` / `max`: from `calendarRange()` — passes computed Date objects to RBC
- Empty state: if `schedule.blocks` is empty, renders the existing `<p data-testid="schedule-empty">` message instead of the calendar
- RBC CSS: imported at the top of this file via `import "react-big-calendar/lib/css/react-big-calendar.css"`

Props:
```ts
interface WeekCalendarProps {
  schedule: Schedule;
}
```

### `frontend/components/ScheduleView.tsx` (modified)

Current implementation replaced with a re-export of `WeekCalendar` under the same name, preserving the `page.tsx` import unchanged:

```ts
export { WeekCalendar as ScheduleView } from "@/components/WeekCalendar";
```

`groupBlocksByDay` and `formatTimeRange` in `frontend/lib/format.ts` become unused — they are deleted.

## Dependencies

```bash
npm install react-big-calendar date-fns
npm install --save-dev @types/react-big-calendar
```

- `react-big-calendar`: MIT, peer dep `react >= 16.14` (satisfied by React 19)
- `date-fns`: MIT, tree-shakeable, no side effects

## Data Flow

```
page.tsx
  └─ ScheduleView (re-export of WeekCalendar)
       ├─ toCalendarEvents(schedule.blocks)  →  CalendarEvent[]
       ├─ calendarRange(schedule.blocks)     →  { min, max } | null
       └─ <Calendar> (react-big-calendar)
            └─ eventPropGetter applies block.color inline
```

No state. No side effects. Pure render.

## Styling

RBC's default stylesheet provides the grid structure (time axis, day headers, slot lines). We apply two overrides:

1. **Event colors**: inline via `eventPropGetter` — `backgroundColor` and `borderColor` set to the palette color. Text color always `#fff`.
2. **Chrome thinning**: a small CSS block (in `WeekCalendar.tsx` via a `<style>` tag or a co-located `.css` file) to set the day-header font to match the existing `slate` palette and remove RBC's default blue today-highlight.

The calendar is wrapped in a `rounded-xl border border-slate-200` container to match the existing card style.

## Testing

### `frontend/lib/calendarEvents.test.ts` (new, 4 tests)

1. `toCalendarEvents` maps `TimeBlock.label` → `title`
2. `toCalendarEvents` parses ISO strings to `Date` objects (`start`/`end`)
3. Color palette cycles — index 0 = rose, index 5 wraps back to rose
4. `calendarRange` returns null for empty array; returns min−30min / max+30min for a given set of blocks

### `frontend/components/WeekCalendar.test.tsx` (new, 2 tests)

1. Renders block labels in the DOM given a `schedule` with 2 blocks
2. Renders the empty-state message when `schedule.blocks` is empty

### Existing `ScheduleView.test.tsx` (modified)

The existing test file checks for day-header text ("Monday, Jun 15") and formatted time strings ("09:00 AM – 11:00 AM") that come from the old flat-list implementation. These assertions will no longer hold after the replacement.

The file is updated to match the new contract — two tests remain:
1. Block labels appear in the DOM (unchanged assertion)
2. Empty-state message appears (unchanged assertion)

The day-header and time-format assertions are removed (those details are now RBC's responsibility, not ours to test).

**Note on jsdom + react-big-calendar:** RBC relies on DOM layout APIs (`getBoundingClientRect`, etc.) that jsdom stubs out. This can cause RBC to render events as hidden or zero-height in tests. To avoid flaky tests, `WeekCalendar.test.tsx` mocks `react-big-calendar` with a lightweight stub that renders event titles as plain `<div>` elements. The mock is scoped to the test file via `vi.mock`.

## Non-Goals

- No week navigation (prev/next) — show only the council's output week.
- No click/drag interaction on events.
- No timezone selector (format.ts already uses UTC; RBC will interpret Date objects in local time — acceptable for a prototype).
- No mobile responsive layout.
- No Google Calendar sync (separate future spec).
