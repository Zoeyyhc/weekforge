# WeekForge — Product Polish + Google Calendar + Deployment (PRD)

> **Date:** 2026-06-14 · **Status:** Ready for agent · **Timebox:** 3 days
> **Triage:** `ready-for-agent` (no issue tracker configured — published as a spec doc;
> import to GitHub issues once a remote exists).

---

## Problem Statement

WeekForge works end-to-end as an engineering artifact — a council of conflicting-objective
agents (Deadline Hawk, Energy Guardian, Focus Batcher) debates the week, the user arbitrates
at a stall, and a time-blocked schedule is forged. But three gaps keep it from feeling like a
finished product a user (and an interviewer) would actually adopt:

1. **It does not connect to the user's real life.** The user types tasks and fixed
   commitments as raw JSON. Their week already lives in Google Calendar; re-typing it is
   friction, and the forged schedule dies inside the app instead of landing back in the
   calendar they live out of.
2. **The UI reads as a developer demo, not a product.** It is functional Tailwind with no
   identity, no motion, no delight, and a JSON textarea as the front door. Watching the
   debate — the headline feature — is under-dramatised.
3. **There is no way to run it as a deployed product.** It only runs from two dev terminals
   with hand-set env vars.

## Solution

From the user's perspective:

- **"Connect Google Calendar" replaces the JSON.** The user authorises their Google account
  once. WeekForge pulls their existing events for the planning week as fixed commitments
  (busy blocks) so the council plans *around* their real life. They add tasks through a
  friendly form, not raw JSON.
- **"Add to Google Calendar" closes the loop.** When the council finishes, one click writes
  the forged time blocks back into the user's Google Calendar as real events — so the plan
  leaves the app and becomes their actual week. They can re-run and it cleanly replaces the
  previously written WeekForge events.
- **The app looks and feels forged.** A cohesive visual identity (the "Crucible" theme),
  a guided multi-step intake instead of a JSON blob, the debate streaming in as a dramatic
  live council with per-agent identity and motion, and a polished weekly calendar as the
  payoff — with small thoughtful touches (loading/empty/error states, keyboard, copy, micro-
  interactions) throughout.
- **It deploys.** `docker-compose up` brings the whole product up locally with one command,
  and a documented, scripted path takes it to a host when the user is ready.

---

## User Stories

### Google Calendar — connect & import

1. As a planner, I want to connect my Google account from inside WeekForge, so that I don't have to type my fixed commitments by hand.
2. As a planner, I want to see a clear "Connect Google Calendar" call-to-action when I'm not yet connected, so that I know the integration exists and how to start it.
3. As a planner, I want WeekForge to remember my Google authorisation between sessions, so that I don't have to re-authorise every time I plan.
4. As a planner, I want to pick which week I'm planning, so that WeekForge imports the right range of events.
5. As a planner, I want my existing Google Calendar events for that week imported as fixed commitments (busy blocks), so that the council plans around meetings I can't move.
6. As a planner, I want all-day events and multi-day events handled sensibly, so that an "out of office" day blocks the right time.
7. As a planner, I want to preview the imported busy blocks before the debate starts, so that I can confirm WeekForge read my calendar correctly.
8. As a planner, I want to remove or ignore an imported block (e.g. a tentative event), so that the council isn't constrained by something I'd actually move.
9. As a planner, I want a clear message if my calendar is empty or the import fails, so that I understand why no commitments showed up and can proceed anyway.
10. As a planner, I want to disconnect my Google account, so that I can revoke WeekForge's access when I'm done.

### Google Calendar — export / write-back

11. As a planner, once the council forges my week, I want an "Add to Google Calendar" button, so that the plan becomes real events without re-entry.
12. As a planner, I want the written events to be clearly labelled as WeekForge-created, so that I can recognise and manage them in my calendar.
13. As a planner, I want each forged block to carry its task title and a short note of the council's reasoning, so that future-me knows why this block exists.
14. As a planner, I want confirmation of how many events were written (and a link into Google Calendar), so that I trust the export worked.
15. As a planner, when I re-run and re-export the same week, I want WeekForge to replace the events it wrote before rather than duplicate them, so that my calendar stays clean.
16. As a planner, I want a clear error if the write fails (e.g. auth expired), so that I can re-authorise and retry without losing the schedule.
17. As a planner, I want only WeekForge's own events touched on re-export, so that my real meetings are never modified or deleted.

