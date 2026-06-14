# WeekForge — Google Calendar Integration — Design Spec

> **Date:** 2026-06-14 · **Status:** Approved design, pre-implementation
> **Scope:** The Google Calendar vertical slice of the product-polish PRD
> (`2026-06-14-weekforge-product-polish.md`). Backend + a thin "connect" surface.

---

## 1. Goal

Let the user connect their Google account once, **import** their existing calendar events
for a planning week as fixed commitments (busy blocks) the council plans around, and after
the council forges the week, **export** the schedule back into Google Calendar as real
events. Single-user (the maintainer's own Google account).

## 2. Decisions (locked)

- **Full OAuth read + write**, single-user. The app authorises one Google account.
- **Export targets a dedicated "WeekForge" calendar**, not the primary. Re-export clears
  that calendar for the week and rewrites — so re-runs never duplicate and the user's real
  meetings can never be modified or deleted. The user can hide/show the whole plan as a
  calendar layer.
- **Credentials persist to a JSON file** (`token.json`) on the persistent volume, behind an
  `OAuthTokenStore` seam (path is env-configured; lives on the same volume as the SQLite
  checkpoint DB).
- **Export is stateless:** the frontend posts the schedule blocks it already received in the
  `done` SSE frame; the backend does not read the schedule from the checkpoint.
- **Engine is unchanged:** imported busy blocks flow through the existing
  `StartDebateRequest.busy_blocks` field. No debate-graph changes.

## 3. Module layering & seams

The FastAPI routes are injected with a single **`GoogleIntegration` facade** (mirroring how
`create_app` already injects `council`). Route tests inject a fake facade. Beneath the facade
sit independently testable units:

| Unit | Responsibility | Real impl / test double |
|---|---|---|
| `OAuthTokenStore` (protocol) | save / load / clear credentials | `JsonFileTokenStore` (writes `token.json`) / fake |
| `google_oauth` (module) | build the Google authorization URL; exchange an auth code for credentials | google-auth-oauthlib `Flow`; client config from env |
| `GoogleCalendarClient` (protocol) | thin adapter over the few Google Calendar ops used | real impl uses google-api-python-client; **fake in tests** |
| `GoogleCalendarProvider` | implements existing `CalendarProvider.get_busy_blocks` — reads primary calendar → `TimeBlock`s | tested against fake client |
| `CalendarWriter` (new protocol) + `GoogleCalendarWriter` | writes `[TimeBlock]` into the WeekForge calendar (find-or-create, clear-range, insert) | tested against fake client |
| `GoogleIntegration` (facade) | composes the above; exposes `status / login_url / complete_login / disconnect / import_busy / export` | real facade; fake injected for route tests |

**`GoogleCalendarClient` is the testability seam.** Mocking googleapiclient's fluent chain
(`.events().list().execute()`) is brittle, so the client exposes only the operations we use:

- `list_events(calendar_id, start, end) -> [raw event]`
- `find_calendar(name) -> calendar_id | None`
- `create_calendar(name) -> calendar_id`
- `insert_event(calendar_id, event) -> event_id`
- `delete_events_in_range(calendar_id, start, end)`

`GoogleCalendarProvider` / `GoogleCalendarWriter` translate between domain `TimeBlock`s and
this client and hold all the logic (so they are fully unit-tested with a fake client). The
real `GoogleCalendarClient` is a thin pass-through adapter verified by manual smoke.

**New files (indicative):** `providers/google_calendar.py` (client + provider + writer),
`auth/token_store.py` (`OAuthTokenStore` + `JsonFileTokenStore`), `auth/google_oauth.py`,
`integration.py` (`GoogleIntegration`). The `CalendarWriter` protocol joins `CalendarProvider`
in the existing `providers/calendar.py`.

## 4. OAuth flow

- **Scopes:** the broad `https://www.googleapis.com/auth/calendar` (covers reading the primary
  calendar for import and creating/managing the WeekForge calendar for export). Single-user, so
  the OAuth consent screen runs in **testing mode** with the maintainer's email as a test user
  — refresh tokens work and **no Google verification is required**.
- **Config (env):** client id/secret, redirect URI, and the frontend return URL are all
  environment-configured, so local and deployed environments differ only by config.
- **Connect is full-page browser redirects** (OAuth requires it), not `fetch`: the frontend
  "Connect" button navigates the browser to `GET /auth/google/login`; after the callback
  completes it redirects the browser back to the frontend. CORS does not gate this flow.
- **Token refresh** is handled inside the store/client path so sessions survive access-token
  expiry without re-authorising.

## 5. Import data flow (read)

`GET /calendar/google/busy?week_start=YYYY-MM-DD`
→ read the primary calendar over `[week_start, week_start + 7d)`
→ return JSON **identically shaped to `StartDebateRequest.busy_blocks`**.

The frontend previews the imported blocks, lets the user remove any it would actually move,
then includes the kept blocks in its existing `POST /debate` request. All-day and multi-day
events are normalised to UTC `TimeBlock`s using the same rules as `ICSCalendarProvider`.

## 6. Export data flow (write)

`POST /calendar/google/export` body `{ week_start, blocks: [TimeBlock...] }`
→ `GoogleCalendarWriter`:
1. **find-or-create** the calendar named by `WEEKFORGE_CALENDAR_NAME` (default `WeekForge`),
2. **delete** that calendar's events within `[week_start, week_start + 7d)`,
3. **insert** one event per block — event title = block `label`, description = the relevant
   council reasoning,
→ returns `{ written: int, calendar_url: str }`.

Idempotency is structural: a dedicated calendar + clear-range-then-write means re-export
replaces rather than duplicates, and only WeekForge's own calendar is ever touched.

## 7. API surface (additions)

All mounted on the existing FastAPI app via `create_app` / `create_router`, injected with the
`GoogleIntegration` facade:

| Method & path | Purpose | Returns |
|---|---|---|
| `GET /auth/google/login` | redirect to Google's consent screen | 307 redirect |
| `GET /auth/google/callback` | exchange `code`, persist credentials, return to frontend | redirect to frontend |
| `GET /auth/google/status` | is a valid connection present? | `{ connected: bool }` |
| `POST /auth/google/disconnect` | clear stored credentials | `{ status: "disconnected" }` |
| `GET /calendar/google/busy` | import busy blocks for a week | `{ busy_blocks: [TimeBlock...] }` |
| `POST /calendar/google/export` | write the forged schedule to the WeekForge calendar | `{ written: int, calendar_url: str }` |

## 8. Configuration

`build_app` gains: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_TOKEN_PATH` (default on the persistent volume),
`WEEKFORGE_FRONTEND_URL` (callback return target), `WEEKFORGE_CALENDAR_NAME` (default
`WeekForge`).

**Graceful degradation:** when the Google env vars are absent, `GoogleIntegration` enters a
"not configured" state — `status` returns `{ connected: false }` and the app runs normally
without Google. The frontend simply doesn't offer the connect action.

New Python dependencies: `google-auth`, `google-auth-oauthlib`, `google-api-python-client`.

## 9. Testing

Good tests assert external behaviour at the highest seam; no real Google calls in the suite.

- **Route tests** inject a fake `GoogleIntegration` (copy `tests/api/conftest.py`'s MockCouncil
  injection): assert status, the login redirect, callback persisting credentials, disconnect
  clearing them, `busy` returning correctly-shaped JSON, and `export` returning the written
  count.
- **Provider / writer tests** against a fake `GoogleCalendarClient` (prior art:
  `tests/test_calendar_provider.py`): event ↔ `TimeBlock` translation incl. all-day,
  date-range filtering, idempotent export (clear-then-write within the week, other calendars
  untouched), and reasoning written into the event description.
- **`JsonFileTokenStore` tests:** save → load round-trip, clear, and the refresh path against a
  fake.
- **Manual smoke** (real account): connect → import → debate → intervene → forge → export →
  verify WeekForge-calendar events appear in Google Calendar → re-export replaces, not
  duplicates. This is the only check that exercises the real `GoogleCalendarClient` adapter and
  the live OAuth flow.

The existing engine, reducer, SSE contract, and current test suites must stay green.

## 10. Out of scope (this slice)

- Multi-user accounts/auth; per-user tokens. Single connected account only.
- Calendars other than the primary (for import); calendar-selection UI.
- Two-way / live sync. Export is a one-shot write on the user's command.
- The broader UI beautification and the deployment work — separate slices of the PRD. (This
  slice assumes credentials live on a persistent path; the deployment slice mounts the volume.)
