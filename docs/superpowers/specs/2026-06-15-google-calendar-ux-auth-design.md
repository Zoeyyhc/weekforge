# Google Calendar UX + Mandatory Auth — Design

**Date:** 2026-06-15
**Status:** Approved (design), pending implementation plan

## Overview

Five related improvements to WeekForge's Google Calendar integration and intake
flow:

1. Make Google login a **mandatory gate** before the planning flow.
2. Fix the `Method Not Allowed` error when unbinding the calendar.
3. Pass each task's **remark** to the council (model), not just the UI.
4. Import **all** of the user's calendars, including the WeekForge output calendar.
5. Let the user **edit times and delete blocks** in the forged week before
   exporting to Google Calendar.

These are cohesive (all touch the Google Calendar flow), so they share one spec
and one implementation plan. All work follows TDD (pytest backend / vitest
frontend).

---

## Feature 1 — Mandatory Google login gate

### Current state
Google OAuth is fully implemented (`/auth/google/login` → Google →
`/auth/google/callback`) but framed as optional ("Bind your Google Calendar ·
optional"). The app works anonymously. The landing Hero CTA "Convene the
council" links to `/app`; the in-app "Convene the Council" button starts the
debate.

### Target behavior
Google login becomes a required entry gate. Unauthenticated users cannot reach
the planning flow.

### Changes
**Backend** (`api/google_routes.py` callback): change the post-login redirect
target from `{frontend}?google=connected` to `{frontend}/app?google=connected`
so the user lands on the planning page after consent.

**Frontend:**
- `lib/useGoogleCalendar.ts`: add a `statusKnown` boolean (false until the
  initial `googleStatus` call resolves) to prevent flashing the login gate
  before connection state is known.
- `app/app/page.tsx`: gate the planning UI. While `!statusKnown`, render nothing
  / a neutral loading state. When `statusKnown && !connected`, render a
  **"Sign in with Google" login screen** whose button is an `<a href={googleLoginUrl()}>`
  (backend 307-redirects to Google). Only when `connected` is true render the
  existing TaskForm / debate flow.
- Landing `components/landing/Hero.tsx`: unchanged — keeps `<Link href="/app">`.
  The gate lives in `/app`, so "click Convene → Google login" holds without the
  server-rendered landing page needing to know auth state.

### Rejected alternative
Wiring the landing CTA directly to the backend login URL. Rejected because the
landing page is a server component and cannot read connection state; gating in
`/app` is cleaner and keeps the gate in one place.

### Tests
- `useGoogleCalendar`: `statusKnown` is false initially, true after status
  resolves.
- `app/app/page` (or a gate component): renders the login screen when not
  connected; renders TaskForm when connected.

---

## Feature 2 — Fix unbind `Method Not Allowed`

### Root cause
`GoogleConnect.tsx` renders unbind as `<a href={disconnectUrl}>`, which the
browser issues as **GET**. The route `/auth/google/disconnect` only accepts
**POST** → `{"detail":"Method Not Allowed"}`.

### Changes
- `lib/api.ts`: add `googleDisconnect(base?)` that does
  `fetch(url, { method: "POST" })`.
- `lib/useGoogleCalendar.ts`: expose `disconnect()` that calls `googleDisconnect`
  then sets `connected = false`.
- `components/GoogleConnect.tsx`: replace the unbind `<a href>` with a
  `<button onClick={onDisconnect}>`; add an `onDisconnect` prop.
- `app/app/page.tsx`: pass `google.disconnect` as `onDisconnect`. With Feature 1,
  `connected = false` after unbind sends the user back to the login gate.

### Tests
- `api`: `googleDisconnect` issues a POST to the disconnect endpoint.
- `GoogleConnect`: clicking unbind invokes `onDisconnect` (no navigation).

---

## Feature 3 — Pass remark to the model

### Current state
The `remark` field exists in the task UI (`TaskRow.tsx`) but `buildRequest.ts`
drops it (commented "UI-only, not sent to the council").

### Changes
- `models.py` `Task`: add `remark: str | None = None`.
- `lib/buildRequest.ts`: include `remark` in the built task when non-empty;
  remove the "UI-only" comment on the `TaskDraft.remark` field.
- `debate/nodes.py` `_fmt_tasks`: append the remark to the task line, e.g.
  `, note: "<remark>"`, so all four debaters see it in their prompt context.

### Tests
- Backend: `Task` accepts `remark`; `_fmt_tasks` includes the remark text when
  present and omits the note segment when absent.
- Frontend: `buildRequest` includes `remark` when non-empty and omits it when
  blank.

---

## Feature 4 — Import all calendars (including WeekForge output)

### Root cause
`integration.py` `list_calendars` skips the calendar named "WeekForge"
(`if c.get("summary") == self._calendar_name: continue`) — that is why its
content "can't be found" during import.

### Changes
- `integration.py` `list_calendars`: remove the exclusion line so every calendar
  (including the WeekForge output calendar) is listed.
- Set `selected_by_default = True` for all calendars (not only primary), so
  import grabs all content by default.

### Accepted side effect
The schedule WeekForge wrote in a previous run will now be imported back as busy
blocks and may crowd a new planning run. This is acceptable: imported blocks are
shown in the import preview and the user can remove them manually.

### Tests
- `list_calendars` returns the WeekForge calendar (no longer excluded) and marks
  all calendars `selected_by_default = True`.

---

## Feature 5 — Edit times and delete blocks before export

### Current state
The forged week (`WeekCalendar`) is read-only; `ExportButton` writes
`state.schedule.blocks` directly to Google Calendar.

### Scope
Edit start/end **time** and **delete** blocks. No retitling or adding new blocks.

### Changes
- `app/app/page.tsx`: keep a local editable copy of the blocks. When the debate
  reaches `done`, initialize `editedBlocks` from `state.schedule.blocks`. (Reset
  on "start over".)
- `components/WeekCalendar.tsx`: add optional `onEditTime` and `onDelete`
  callbacks. When provided, each block row renders start/end time inputs (editing
  the time-of-day while preserving the block's date) and a delete button. When
  the callbacks are absent the component stays read-only, so other consumers
  (e.g. `ForgedModal`) are unaffected.
- Validation: reuse the `end > start` rule; reject/ignore an edit that would make
  end ≤ start.
- `ExportButton` / its `onExport`: export `editedBlocks`, not the original
  `state.schedule.blocks`.

### Rejected alternative
A full editor (retitle, add blocks). Out of scope per the chosen "edit time +
delete" requirement; keeps the change minimal and controlled.

### Tests
- `WeekCalendar`: read-only by default; with callbacks, editing a time invokes
  `onEditTime` with the updated block and clicking delete invokes `onDelete`;
  an edit producing end ≤ start is rejected.
- `app/app/page`: export sends the edited block set (after a delete / time edit),
  not the original schedule.

---

## Out of scope

- Per-user / multi-user auth sessions. The token store remains a single local
  token file; "logged in" means that file exists. This is a local single-user app.
- Retitling or adding new schedule blocks (Feature 5).
- Changing the OAuth scopes or consent screen.