### UI beautification & delight

18. As a first-time visitor, I want a landing/hero that explains "a council debates your week" in one glance, so that I immediately get what this is.
19. As a planner, I want a guided, multi-step intake (tasks → commitments → preferences) instead of a raw JSON box, so that entering my week feels effortless.
20. As a planner, I want to add, edit, and remove tasks through form fields with sensible defaults and validation, so that I don't fight syntax.
21. As a planner, I want the sample week pre-loaded and one click to try a demo, so that I can see the product work before investing my own data.
22. As a planner, I want each agent to have a distinct avatar, colour, and voice, so that I can follow the debate like a conversation between characters.
23. As a planner, I want proposals and critiques to stream in with motion (typing/entrance animation), so that watching the council feels alive and dramatic.
24. As a planner, I want clear round markers and a sense of progress (which round, converging or not), so that I understand where the debate is heading.
25. As a planner, I want the "the council needs you" intervention moment to feel like a spotlight, so that I know it's my turn and what's contested.
26. As a planner, I want the forged schedule rendered as a polished weekly calendar grid, so that the payoff looks like a real planner.
27. As a planner, I want to expand any forged block to see the reasoning chain behind it, so that I trust the plan and can learn from it.
28. As a planner, I want thoughtful loading, empty, and error states everywhere, so that the app never feels broken or blank.
29. As a planner, I want the app to be responsive and legible on a laptop and a phone, so that I can use it wherever I plan.
30. As a planner, I want keyboard and accessibility basics (focus states, labels, reduced-motion respect), so that the polish isn't skin-deep.
31. As a planner, I want a consistent visual identity (the "Crucible" theme: type, colour, spacing, iconography), so that the product feels intentional, not generic.

### Deployment & operability

32. As the maintainer, I want to bring the entire product (frontend + backend) up with one `docker-compose up`, so that I (or a reviewer) can run it without manual setup.
33. As the maintainer, I want secrets (Anthropic key, Google OAuth client) supplied via environment / `.env`, so that nothing sensitive is committed.
34. As the maintainer, I want the SQLite checkpoint DB persisted across container restarts, so that in-progress weeks survive a restart.
35. As the maintainer, I want a documented, scripted path to deploy to a host, so that going live later is a follow-the-steps task, not a research project.
36. As the maintainer, I want the OAuth redirect URI configurable per environment, so that the same code works locally and when deployed.
37. As the maintainer, I want a README that takes a new contributor from clone to running app, so that the project is handoff-ready.

---

## Implementation Decisions

### Google Calendar — read (import)

- Add a **`GoogleCalendarProvider`** implementing the existing `CalendarProvider` protocol
  (`get_busy_blocks(start, end) -> [TimeBlock]`). This is the highest existing seam — the
  debate engine already consumes `CalendarProvider`, so no engine change is needed. It joins
  `MockCalendarProvider` and `ICSCalendarProvider` as a third, hot-swappable impl.
- All-day events map to UTC-midnight-to-midnight `TimeBlock`s; timezone-aware and naive
  datetimes are normalised to UTC, mirroring `ICSCalendarProvider._normalise`.
- The provider reads from the user's **primary** calendar for v1.

### Google Calendar — write (export)

- Introduce a new **`CalendarWriter`** protocol — the write counterpart to `CalendarProvider`
  — with a method to write a set of forged blocks and a method to clear previously-written
  WeekForge events for a week. Provide a **`GoogleCalendarWriter`** impl and a fake for tests.
- **Idempotent re-export:** WeekForge tags every event it creates with a stable marker
  (a private extended property identifying WeekForge + the week). Re-export first deletes
  events carrying that marker for the target week, then writes the new set. Events without
  the marker are never touched — real meetings are safe.
