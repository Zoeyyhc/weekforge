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

- **Import** = user uploads an `.ics` file; WeekForge parses busy blocks in memory.
- **Export** = WeekForge generates an `.ics` file the user downloads and imports into
  whatever calendar they like (Google / Apple / Outlook).
- **No accounts, no login.** Each visit is a fresh anonymous session: upload → debate →
  download. Nothing persists beyond the in-flight debate session.

This eliminates the entire OAuth verification problem — there is no Google API left, so
no consent screen, no privacy-policy/domain requirements, and no "unverified app" warning.

### Decisions locked during brainstorm

| Question | Decision |
|---|---|
| Target audience | Public sign-ups (real users) |
| Import mechanism | Fully API-free `.ics` upload |
| Accounts / login | None — fully anonymous |
| Recurring events (RRULE) | **Not** expanded in v1 — known limitation |

## Scope

**In scope:** ICS upload import, ICS download export, removal of all Google API/OAuth
code, UI changes for upload + download, doc/red-line updates.

**Out of scope (explicit non-goals):** user accounts, persistence across visits,
recurring-event (RRULE) expansion, read via a calendar's secret iCal URL.

## Architecture

The debate engine, validation guardrail, SSE streaming, and sessions are **unchanged**.
This touches only the calendar I/O edges.

### Removed

- `src/weekforge/auth/` (`google_oauth.py`, `token_store.py`)
- `src/weekforge/integration.py` (the whole `GoogleIntegration` / `UnconfiguredGoogleIntegration` facade)
- `RealGoogleCalendarClient`, `GoogleCalendarProvider`, `GoogleCalendarWriter` in
  `src/weekforge/providers/google_calendar.py` (delete the module if nothing else remains)
- `src/weekforge/api/google_routes.py`
- Frontend: `GoogleConnect.tsx`, `useGoogleCalendar.ts`, `CalendarPicker.tsx` (+ their tests)
- Dependencies: `google-auth*`, `google-api-python-client` / `googleapiclient`
- Env vars: `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI`, `GOOGLE_TOKEN_PATH`
- `docs/google-oauth-verification.md` (delete or mark obsolete)

### Import side (read busy blocks)

Builds on the existing `ICSCalendarProvider` in `src/weekforge/providers/calendar.py`
(`icalendar` is already a dependency).

- Add a `from_bytes(data: bytes)` constructor to `ICSCalendarProvider` so an **uploaded**
  `.ics` parses in memory — no temp file. Keep the existing path-based constructor for tests.
- v1 walks `VEVENT`s directly (single events). **RRULE is not expanded** — documented limitation.
- **Skip events carrying the WeekForge marker** on import (property `X-WEEKFORGE`), so
  re-uploading a previously-generated WeekForge `.ics` does not double-count our own output.
  This preserves the spirit of the current self-pollution guard.
- New endpoint `POST /api/calendar/import`: accepts a multipart `.ics` upload, parses busy
  blocks for the target week window, and stores them on the **debate session** (matches the
  anonymous, no-persistence model). Returns the parsed busy blocks for UI display.

### Export side (write → download)

- New `ICSCalendarWriter` (sibling of `ICSCalendarProvider` in `calendar.py`), implementing
  the existing `CalendarWriter` protocol shape where practical. It builds a `VCALENDAR` from
  the finalized schedule's `TimeBlock`s:
  - one `VEVENT` per block, each tagged `X-WEEKFORGE:1`
  - DST-correct local times consistent with `validation.py`'s `_localize` (attach the
    `ZoneInfo` offset; do not ask the model for offsets) and proper `VTIMEZONE` emission.
- New endpoint `GET /api/schedule/{id}/export.ics`: streams the generated file with
  `Content-Type: text/calendar` and a `Content-Disposition: attachment` download header.

### Data flow

```
upload .ics ──► POST /api/calendar/import ──► ICSCalendarProvider.from_bytes
                                                  │ (skip X-WEEKFORGE events)
                                                  ▼
                                         busy blocks → debate session
                                                  │
                              (existing debate / validation / SSE)
                                                  ▼
                                         finalized Schedule
                                                  │
download .ics ◄── GET /api/schedule/{id}/export.ics ◄── ICSCalendarWriter (tag X-WEEKFORGE:1)
```

## Frontend changes

- Replace Google-connect UX with a **file upload** control for the `.ics` import (drop the
  calendar picker entirely — there's only one uploaded file).
- `ExportButton` → **"Download .ics"**: fetch the export endpoint and trigger a blob
  download. Remove "Add to Google Calendar" copy and the `calendar_url` result.
- Safety note copy updated (see below).
- Per `frontend/AGENTS.md`: read `node_modules/next/dist/docs/` before writing frontend code.

## Safety invariant (reframed red line)

The current red line — "only ever delete/ignore WeekForge's own marked events; never touch
the user's real events" — is **replaced by a stronger, simpler one**:

> WeekForge has **no write access to any calendar**. It only ever emits a standalone `.ics`
> file the user chooses to import. The `X-WEEKFORGE` marker survives purely as the
> import-dedup guard so re-uploading WeekForge's own output never double-counts as busy.

Update `CLAUDE.md` red lines and architecture map accordingly.

## Error handling

- **Invalid / non-ICS upload:** return a 4xx with a clear message; UI shows it inline. Do
  not crash the session.
- **Empty calendar (no events):** valid — proceed with zero busy blocks.
- **Malformed individual VEVENT** (missing dtstart/dtend): skip that event, continue parsing
  the rest; surface a count of skipped events if any.
- **Export with no finalized schedule:** 4xx, UI keeps the debate visible.
- All-day / naive / tz-aware datetime normalization: keep the existing `_normalise` behavior
  in `ICSCalendarProvider`.

## Testing

TDD per project convention — failing test first.

- `ICSCalendarProvider.from_bytes` parses `tests/fixtures/sample_calendar.ics`; window
  filtering and `_normalise` behavior preserved.
- Import **skips** events tagged `X-WEEKFORGE`.
- `ICSCalendarWriter` round-trips: write a `Schedule` → re-parse the emitted bytes → blocks
  match, every event carries `X-WEEKFORGE:1`, DST offsets correct across a spring-forward week.
- `POST /api/calendar/import` happy path + invalid-upload 4xx.
- `GET /api/schedule/{id}/export.ics` returns `text/calendar` with an attachment header.
- Frontend (vitest): upload component parses/sends the file; "Download .ics" triggers a blob
  download; no Google-connect UI remains.
- Delete tests tied to removed code (`test_integration_oauth.py`, `test_google_calendar.py`,
  `test_integration_calendars.py`, `test_google_routes.py`, `GoogleConnect.test.tsx`,
  `CalendarPicker.test.tsx`, `useGoogleCalendar.test.ts`).

## Known limitations (v1)

- **Recurring events are not expanded.** A weekly standup defined via RRULE will not register
  as busy. Clean follow-up: add `recurring-ical-events` and expand RRULE within the week
  window. Note this in `README.md`.

## Migration notes

- Drop the removed env vars from `CLAUDE.md` and any `.env.example` / deployment docs.
- Remove the Google deps from `pyproject.toml` and re-lock.
- `weekforge_tokens.json` is no longer produced or read — remove references.
