# WeekForge — Task Fields, Intake UI Redesign & Debate UX — Design Spec

> **Date:** 2026-06-15 · **Status:** Approved design, pre-implementation
> **Scope:** Three independent feature areas — all frontend + light backend changes.
> No deployment changes. No auth/billing.

---

## 1. Goals

1. **Richer task input** — planner can mark a deadline weekday and set a 1st/2nd preferred scheduling day per task, so the council receives real constraints rather than guessing.
2. **More engaging intake form** — replace the flat dark form with a "forge table" layout: each section lives in a glowing card, inputs use underlines not boxes, the CTA button becomes a visual terminus.
3. **Faster, more readable debate** — word-count caps keep each debater concise; Markdown rendering makes structured responses legible; round-based tabs let the planner jump between rounds without scrolling.

---

## 2. Feature 1 — Task Fields: Deadline Weekday + Preferred Days

### 2.1 Backend: `Task` model extension

Add one optional field to `weekforge/models.py`:

```python
preferred_days: list[str] | None = None
# ["Wed", "Fri"] — first element is 1st choice, second is 2nd choice
# Weekday abbreviations: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"
```

`deadline: datetime | None` already exists and is unchanged. The frontend converts the planner's weekday selection to a real datetime before sending.

### 2.2 Backend: context formatting (`nodes.py`)

`_fmt_tasks()` appends both constraints when present:

```
- [t1] Review pull requests (90min, priority 2, deadline Thu 19 Jun, prefer: 1st Wed · 2nd Fri)
```

All council prompt entry points (`gather_proposals`, `critique`, `arbitrate`) read tasks via `_fmt_tasks()`, so no other node changes are needed.

### 2.3 API schema

`StartDebateRequest.tasks` is already `list[Task]`, so `preferred_days` is automatically included in the request body. No schema changes required.

### 2.4 Frontend: `TaskDraft` extension (`buildRequest.ts`)

```ts
export interface TaskDraft {
  id: string;
  title: string;
  estimatedMinutes: string;
  priority: number;
  hasDeadline: boolean;        // toggle: is there a deadline?
  deadlineWeekday: string;     // "Mon" | "Tue" | … | "Sun" — active when hasDeadline=true
  preferredDays: string[];     // ordered, max 2 elements: [firstChoice, secondChoice]
}
```

**Deadline conversion in `buildRequest()`:** `deadlineWeekday` → the ISO datetime of that weekday at 23:59 local time in the current week. This is a pure function, independently testable. Result maps to `TaskInput.deadline`.

**`preferredDays`** maps directly to `TaskInput.preferred_days` (snake_case per the API contract). `TaskInput` in `frontend/lib/types.ts` must be extended with `preferred_days?: string[] | null` to carry this field to the backend.

Default `TaskDraft` (for new tasks and seed tasks): `hasDeadline: false`, `deadlineWeekday: "Fri"`, `preferredDays: []`.

### 2.5 Frontend: `TaskRow` UI

Three logical rows per task:

**Row 1 (existing):** title input · time estimate · priority select · remove button

**Row 2 (new):** deadline pill-button (grey when off → click turns rose + reveals weekday `<select>` for Mon–Sun)

**Row 3 (conditional, shown when preferredDays interaction started or non-empty):** Seven day pills — `Mon Tue Wed Thu Fri Sat Sun`. Interaction:
- First click → pill becomes ember ①
- Second click on a different pill → that pill becomes amber ②
- Click on a selected pill → deselects it and shifts remaining selection up
- Max two pills selected at once

### 2.6 Testing

- **`buildRequest.test.ts`:** Pure function test: given `hasDeadline: true, deadlineWeekday: "Thu"`, output `deadline` falls on Thursday of the current week at 23:59 local.
- **`TaskRow.test.tsx`:** Deadline toggle shows/hides weekday select; clicking two day pills produces correct `preferredDays` order; clicking a selected pill deselects it.
- **`tests/test_models.py`:** `Task` with `preferred_days=["Wed", "Fri"]` round-trips through Pydantic validation.
- **`tests/debate/test_nodes.py`:** `_fmt_tasks()` with a task that has deadline and preferred_days includes both in the formatted string.

---

## 3. Feature 2 — Intake Form UI Redesign ("Forge Table")

### 3.1 Design direction

Each of the three sections (Tasks, Busy Blocks, Preferences) becomes a standalone **forge card**: `bg-surface` background, `rounded-xl`, subtle `box-shadow`, and a **2px gradient top strip** that signals the section's character:

| Section | Top strip gradient | Rationale |
|---|---|---|
| ⚔ Tasks | rose → orange | Deadline Hawk's urgency |
| 🗓 Busy Blocks | cyan → indigo | Calendar/commitment feel |
| ⚙ Preferences | emerald → cyan | Energy/rhythm feel |

### 3.2 Input style

Replace bordered input boxes with **underline inputs**: `border-0 border-b border-border bg-transparent focus:border-ember outline-none`. Lighter visual weight, integrates with the card surface rather than fighting it.

### 3.3 Section headers

- Emoji prefix: ⚔ Tasks / 🗓 Busy Blocks / ⚙ Preferences
- Color: `text-foreground` (not `slate-500` as today)
- Font: `text-xs font-bold uppercase tracking-widest`
- "＋ Add" button: `text-ember underline` style, right-aligned

