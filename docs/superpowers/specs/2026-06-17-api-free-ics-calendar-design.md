# API-free ICS calendar I/O (anonymous) — Design

**Date:** 2026-06-17
**Status:** Approved (brainstorm), pending spec review
**Supersedes:** the Google Calendar OAuth integration (`docs/superpowers/specs/2026-06-14-google-calendar-design.md`, `2026-06-15-google-calendar-ux-auth-design.md`) and renders `docs/google-oauth-verification.md` obsolete.

## Problem

WeekForge's calendar I/O currently runs through the Google Calendar API. Import reads
busy times via `calendar.readonly`; export **writes** to the user's primary calendar via
the full `calendar` scope. For a product open to public sign-ups this is impractical:

- The **write** scope (`https://www.googleapis.com/auth/calendar`) is a Google **restricted
  scope**. Publishing to production requires full branding verification **plus the annual
  CASA Tier-2 third-party security assessment** (paid, redone yearly).
- Even **read-only** (`calendar.readonly`) is a **sensitive scope**: public-prod still
  requires privacy policy, domain ownership verification, and a demo-video review cycle
  (no CASA, but non-trivial).
- Staying in OAuth **Testing** mode dodges verification but caps at 100 test users and
  shows every user an "unverified app" warning — unacceptable for public sign-ups.

## Decision

Go **fully API-free and anonymous**. Remove all Google OAuth and Calendar API code.

- **Export** = WeekForge generates an `.ics` file the user downloads and imports into
  whatever calendar they like (Google / Apple / Outlook).
- **Import is deferred.** This iteration ships **export only**. The council learns existing
  commitments from the form's **existing manual busy-block entry** (`BusyBlockRow`), not
  from any calendar. ICS *upload* import is a future iteration (see Non-goals).
- **No accounts, no login.** Each visit is a fresh anonymous session: enter tasks + busy
  blocks → debate → download `.ics`. Nothing persists beyond the in-flight debate session.

This eliminates the entire OAuth verification problem — there is no Google API left, so
no consent screen, no privacy-policy/domain requirements, and no "unverified app" warning.

### Decisions locked during brainstorm

| Question | Decision |
|---|---|
| Target audience | Public sign-ups (real users) |
| Calendar export | API-free `.ics` download |
| Calendar import | **Deferred** — manual busy-block entry only this iteration |
| Accounts / login | None — fully anonymous |

**Why import is deferred:** Google only exports the *entire* calendar (no date-range, no
single-event export). Real calendars are dominated by recurring events stored as a single
master `VEVENT` + `RRULE` whose `DTSTART` is the series origin — so a naive single-event
walk drops them and the council would schedule over standing meetings. Doing import *well*
means RRULE expansion (`recurring-ical-events`, EXDATE/modified-instance handling). That is
its own iteration; this one ships the high-value, low-risk export path first.

## Scope

**In scope:** ICS download **export**, removal of all Google API/OAuth code (both import
and export paths), removal of the Google login gate (anonymous), UI for download,
doc/red-line updates. Manual busy-block entry already exists and is retained unchanged.

**Out of scope (explicit non-goals):** **all calendar import** (ICS upload, RRULE
expansion, secret iCal URL) — a future iteration; user accounts; persistence across visits.

## Architecture

The debate engine, validation guardrail, SSE streaming, and sessions are **unchanged**.
This touches only the calendar I/O edges.

### Removed

- `src/weekforge/auth/` (`google_oauth.py`, `token_store.py`)
- `src/weekforge/integration.py` (the whole `GoogleIntegration` / `UnconfiguredGoogleIntegration` facade)
- `RealGoogleCalendarClient`, `GoogleCalendarProvider`, `GoogleCalendarWriter` in
  `src/weekforge/providers/google_calendar.py` (delete the module if nothing else remains)
- `src/weekforge/api/google_routes.py`
- Frontend: `GoogleConnect.tsx`, `useGoogleCalendar.ts`, `CalendarPicker.tsx` (+ their tests),
  and the page's Google import state/UI (`ImportPreview` usage, `handleImport`, `imported`).
- Dependencies: `google-auth*`, `google-api-python-client` / `googleapiclient`
- Env vars: `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI`, `GOOGLE_TOKEN_PATH`
- `docs/google-oauth-verification.md` (delete or mark obsolete)

### Import side

**Deferred to a future iteration.** This iteration ships no calendar import. The council
learns commitments from the form's existing **manual busy-block entry** (`BusyBlockRow`),
which is unchanged. The existing path-based `ICSCalendarProvider` in `calendar.py` is left
as-is (used by its own tests) but is not wired to any endpoint.

### Export side (generate → download)

- New `ICSCalendarWriter` (sibling of `ICSCalendarProvider` in `calendar.py`). It builds a
  `VCALENDAR` from the user's (possibly edited) schedule `TimeBlock`s:
  - one `VEVENT` per block, each tagged `X-WEEKFORGE:1`
  - DST-correct: times are emitted as **UTC instants** (`...Z`). Block datetimes already
    carry the DST-correct offset from `validation.py`'s `_localize`; naive wall-clock blocks
    are anchored to the request's `time_zone` (browser IANA) before conversion. Emitting UTC
    avoids `VTIMEZONE` complexity while remaining DST-correct in every calendar client.
