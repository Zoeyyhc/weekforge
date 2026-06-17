# Auth & Saved Rhythm — Design

**Date:** 2026-06-17
**Status:** Approved (brainstorming), pending implementation plan

## Summary

Add local email/password accounts to WeekForge so the landing-page "Convene the
council" CTA gates entry to the console behind login, and so a user's scheduling
**rhythm** (workday start/end, max focus minutes) persists across sessions and
pre-fills the intake wizard.

This is **local accounts only** — not OAuth, not a hosted provider. It is
consistent with the project's API-free, self-hosted ethos. It deliberately
re-introduces a login gate that the project previously removed; the prior gate
was Google OAuth for calendar *write* access, whereas this gate exists purely to
persist preferences and protect the Anthropic-backed debate endpoints.

## Decisions (from brainstorming)

- **Auth approach:** Roll our own on FastAPI (SQLite + hashed passwords + signed token). No third-party auth service.
- **Session transport:** JWT Bearer token. FastAPI issues a signed JWT on login; the frontend stores it and sends it as `Authorization: Bearer`. Fits the existing direct-fetch `api.ts` pattern. Accepted tradeoff: token lives in JS (XSS-exposable) — acceptable for a self-hosted tool.
- **Saved profile scope:** Rhythm preferences only (`workday_start_hour`, `workday_end_hour`, `max_focus_minutes_per_day`, `timezone`). **No recurring busy blocks** — deferred to the future calendar feature, which will own recurrence properly (avoids throwaway work).
- **Guest access:** None. Login is required; the anonymous code path is retired.
- **Small calls:** JWT 7-day expiry; `bcrypt` over `argon2` (lighter, no build deps); rhythm auto-saved on debate start rather than via a separate Save button.

## Non-goals

- Recurring busy blocks (future calendar owns this).
- Password reset / email verification flows (out of scope for this iteration).
- OAuth / social login.
- Multi-device session revocation, refresh tokens.

## Backend

New self-contained module `src/weekforge/auth/`, mirroring the existing
seam-based, dependency-injected style.

### Dependencies & config

- New deps: `bcrypt` (password hashing), `pyjwt` (token signing).
- New env var: `WEEKFORGE_AUTH_SECRET` — HS256 signing key (required at startup).
- Reuse `WEEKFORGE_DB_PATH` — add a `users` table to the existing SQLite file
  (distinct table name from the LangGraph checkpointer tables). No new DB file.

### Components

- **`auth/store.py` — `UserStore`** (thin `sqlite3` wrapper):
  - `create_user(email, password, display_name) -> User` — hashes password, inserts; raises on duplicate email.
  - `get_by_email(email) -> User | None`
  - `get_by_id(user_id) -> User | None`
  - `verify_password(user, password) -> bool`
  - `save_preferences(user_id, preferences: Preferences) -> None`
  - `get_preferences(user_id) -> Preferences | None`
  - Stores `password_hash` only (never plaintext). Preferences persisted using the existing `weekforge.models.Preferences` model.
  - Schema: `users(id TEXT PK, email TEXT UNIQUE, display_name TEXT, password_hash TEXT, created_at TEXT)` and a `preferences` column/table keyed by `user_id` holding the serialized `Preferences`.

- **`auth/tokens.py`**:
  - `issue_token(user_id) -> str` — HS256 JWT, `exp` ≈ 7 days.
  - `decode_token(token) -> str` (user_id) — raises on invalid/expired.

- **`api/auth_routes.py` — `create_auth_router(store)`**:
  - `POST /auth/signup` `{email, password, display_name}` → `{token, user}`
  - `POST /auth/login` `{email, password}` → `{token, user}` (401 on bad creds)
  - `GET /auth/me` (Bearer) → `{user, preferences}`
  - `PUT /auth/me/preferences` (Bearer) `{workday_start_hour, workday_end_hour, max_focus_minutes_per_day, timezone}` → saved prefs
  - `get_current_user` FastAPI dependency: decodes Bearer header, loads user, 401 on missing/invalid/expired.