### 3.4 Deadline + preferred-day visual treatment in TaskRow

- **Deadline pill:** small rounded button, default `bg-surface border border-border text-muted`. When `hasDeadline=true`: `bg-rose-950/40 border-rose-400/60 text-rose-300`. Weekday `<select>` appears inline after the pill.
- **Day pills:** `Mon Tue Wed Thu Fri Sat Sun` in a single flex row below. Default: `bg-surface text-muted border border-border`. ① selected: `bg-ember/20 text-ember border-ember/50` with `①` prefix. ② selected: `bg-amber/15 text-amber border-amber/40` with `②` prefix.

### 3.5 "Convene the Council" CTA

- Full-width button
- `bg-gradient-to-br from-ember to-amber`
- `text-[#1a0e00] font-black uppercase tracking-widest text-sm`
- `shadow-[0_4px_24px_rgba(255,107,53,0.35)]`
- Becomes the undeniable visual endpoint of the form

### 3.6 Files changed

- `frontend/components/TaskForm.tsx` — card wrapper structure, section styles, CTA
- `frontend/components/TaskRow.tsx` — new deadline + preferred-day UI rows, underline inputs
- `frontend/components/BusyBlockRow.tsx` — underline input style to match

### 3.7 Testing

Existing `TaskForm.test.tsx`, `TaskRow.test.tsx`, `BusyBlockRow.test.tsx` stay green (testids and props unchanged). Visual polish verified by manual smoke.

---

## 4. Feature 3 — Debate UX: Word-Count Caps + Markdown + Round Tabs

### 4.1 Word-count caps (backend `debaters.py`)

Append a hard instruction to each CrewAI task `description`:

| Method | Instruction appended | Limit |
|---|---|---|
| `propose()` | `"Limit your response to 150 words."` | 150 words |
| `critique()` | `"Limit your response to 100 words."` | 100 words |
| `arbitrate()` | _(no limit added)_ | Unlimited — JSON output must not be truncated |

No architectural changes — purely prompt engineering.

### 4.2 Markdown rendering (frontend `DebateMessage.tsx`)

Add `react-markdown` as a dependency. Replace:

```tsx
<p className="whitespace-pre-wrap text-sm leading-relaxed">{event.content}</p>
```

with a `<ReactMarkdown>` component scoped to `text-sm leading-relaxed` prose styles. Apply minimal component overrides: `ul`/`ol` with left padding, `strong` bold, `h3`/`h4` slightly larger with bottom margin. No full Tailwind typography plugin needed.

Debater output naturally uses `**bold**`, `- bullet lists`, and `### headings`; rendering them improves readability significantly.

### 4.3 Round-based tabs (frontend `DebateTimeline.tsx`)

**Interface change:** `DebateTimeline` accepts a new optional prop `status: DebateStatus` (defaults to `"streaming"` for backwards compatibility with existing tests).

**Internal grouping:** events are grouped by `round` into a `Map<number, DebateEventMsg[]>`.

**Tab bar:** One tab per round — `Round 1`, `Round 2`, etc. The active streaming round shows an amber pulse dot to its right. Tabs appear as soon as round 1 has at least one event.

**Auto-follow:** while `status === "streaming"` and the user has not manually clicked a tab, `activeTab` automatically follows the latest round. Once the user clicks any tab, auto-follow stops (tracked via a `userSelectedTab` ref). Auto-follow resumes only when the user clicks the latest-round tab.

**Tab content:** all `DebateEventMsg` for that round, rendered via the existing `DebateMessage` component. `RoundDivider` is omitted inside tabs (the tab itself is the divider).

**`page.tsx`:** pass `status={state.status}` to `<DebateTimeline>`.

### 4.4 Testing

- **`DebateTimeline.test.tsx`:** multi-round event array renders correct number of tabs; clicking a tab renders only that round's messages; while streaming and no manual selection, active tab tracks latest round.
- **`DebateMessage.test.tsx`:** `**bold**` content renders `<strong>` element (not raw asterisks).
- Existing timeline/message tests stay green.

### 4.5 New dependency

`react-markdown` — add to `frontend/package.json`. No other new dependencies.

---

## 5. Out of Scope

- Re-planning across weeks (carrying debate history forward).
- `preferred_days` enforcement beyond prompt formatting (no hard scheduling constraint engine).
- User-adjustable word-count slider in the UI (backend prompt constants are sufficient for v1).
- Syntax highlighting in Markdown (no code blocks expected in debate output).
- Drag-to-reorder preferred days (click-to-rank ① ② is sufficient).
- Saving task templates or recurring tasks.

---

## 6. Implementation Order

These three features are independent and can be built in parallel or in any order. Suggested sequence for a single-agent implementation:

1. Backend model + `_fmt_tasks()` (small, unlocks full-stack testing of new fields)
2. Frontend `TaskDraft` + `buildRequest` conversion + `TaskRow` new fields
3. Intake form UI reskin (`TaskForm`, `BusyBlockRow`)
4. `debaters.py` word-count caps (trivial)
5. `react-markdown` + `DebateMessage` update
6. `DebateTimeline` round tabs
7. Full test run + manual smoke