- New endpoint `POST /calendar/ics/export`: JSON body `{week_start, blocks, time_zone?}`
  (carries the user's **edited** blocks — there is no server-persisted schedule to key on),
  returns `Content-Type: text/calendar` with a `Content-Disposition: attachment` header.

### Data flow

```
tasks + manual busy blocks (form)
        │
        ▼
(existing debate / validation / SSE) ──► finalized Schedule
        │
   user edits blocks (client-side: handleEditTime / handleDelete)
        │
download .ics ◄── POST /calendar/ics/export ◄── ICSCalendarWriter (tag X-WEEKFORGE:1)
```

## Frontend changes

- **Remove the Google login gate** in `app/app/page.tsx` so the app is reachable anonymously,
  and delete the Google import UI (`GoogleConnect`, `CalendarPicker`, the import slot).
- `ExportButton` → **"Download .ics"**: fetch the export blob and trigger a browser download.
  Remove "Add to Google Calendar" copy and the `calendar_url` result. Always rendered once a
  schedule is forged (no longer gated on `google.connected`).
- Safety note copy updated (see below).
- Per `frontend/AGENTS.md`: read `node_modules/next/dist/docs/` before writing frontend code.

## Safety invariant (reframed red line)

The current red line — "only ever delete/ignore WeekForge's own marked events; never touch
the user's real events" — is **replaced by a stronger, simpler one**:

> WeekForge has **no write access to any calendar**. It only ever emits a standalone `.ics`
> file the user chooses to import. The `X-WEEKFORGE` marker is stamped on every generated
> event so a future import path can skip WeekForge's own output (no double-counting busy).

Update `CLAUDE.md` red lines and architecture map accordingly.

## Error handling

- **Export with empty/zero blocks:** valid — emit a calendar with no events (or the schedule
  as-is); do not error.
- **Naive vs tz-aware block datetimes:** naive blocks are anchored to the request `time_zone`
  (fallback UTC) before conversion to a UTC instant; tz-aware blocks convert directly.

## Testing

TDD per project convention — failing test first.

- `ICSCalendarWriter.to_ics`: every emitted event carries `X-WEEKFORGE:1`; a naive
  wall-clock block + `time_zone` produces the correct UTC instant (DST-correct).
- `POST /calendar/ics/export` returns `text/calendar` with an attachment header and the
  marker in the body.
- `create_app` exposes `/calendar/ics/export` and **no** `/auth/google/*` routes.
- Frontend (vitest): `exportIcs` POSTs and returns a blob; `ExportButton` triggers a download;
  no Google-connect UI or login gate remains.
- Delete tests tied to removed code (`test_integration_oauth.py`, `test_google_calendar.py`,
  `test_integration_calendars.py`, `test_google_routes.py`, `GoogleConnect.test.tsx`,
  `CalendarPicker.test.tsx`, `useGoogleCalendar.test.ts`).

## Known limitations (this iteration)

- **No calendar import.** Existing commitments must be entered manually in the form; WeekForge
  cannot read them from a calendar yet. Note this in `README.md`.
- **Future import must handle recurrence.** When ICS upload import is built, it must expand
  RRULE (`recurring-ical-events`, EXDATE/modified instances) — Google exports the whole
  calendar with recurring meetings as a single master `VEVENT` + `RRULE`, so a naive
  single-event walk would silently drop standing meetings.

## Extensibility: adding auth later

Accounts are a future, **additive** layer — this design deliberately keeps the door open
and the implementation plan must not hard-code "anonymous" assumptions that block it.

- **Identity is independent of the deleted Calendar OAuth.** "Sign in with Google" for
  identity uses `openid email profile` — neither sensitive nor restricted, so **no Google
  verification** (no CASA, no branding gate, no warning screen). Email/password is equally
  additive. Deleting Calendar OAuth costs nothing here.
- **Session seam already exists.** Sessions are keyed by `thread_id` (`api/sessions.py`,
  mirrored by the LangGraph checkpointer). Adding auth = hang a **nullable `user_id`** on
  `Session` and filter lookups by it; the anonymous flow keeps working with `user_id = None`.
  A column, not a redesign.
- **ICS I/O is stateless request/response** — it never assumes anonymity. An authed user
  uploads/downloads identically; you'd just *additionally* persist their uploaded calendar
  and past weeks under their `user_id`.
- **No secret-storage retrofit.** With the Google token store deleted, there is no per-user
  secret to migrate when auth arrives.

**Implementation constraints to honor now (so auth stays additive):**

1. Keep the ICS export endpoint (and a future import endpoint) free of session-ownership
   checks beyond `thread_id`; do not bake in a hard "no identity" assumption.
2. Treat `thread_id` as the single persistence key; do not scatter ownership logic.
3. Pre-existing gap (out of scope here, not introduced by this plan): `SessionManager` is an
   in-memory dict. "Remember my past weeks" will need durable per-user storage — a separate
   future task.

## Migration notes

- Drop the removed env vars from `CLAUDE.md` and any `.env.example` / deployment docs.
- Remove the Google deps from `pyproject.toml` and re-lock.
- `weekforge_tokens.json` is no longer produced or read — remove references.
