# WeekForge — UI Polish (Crucible Identity + War-Room Layout) — Design Spec

> **Date:** 2026-06-15 · **Status:** Approved design, pre-implementation
> **Scope:** Frontend visual identity + layout + debate-status + Google Calendar UI
> wiring. No backend changes. Deployment is a separate later phase.
> **Implementation note:** built with the `frontend-design` skill for visual polish.

---

## 1. Goal

Make WeekForge feel like a finished product, with the **visible participatory debate**
as the centerpiece. Give it a cohesive identity (the "Crucible" theme), a two-column
"war room" that shows the council, the live debate, and the forged week together, a
prominent **round + who's-speaking** status, and wire the already-shipped Google Calendar
endpoints (connect, multi-calendar import, export) into the UI.

The structured intake form (`TaskForm` + `TaskRow` + `BusyBlockRow`) already exists and
replaced the old JSON box — it is restyled, not rebuilt.

## 2. Decisions (locked via visual brainstorming)

- **Identity:** Crucible **forge-dark** — charcoal canvas, molten ember/amber accents,
  agents glow on dark.
- **Layout:** **two-column war room** (left rail: council + forged week; right: live
  debate). Stacks to single column below `md`.
- **Debate status:** BOTH a **status band** (round counter + segmented progress +
  "now speaking" banner, atop the right column) AND a **glowing roster** (active speaker
  lights up in the left rail; others dim with their last action).
- **Truthful state only:** round, active speaker, and per-agent last action are derived
  from real backend events (`round`, `speaker`, `event_type`) + `max_rounds`. No
  speculative "typing…" indicator — the active speaker is the most recent event's speaker.
- **Agent palette (on dark):** Deadline Hawk rose `#fb7185`, Energy Guardian emerald
  `#34d399`, Focus Batcher **cyan** (e.g. `#22d3ee`), Arbiter violet `#a78bfa`,
  Human slate, System muted.
- **Emphasis:** debate-centered balanced polish — identity everywhere, debate is the
  hero, Google flow wired, everything else clean.

## 3. Visual identity (Crucible dark)

- **Tokens** in `app/globals.css` (CSS variables + Tailwind `@theme`): background `#0f1115`,
  surface `#16191f`, border `#2a2620`, text primary `#e7e3da`, text muted `#8a8578`,
  accent ember `#ff6b35`, accent amber `#f5a623` (ember→amber gradient for "forged"
  highlights), plus the agent colors above.
- **Typography:** a strong display weight for the `WEEKFORGE` wordmark; clean sans for body.
- **Texture:** restrained — a subtle vignette/grain is optional, must not reduce legibility.
- `agents.ts` `AgentMeta` palette is updated to the dark tokens (label/emoji/color/ring
  preserved as the existing contract; values re-tuned for dark).

## 4. Layout & phases (`app/page.tsx`)

- **Header:** `WEEKFORGE` wordmark + a run-status badge (Ready / Debating… / Awaiting you /
  Decided / Error) with smooth transitions.
- **idle:** the intake form, restyled dark. The busy-blocks section hosts the Google
  connect/import affordances (§6).
- **streaming / interrupted / done:** two columns —
  - **Left rail:** the `CouncilRoster` (live per-agent state) and, on `done`, the
    forged-week panel (`WeekCalendar`).
  - **Right column:** the `DebateStatusBand` atop the `DebateTimeline` transcript.
  - **interrupted:** the `InterventionPanel` appears as a **spotlight** — the rest of the
    screen dims to focus the user's decision.
- **Responsive:** below `md` the two columns stack (roster/status → transcript → week),
  preserving order of importance.

## 5. Debate status (round + speaker) — derived, testable

- A **pure selector** over the reducer's `events[]` computes a `DebateProgress` view:
  - `currentRound` = the round of the latest event (clamped to `[1, maxRounds]`).
  - `maxRounds` = from the start request (thread through `useDebateStream` / page state).
  - `activeSpeaker` = the speaker of the most recent event while `status === "streaming"`;
    null when interrupted/done.
  - `rosterState` = for each agent, its latest `{ event_type, round }` (or "waiting").