- **Protected debate endpoints:** `POST /debate`, `GET /debate/{thread_id}/stream`, and `POST /debate/{thread_id}/intervene` now require `get_current_user`. Rationale: login is mandatory, and this prevents anonymous callers from burning the Anthropic key. `/health` and `POST /calendar/ics/export` remain open.
  - Note: SSE `EventSource` cannot set an `Authorization` header. The stream endpoint accepts the token via query string (`?token=...`) as a documented exception, validated by the same decode path.

- **Wiring:** `create_app` constructs a `UserStore` over `db_path`, includes the auth router, and passes `get_current_user` into the debate router. `server.py` reads `WEEKFORGE_AUTH_SECRET`.

### Response shapes

- `user`: `{ id, email, display_name }` (never the hash).
- `preferences`: the `Preferences` fields; `null` when the user has not saved any yet.

## Frontend (Next.js 16)

- **`lib/auth.ts`** — fetchers (`signup`, `login`, `fetchMe`, `savePreferences`) plus token persistence in `localStorage`. `api.ts` gains an `authHeader()` helper; debate calls send `Authorization: Bearer`, and `streamUrl` appends `?token=`.
- **`AuthProvider` / `useAuth`** — React context holding `{ user, token, status }`. Hydrates from `localStorage` on mount; exposes `login`, `signup`, `logout`. Mounted in `app/layout.tsx`.
- **`/login` route** — a single forge-styled page with a login⇄signup toggle (email + password; display name shown on signup). Reuses `ForgeBackground`, grain, molten mesh, `font-display`, and ember/amber-accented inputs (border `#272430`, `bg-surface/60`, `backdrop-blur`), matching the existing "crucible" voice. On success, redirect to `/app`.
- **Client guard on `/app`** — checks auth on mount: no token → redirect to `/login`; authed → render. Landing CTAs keep `href="/app"`; the guard performs the gating. The app header shows the display name + a logout control.

### Saved-rhythm flow

- On entering `/app`, `fetchMe()` prefills the rhythm step (workday start/end, max focus) from saved preferences when present.
- On debate start, the current rhythm is auto-saved via `PUT /auth/me/preferences`, so the next visit pre-fills with no extra UI.

## Data flow

```
signup/login  ──▶  JWT stored in localStorage
                      │
                      ▼
              AuthProvider hydrates {user, token}
                      │
       guard admits ──▶ /app
                      │
        GET /auth/me ──▶ prefill rhythm step
                      │
   start debate ──▶ send Bearer + auto-save rhythm (PUT /auth/me/preferences)
```

## Error handling

- Duplicate email on signup → 409 (frontend shows "that email already has a seat").
- Bad credentials on login → 401 (generic "email or password is wrong").
- Missing/invalid/expired token on protected routes → 401; frontend clears stored token and redirects to `/login`.
- `WEEKFORGE_AUTH_SECRET` unset at startup → fail fast with a clear error.

## Testing (TDD — test-first)

### Backend (pytest, no Anthropic calls)

- `UserStore`: password hash round-trip; `verify_password` rejects wrong password; duplicate email raises.
- `tokens`: issue→decode round-trip; expired/garbage token raises.
- `/auth/signup`: happy path returns token + user (no hash leaked); duplicate email → 409.
- `/auth/login`: happy path; wrong password → 401; unknown email → 401.
- `/auth/me`: returns user + preferences with valid token; 401 without/with bad token.
- `/auth/me/preferences`: save then `/me` reflects it.
- Debate endpoint rejects unauthenticated request (401); accepts with valid token.

### Frontend (vitest)

- `useAuth`: hydrate from localStorage; `logout` clears state + storage.
- Login form: submit calls `login`, stores token, redirects.
- Signup form: display-name field present; submit calls `signup`.
- Gate: unauthenticated visit to `/app` redirects to `/login`.
- Rhythm prefill: `/me` preferences populate the rhythm step.

## Conventions honored

- Tests inject seams (`UserStore`, council mock) — never call real Anthropic.
- Secrets/`*.db` stay git-ignored; all config via env vars.
- Calendar safety red line untouched (no calendar write access introduced).