- Each written event carries the block label as title and the relevant council reasoning as
  the description.

### OAuth & token storage

- Add Google OAuth (authorization-code flow) with scopes for calendar **read and write**.
  Single-user: WeekForge authorises one Google account (the maintainer's).
- New routes: begin-auth (redirect to Google), OAuth callback (exchange code, persist token),
  auth-status (is a valid token present?), and disconnect (revoke/clear token).
- Token persistence sits behind an **`OAuthTokenStore`** seam (save/load/clear credentials),
  with a SQLite-backed impl beside the existing checkpoint DB and a fake for tests. The store
  handles refresh-token use so sessions survive access-token expiry.
- The OAuth **redirect URI and client credentials are environment-configured**, so local and
  deployed environments differ only by config.

### API surface (additions, all on the existing FastAPI app)

- **Auth:** begin-auth, callback, auth-status, disconnect.
- **Import:** an endpoint returning busy blocks for a chosen week from the connected Google
  account (shaped exactly like the existing `busy_blocks` request field, so the frontend can
  feed it straight into `POST /debate`).
- **Export:** an endpoint that takes a thread's forged schedule (or an explicit block list)
  and writes it to Google Calendar idempotently, returning a count and a calendar link.
- CORS continues to allow the frontend origin; the deployed origin is added via config.
- `StartDebateRequest` is unchanged — imported busy blocks flow through the existing field.

### Frontend

- Replace the raw-JSON `TaskForm` front door with a **guided multi-step intake**: a task
  editor (add/edit/remove rows), a commitments step (Connect Google → preview/edit imported
  busy blocks, or add manually), and a preferences step. The "convene the council" action
  builds the same `StartDebateRequest` the backend already accepts. Keep a "load sample week"
  shortcut and a JSON-paste escape hatch for power users.
- Add Google connection UI (connect / connected / disconnect states) driven by the
  auth-status endpoint.
- Add an **"Add to Google Calendar"** action on the forged-week view, with written-count
  confirmation, a link into Google Calendar, and error/retry handling.
- Apply a cohesive **"Crucible" visual identity** and motion across the existing components
  (debate timeline, agent message bubbles, round dividers, intervention panel, week
  calendar): per-agent avatars/colours, entrance/streaming animation, a spotlighted
  intervention moment, expandable per-block reasoning, and full loading/empty/error states.
  Built with the `frontend-design` skill; respects `prefers-reduced-motion`.
- New API client helpers mirror the new endpoints (auth-status, import, export), alongside
  the existing `startDebate` / `sendIntervention` / `streamUrl`.

### Deployment

- **Dockerfiles** for the FastAPI backend and the Next.js frontend, plus a **`docker-compose`**
  that runs both, wires `NEXT_PUBLIC_API_BASE_URL`, mounts a **volume for the SQLite DB**
  (checkpoints + token store), and reads secrets from `.env`.
- A documented deploy path (host of record per the chosen "scripts + docs first" approach),
  including how to register the OAuth redirect URI for the deployed origin.
- README updated: clone → configure `.env` → `docker-compose up` → connect Google → plan.

---

## Testing Decisions

Good tests here assert **external behaviour at the highest seam**, never implementation
detail. Prior art already establishes the patterns to copy:

- **Provider/writer tests** against fakes and fixtures — copy `tests/test_calendar_provider.py`
  (which exercises `MockCalendarProvider` and `ICSCalendarProvider` against
  `tests/fixtures/sample_calendar.ics`). `GoogleCalendarProvider` and `GoogleCalendarWriter`
  are tested against a **fake Google client** (no network), asserting: events → `TimeBlock`
  normalisation (incl. all-day), date-range overlap filtering, idempotent re-export
  (marked events replaced, unmarked events untouched), and reasoning-in-description.
- **OAuth + new-route tests** with injected fakes — copy `tests/api/conftest.py`, which
  already injects a `MockCouncil` and a temp DB into `create_router`. Inject a fake
  `OAuthTokenStore` and fake Google client; assert auth-status reflects stored/absent tokens,
  callback persists a token, disconnect clears it, import returns busy-block-shaped JSON, and
  export returns the written count. No real Google calls in the suite.
- **`OAuthTokenStore` tests:** save → load round-trips; clear removes; refresh path is
  exercised against a fake.
- **Frontend api-client tests** with stubbed `fetch` — copy `frontend/lib/api.test.ts`
  (stubs `fetch`, asserts URL/method/body and parsed result) for the new auth/import/export
  helpers.
- **Frontend component tests** with React Testing Library — copy the existing
  `components/*.test.tsx` style (render + interaction, query by role/test-id). Cover the
  multi-step intake (task add/edit/remove, building the request), the Google connect states,
  the import preview (remove a block), and the export button (calls handler, shows
  confirmation/error). Visual polish is verified by manual smoke, not snapshot tests.
- **Manual smoke** (documented in the plan): full loop against a real backend + a real Google
  account — connect → import → debate → intervene → forge → export → verify events appear in
  Google Calendar → re-export replaces, doesn't duplicate.

The debate engine, reducer, SSE contract, and existing components are **regression-protected**
by the current passing suites and must stay green.

---

## Out of Scope

- **Multi-user accounts, auth, billing.** Single-user (the maintainer's Google account) only,
  consistent with the design spec's non-goals.
- **Calendars other than the primary** Google calendar; calendar selection UI.
- **Other task providers** (Todoist/Notion) and other calendar backends beyond what exists
  (Mock/ICS) plus the new Google read+write.
- **Daily re-planning / check-in UX.** The checkpointer supports it; building the re-plan
  flow is a separate effort.
- **Two-way sync** (live calendar updates flowing back into a running debate). Export is a
  one-shot write on the user's command.
- **A constraint-solver scheduler.** Intelligence stays in deliberation, per the design spec.
- **Production hardening** beyond "basic deployment": no autoscaling, observability stack,
  rate limiting, or multi-region.
- **Snapshot/visual-regression testing** of the UI.

## Further Notes

**Recommended 3-day sequencing (highest-leverage first, de-risk OAuth early):**

- **Day 1 — Google Calendar vertical slice (the riskiest, most differentiating piece).**
  OAuth flow + `OAuthTokenStore`, `GoogleCalendarProvider` (import), `GoogleCalendarWriter`
  (idempotent export), and the four/five new endpoints — all behind fakes with tests, then a
  real-account manual smoke. Doing this first means if OAuth fights back, you still have two
  days to absorb it.
- **Day 2 — UI beautification & delight.** The guided intake replacing JSON, the "Crucible"
  identity, debate motion/drama, the polished week calendar, expandable reasoning, and all
  loading/empty/error states. Wire the Google connect/import/export UI to Day 1's endpoints.
- **Day 3 — Deployment + hardening + polish pass.** Dockerfiles, `docker-compose`, persisted
  volume, README, deploy scripts/docs, end-to-end manual smoke, accessibility/responsive pass,
  and buffer for OAuth-redirect-in-prod gotchas.

**Two risks worth flagging up front:**

1. **OAuth redirect + deployment interact.** Google requires the exact redirect URI to be
   pre-registered. Decide the deployed origin early (even if go-live is last) so the redirect
   URI is registered once. Keeping it env-configured (above) is what makes local and prod the
   same code.
2. **SSE on the host.** The debate streams over SSE (long-lived connection). Whatever host is
   chosen for go-live must allow long-lived streaming responses and not buffer them — worth
   confirming before relying on it for the live demo. Local docker-compose has no such limit.

**Naming/identity:** the design spec already gives a codename and tagline — *Crucible* /
*"Forge your week in the crucible."* The UI identity work should lean into this rather than
inventing a new theme.

**On "巧思" (delightful touches), concrete candidates within scope:** agents "thinking" with a
typing indicator before each turn; a subtle forge/ember motif on convene; the intervention
panel dimming the rest of the screen to spotlight the user's decision; a satisfying
"forged" reveal animation on the final calendar; and copy written in the council's voice.
These serve the debate-visualisation headline — avoid gold-plating beyond it (design-spec §9).