- Components:
  - **`DebateStatusBand`** (right column): `ROUND n / max`, a segmented progress bar, and
    a "now speaking" banner (agent emoji/label + a short live caption from the latest
    event, with an animated pulse). On done: "Decided"; on interrupted: "Awaiting you".
  - **`CouncilRoster`** (left rail): one row per agent; the active speaker glows
    (ring + raised surface), others dim and show their last action
    (proposed ✓ / critiqued / decided / waiting).
- This selector is the unit-test seam; the band and roster are render-tested.

## 6. Google Calendar UI wiring (consumes the shipped endpoints)

- **`useGoogleCalendar` hook** + `api.ts` helpers for: `GET /auth/google/status`,
  navigate to `GET /auth/google/login`, `GET /calendar/google/calendars`,
  `GET /calendar/google/busy?week_start&calendar_ids…`, `POST /calendar/google/export`,
  `POST /auth/google/disconnect`.
- **In the intake (busy-blocks area):**
  - **`GoogleConnect`** — shows "Connect Google Calendar" when disconnected (full-page
    navigation to the login route, per OAuth), connected state + disconnect otherwise.
  - **`CalendarPicker`** — once connected, checkboxes from `list_calendars`
    (primary `selected_by_default`); WeekForge is already excluded server-side.
  - **`ImportPreview`** — "Import this week" pulls busy blocks for the chosen week +
    selected calendars into editable/removable rows, merged with manually-entered blocks
    before `POST /debate`.
- **On the forged-week panel:** **`ExportButton`** — "Add to Google Calendar" posts the
  forged blocks, shows a written-count confirmation + a link into Google Calendar; re-export
  replaces (handled server-side). Clear error + retry on failure (e.g. auth expired).
- **Graceful absence:** if `status` reports not-configured/not-connected, the connect CTA
  is shown and import/export simply aren't offered — the app works fully without Google.

## 7. Delight (all respect `prefers-reduced-motion`)

- Staggered fade-and-rise entrance for new debate messages.
- Ember-ruled `Round N` dividers in the transcript.
- A one-time "forged" ember-shimmer reveal when the schedule lands.
- The intervention spotlight (dim-the-rest) moment.
- Copy in the council's voice ("the council needs you", "the forged week").
- Status-badge and now-speaking transitions.

## 8. Components & files

- **Modify:** `app/globals.css` (tokens), `app/page.tsx` (war-room phases),
  `lib/agents.ts` (dark palette), `components/DebateTimeline.tsx`,
  `components/DebateMessage.tsx`, `components/RoundDivider.tsx`,
  `components/InterventionPanel.tsx` (spotlight), `components/WeekCalendar.tsx`
  (forged-week panel + expandable reasoning), `components/TaskForm.tsx` (dark + Google
  hooks), `lib/api.ts` (Google helpers), `lib/useDebateStream.ts` (expose `maxRounds`).
- **Create:** `lib/debateProgress.ts` (pure selector), `lib/useGoogleCalendar.ts`,
  `components/DebateStatusBand.tsx`, `components/CouncilRoster.tsx`,
  `components/GoogleConnect.tsx`, `components/CalendarPicker.tsx`,
  `components/ImportPreview.tsx`, `components/ExportButton.tsx`.
- Each `lib/*` and `components/*` stays focused and independently testable; tests
  co-located as `<name>.test.ts(x)`.

## 9. Testing

- **Pure logic:** `debateProgress` selector — current round, active speaker, roster states
  from a synthetic event stream (prior art: `lib/debateReducer.test.ts`).
- **API client:** new Google helpers with stubbed `fetch` (prior art: `lib/api.test.ts`).
- **Components (RTL):** `DebateStatusBand` (round/now-speaking render),
  `CouncilRoster` (active glow vs dimmed last-action), `GoogleConnect`
  (connected/disconnected), `CalendarPicker` (checkbox selection),
  `ImportPreview` (remove a row), `ExportButton` (calls handler, shows confirmation/error).
  Prior art: the existing `components/*.test.tsx`.
- **Visual polish** (color, motion, spacing) is verified by manual smoke, not snapshots.
- The existing frontend suite stays green; `prefers-reduced-motion` disables animation in
  tests/CI by default.

## 10. Out of scope

- Backend changes (the Google endpoints and debate engine are done).
- Deployment / Dockerization (separate later phase).
- Daily re-planning UX; "rejected trade-offs" structured panel (no backend data for it).
- Visual-regression / snapshot testing.
- A speculative "agent is typing" indicator (no backend signal — would be fabrication).
