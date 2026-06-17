# API-free ICS Calendar Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace WeekForge's Google Calendar API with anonymous, API-free `.ics` **export** (download); remove all Google OAuth/verification. Calendar *import* is deferred — commitments are entered via the form's existing manual busy-block rows.

**Architecture:** Export is a `POST` carrying the user's *edited* schedule blocks that returns a generated `.ics` download. No Google API, no OAuth, no login gate. Manual busy-block entry already exists (`BusyBlockRow`) and is retained unchanged.

**Tech Stack:** FastAPI, Pydantic, `icalendar` (already a dependency), Next.js 16 frontend, pytest + vitest.

**Spec:** `docs/superpowers/specs/2026-06-17-api-free-ics-calendar-design.md`

> **Spec refinement (intentional):** Export is `POST /calendar/ics/export` carrying the
> user's edited blocks (they edit via `handleEditTime`/`handleDelete` before export; there is
> no server-persisted schedule keyed by id). Calendar **import is out of scope** this
> iteration — deferred because Google exports the whole calendar with recurring meetings as
> RRULE masters, which requires RRULE expansion to be useful.

## Global Constraints

- Python `>=3.12`; `icalendar>=5.0` already a dependency — do **not** add new Python deps.
- **Remove** Python deps: `google-auth`, `google-auth-oauthlib`, `google-api-python-client`.
- TDD: failing test first (project convention; see `CLAUDE.md`).
- Frontend is **Next.js 16, NOT the version you know** — read `node_modules/next/dist/docs/` before writing any frontend code (`frontend/AGENTS.md`).
- **Safety red line (reframed):** WeekForge has **no write access to any calendar**; it only emits a standalone `.ics`. Every generated event is stamped `X-WEEKFORGE:1` so a future import path can skip WeekForge's own output.
- Tests must never call real Google/Anthropic; inject fakes through the protocol seams.
- Keep the export endpoint free of session-ownership logic, so future auth stays additive.
- Frontend export copy: button reads **"Download .ics"**; safety note: "WeekForge builds a calendar file — your existing calendar is never touched."

---

## File Structure

**Backend — create:**
- `src/weekforge/providers/ics_writer.py` — `ICSCalendarWriter`: schedule blocks → `.ics` bytes.
- `src/weekforge/api/ics_routes.py` — `create_ics_router()`: export endpoint.
- `tests/providers/test_ics_writer.py`, `tests/api/test_ics_routes.py`, `tests/api/test_app_wiring.py`

**Backend — modify:**
- `src/weekforge/api/app.py` — mount ICS router; drop Google router + `google` param.
- `src/weekforge/api/server.py` — drop Google integration wiring.
- `pyproject.toml` — remove Google deps.
- `CLAUDE.md`, `README.md`.

**Backend — delete:**
- `src/weekforge/auth/` (whole package), `src/weekforge/integration.py`,
  `src/weekforge/api/google_routes.py`, `src/weekforge/providers/google_calendar.py`.
- Dead tests: `tests/test_integration_oauth.py`, `tests/test_google_calendar.py`,
  `tests/test_integration_calendars.py`, `tests/api/test_google_routes.py`, `tests/auth/`.
- `docs/google-oauth-verification.md`.

> `src/weekforge/providers/calendar.py` (existing `ICSCalendarProvider`) is **left untouched** —
> it has its own tests and is harmless unused. The import path will reuse it later.

**Frontend — modify:**
- `frontend/lib/api.ts` — replace Google functions with `exportIcs`.
- `frontend/components/ExportButton.tsx` — "Download .ics" + blob download.
- `frontend/app/app/page.tsx` — remove login gate + Google import UI; wire `exportIcs`.

**Frontend — delete:**
- `frontend/components/GoogleConnect.tsx` (+test), `frontend/components/CalendarPicker.tsx` (+test),
  `frontend/lib/useGoogleCalendar.ts` (+test).

---

## Task 1: ICSCalendarWriter generates a downloadable .ics

**Files:**
- Create: `src/weekforge/providers/ics_writer.py`
- Test: `tests/providers/test_ics_writer.py`

**Interfaces:**
- Consumes: `TimeBlock` from `weekforge.models`.
- Produces: `ICSCalendarWriter().to_ics(blocks: list[TimeBlock], time_zone: str | None = None) -> bytes`. Every emitted `VEVENT` carries `X-WEEKFORGE:1`; times are emitted as UTC instants (`...Z`).

- [ ] **Step 1: Write the failing test**

```python
# tests/providers/test_ics_writer.py
from datetime import datetime
from zoneinfo import ZoneInfo

from weekforge.models import TimeBlock
from weekforge.providers.ics_writer import ICSCalendarWriter


def test_to_ics_marks_every_event():
    tz = ZoneInfo("Australia/Sydney")
    block = TimeBlock(
        start=datetime(2026, 6, 15, 9, 0, tzinfo=tz),
        end=datetime(2026, 6, 15, 11, 0, tzinfo=tz),
        label="Deep work",
        task_id="t1",
    )
    text = ICSCalendarWriter().to_ics([block]).decode()
    assert "BEGIN:VEVENT" in text
    assert "SUMMARY:Deep work" in text
    assert "X-WEEKFORGE:1" in text


def test_to_ics_localises_naive_wall_clock_with_time_zone():
    # Naive block = wall-clock; writer anchors to time_zone, emits the right UTC instant.
    naive = TimeBlock(
        start=datetime(2026, 6, 15, 9, 0),
        end=datetime(2026, 6, 15, 11, 0),
        label="Deep work",
        task_id="t1",
    )
    text = ICSCalendarWriter().to_ics([naive], time_zone="Australia/Sydney").decode()
    # Sydney is UTC+10 in June (no DST) → 09:00 local == 23:00Z the prior day.
    assert "DTSTART:20260614T230000Z" in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/providers/test_ics_writer.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'weekforge.providers.ics_writer'`

- [ ] **Step 3: Implement the writer**

```python
# src/weekforge/providers/ics_writer.py
"""Generate a downloadable .ics from WeekForge's scheduled blocks.

WeekForge never writes to a user's calendar — it only emits a standalone file
the user chooses to import. Every event is tagged X-WEEKFORGE:1 so a future
import path can skip WeekForge's own output and never re-count it as busy.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from icalendar import Calendar, Event

from weekforge.models import TimeBlock


class ICSCalendarWriter:
    def to_ics(self, blocks: list[TimeBlock], time_zone: str | None = None) -> bytes:
        cal = Calendar()
        cal.add("prodid", "-//WeekForge//Crucible//EN")
        cal.add("version", "2.0")
        stamp = datetime.now(timezone.utc)
        for block in blocks:
            event = Event()
            event.add("summary", block.label)
            event.add("dtstart", self._to_utc(block.start, time_zone))
            event.add("dtend", self._to_utc(block.end, time_zone))
            event.add("dtstamp", stamp)
            event.add("uid", self._uid(block))
            event.add("X-WEEKFORGE", "1")
            cal.add_component(event)
        return cal.to_ical()

    @staticmethod
    def _to_utc(value: datetime, time_zone: str | None) -> datetime:
        if value.tzinfo is None:
            zone = ZoneInfo(time_zone) if time_zone else timezone.utc
            value = value.replace(tzinfo=zone)
        return value.astimezone(timezone.utc)

    @staticmethod
    def _uid(block: TimeBlock) -> str:
        seed = f"{block.task_id}:{block.start.isoformat()}:{block.end.isoformat()}"
        return f"{hashlib.sha1(seed.encode()).hexdigest()}@weekforge"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/providers/test_ics_writer.py -v`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/providers/ics_writer.py tests/providers/test_ics_writer.py
git commit -m "feat: ICSCalendarWriter emits marked, DST-correct .ics bytes"
```

---

## Task 2: ICS export endpoint

**Files:**
- Create: `src/weekforge/api/ics_routes.py`
- Test: `tests/api/test_ics_routes.py`

**Interfaces:**
- Consumes: `ICSCalendarWriter`, `TimeBlock`.
- Produces: `create_ics_router() -> APIRouter` with `POST /calendar/ics/export` — JSON body `{week_start, blocks, time_zone?}`, returns a `text/calendar` attachment.

- [ ] **Step 1: Write the failing test**

```python
# tests/api/test_ics_routes.py
from fastapi import FastAPI
from fastapi.testclient import TestClient

from weekforge.api.ics_routes import create_ics_router


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(create_ics_router())
    return TestClient(app)


def test_export_returns_downloadable_calendar():
    body = {
        "week_start": "2026-06-15T00:00:00",
        "time_zone": "Australia/Sydney",
        "blocks": [
            {
                "start": "2026-06-15T09:00:00+10:00",
                "end": "2026-06-15T11:00:00+10:00",
                "label": "Deep work",
                "task_id": "t1",
            }
        ],
    }
    res = _client().post("/calendar/ics/export", json=body)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/calendar")
    assert "attachment" in res.headers["content-disposition"]
    assert "X-WEEKFORGE:1" in res.text


def test_export_accepts_empty_blocks():
    res = _client().post(
        "/calendar/ics/export",
        json={"week_start": "2026-06-15T00:00:00", "blocks": []},
    )
    assert res.status_code == 200
    assert "BEGIN:VCALENDAR" in res.text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/api/test_ics_routes.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'weekforge.api.ics_routes'`

- [ ] **Step 3: Implement the router**

```python
# src/weekforge/api/ics_routes.py
"""API-free calendar export: download a generated .ics of the forged week."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel

from weekforge.models import TimeBlock
from weekforge.providers.ics_writer import ICSCalendarWriter


class ExportRequest(BaseModel):
    week_start: datetime
    blocks: list[TimeBlock]
    time_zone: str | None = None  # browser IANA zone for naive (wall-clock) blocks


def create_ics_router() -> APIRouter:
    router = APIRouter()

    @router.post("/calendar/ics/export")
    def ics_export(request: ExportRequest):
        data = ICSCalendarWriter().to_ics(request.blocks, time_zone=request.time_zone)
        return Response(
            content=data,
            media_type="text/calendar",
            headers={"Content-Disposition": 'attachment; filename="weekforge.ics"'},
        )

    return router
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/api/test_ics_routes.py -v`
Expected: PASS (both)

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/api/ics_routes.py tests/api/test_ics_routes.py
git commit -m "feat: ICS export API endpoint"
```

---

## Task 3: Mount the ICS router; remove Google wiring from the app

**Files:**
- Modify: `src/weekforge/api/app.py`, `src/weekforge/api/server.py`
- Test: `tests/api/test_app_wiring.py` (create)

**Interfaces:**
- Consumes: `create_ics_router`.
- Produces: `create_app(...)` mounts the ICS router and no longer accepts/uses a `google` argument.

- [ ] **Step 1: Write the failing test**

```python
# tests/api/test_app_wiring.py
from weekforge.api.app import create_app


class _StubCouncil:
    pass


def test_app_exposes_ics_export_and_no_google_routes():
    app = create_app(council=_StubCouncil(), api_key="test", db_path="test_wiring.db")
    paths = {route.path for route in app.routes}
    assert "/calendar/ics/export" in paths
    assert not any(p.startswith("/auth/google") for p in paths)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/api/test_app_wiring.py -v`
Expected: FAIL — `/calendar/ics/export` not in paths (and/or `google` kwarg still present).

- [ ] **Step 3: Update `app.py`**

In `src/weekforge/api/app.py`:
- Remove `from weekforge.api.google_routes import create_google_router`.
- Add `from weekforge.api.ics_routes import create_ics_router`.
- Remove the `google=None` parameter and its docstring line.
- Replace the `if google is not None: app.include_router(create_google_router(google))` block with:

```python
    app.include_router(create_ics_router())
```

- [ ] **Step 4: Update `server.py`**

In `src/weekforge/api/server.py`:
- Delete the entire `_build_google_integration` function.
- In `build_app`, remove `google = _build_google_integration()` and pass no `google=` to `create_app`:

```python
    return create_app(
        council=council, api_key=api_key, db_path=db_path,
        allow_origins=[frontend_url],
    )
```
- Update the module docstring to drop the `GOOGLE_*` env var example block.

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest tests/api/test_app_wiring.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/weekforge/api/app.py src/weekforge/api/server.py tests/api/test_app_wiring.py
git commit -m "feat: mount ICS export router, remove Google integration wiring"
```

---

## Task 4: Delete all Google API/OAuth code, deps, and dead tests

**Files:**
- Delete: `src/weekforge/auth/`, `src/weekforge/integration.py`,
  `src/weekforge/api/google_routes.py`, `src/weekforge/providers/google_calendar.py`,
  `tests/test_integration_oauth.py`, `tests/test_google_calendar.py`,
  `tests/test_integration_calendars.py`, `tests/api/test_google_routes.py`, `tests/auth/`.
- Modify: `pyproject.toml`

**Interfaces:** none (pure removal). After this task nothing imports the deleted modules.

- [ ] **Step 1: Verify nothing still references the doomed modules**

Run:
```bash
grep -rnE "google_routes|integration import|weekforge\.auth|google_calendar|GoogleIntegration|RealGoogleCalendarClient" src tests | grep -v "ics_"
```
Expected: no hits in `src/` or non-deleted tests. (Hits only in the files deleted in Step 2 are fine.)

- [ ] **Step 2: Delete the modules and dead tests**

```bash
git rm -r src/weekforge/auth src/weekforge/integration.py \
  src/weekforge/api/google_routes.py src/weekforge/providers/google_calendar.py \
  tests/test_integration_oauth.py tests/test_google_calendar.py \
  tests/test_integration_calendars.py tests/api/test_google_routes.py tests/auth
```

- [ ] **Step 3: Remove Google deps from `pyproject.toml`**

Delete these three lines from `[project].dependencies`:
```
    "google-auth>=2.29",
    "google-auth-oauthlib>=1.2",
    "google-api-python-client>=2.126",
```

- [ ] **Step 4: Re-lock and run the full suite**

Run:
```bash
uv sync && uv run pytest
```
Expected: PASS — no import errors, no references to removed modules.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove Google Calendar API/OAuth code and dependencies"
```

---

## Task 5: Frontend API client — exportIcs

**Files:**
- Modify: `frontend/lib/api.ts`
- Test: `frontend/lib/api.test.ts` (create if absent)

**Interfaces:**
- Produces: `exportIcs(weekStart: string, blocks: TimeBlock[], timeZone?, base?): Promise<Blob>` → POST JSON to `/calendar/ics/export`, returns the `.ics` blob.
- Removes: `googleStatus`, `googleLoginUrl`, `googleDisconnectUrl`, `googleDisconnect`, `listCalendars`, `importBusy`, `exportSchedule`, `CalendarInfo`, `ExportResult`.

- [ ] **Step 1: Read the Next.js docs note** (`frontend/AGENTS.md`) — confirm no app-router fetch caveats apply to this client-side `fetch`.

- [ ] **Step 2: Write the failing test**

```ts
// frontend/lib/api.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { exportIcs } from "@/lib/api";

afterEach(() => vi.restoreAllMocks());

describe("exportIcs", () => {
  it("POSTs blocks and returns a blob", async () => {
    const blob = new Blob(["BEGIN:VCALENDAR"], { type: "text/calendar" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
    vi.stubGlobal("fetch", fetchMock);
    const out = await exportIcs("2026-06-15T00:00:00", [], "Australia/Sydney", "http://api");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api/calendar/ics/export",
      expect.objectContaining({ method: "POST" }),
    );
    expect(out).toBe(blob);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run lib/api.test.ts`
Expected: FAIL — `exportIcs` is not exported.

- [ ] **Step 4: Rewrite the calendar section of `frontend/lib/api.ts`**

Delete the `CalendarInfo`, `ExportResult` interfaces and every `google*` / `listCalendars` / `importBusy` / `exportSchedule` function. Add:

```ts
export async function exportIcs(
  weekStart: string,
  blocks: TimeBlock[],
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
  base: string = API_BASE,
): Promise<Blob> {
  const res = await fetch(`${base}/calendar/ics/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ week_start: weekStart, blocks, time_zone: timeZone }),
  });
  if (!res.ok) throw new Error(`Failed to build calendar file: ${res.status}`);
  return res.blob();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run lib/api.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/api.ts frontend/lib/api.test.ts
git commit -m "feat: frontend exportIcs, drop Google API client"
```

---

## Task 6: ExportButton downloads a .ics

**Files:**
- Modify: `frontend/components/ExportButton.tsx`, `frontend/components/ExportButton.test.tsx`

**Interfaces:**
- Produces: `ExportButton({ onExport }: { onExport: () => Promise<Blob> })`. On click it fetches the blob and triggers a browser download of `weekforge.ics`.

- [ ] **Step 1: Rewrite the test**

```tsx
// frontend/components/ExportButton.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { ExportButton } from "@/components/ExportButton";

afterEach(() => vi.restoreAllMocks());

describe("ExportButton", () => {
  it("downloads the returned .ics blob", async () => {
    const blob = new Blob(["BEGIN:VCALENDAR"], { type: "text/calendar" });
    const onExport = vi.fn().mockResolvedValue(blob);
    const createUrl = vi.fn().mockReturnValue("blob:fake");
    const revokeUrl = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<ExportButton onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: /download \.ics/i }));

    await waitFor(() => expect(onExport).toHaveBeenCalled());
    expect(createUrl).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run components/ExportButton.test.tsx`
Expected: FAIL — button text / download behavior mismatch.

- [ ] **Step 3: Rewrite `ExportButton.tsx`**

```tsx
// frontend/components/ExportButton.tsx
"use client";

import { useState } from "react";

export function ExportButton({ onExport }: { onExport: () => Promise<Blob> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const blob = await onExport();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "weekforge.ics";
      a.click();
      URL.revokeObjectURL(url);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="self-start rounded-lg bg-gradient-to-br from-ember to-amber px-4 py-2 text-sm font-semibold text-[#1a1208] disabled:opacity-50"
      >
        {busy ? "Building…" : "Download .ics"}
      </button>
      <p className="text-xs leading-relaxed text-muted" data-testid="export-safety-note">
        WeekForge builds a calendar file — your existing calendar is never touched. Import it
        into Google, Apple, or Outlook.
      </p>
      {done && (
        <p className="text-sm text-emerald-300" data-testid="export-result">
          Calendar file downloaded. Open it to import this week into your calendar app.
        </p>
      )}
      {error && (
        <p className="text-sm text-rose-300" data-testid="export-error">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run components/ExportButton.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ExportButton.tsx frontend/components/ExportButton.test.tsx
git commit -m "feat: ExportButton downloads a .ics file"
```

---

## Task 7: Rewire the app page — remove login gate + Google import UI, wire download

**Files:**
- Modify: `frontend/app/app/page.tsx`
- Delete: `frontend/components/GoogleConnect.tsx` (+`.test.tsx`),
  `frontend/components/CalendarPicker.tsx` (+`.test.tsx`),
  `frontend/lib/useGoogleCalendar.ts` (+`.test.ts`)

**Interfaces:**
- Consumes: `exportIcs` (Task 5), `ExportButton` (Task 6). Manual busy-block entry in `TaskForm` is unchanged.

- [ ] **Step 1: Read the Next.js docs** (`frontend/AGENTS.md` → `node_modules/next/dist/docs/`) for any client-component/app-router caveats before editing the page.

- [ ] **Step 2: Delete the Google UI modules**

```bash
git rm frontend/components/GoogleConnect.tsx frontend/components/GoogleConnect.test.tsx \
  frontend/components/CalendarPicker.tsx frontend/components/CalendarPicker.test.tsx \
  frontend/lib/useGoogleCalendar.ts frontend/lib/useGoogleCalendar.test.ts
```

- [ ] **Step 3: Edit `frontend/app/app/page.tsx`**

Apply these changes:

1. **Imports** — remove these lines:
```tsx
import { useGoogleCalendar } from "@/lib/useGoogleCalendar";
import { GoogleConnect } from "@/components/GoogleConnect";
import { CalendarPicker } from "@/components/CalendarPicker";
import { ImportPreview } from "@/components/ImportPreview";
import { googleLoginUrl, exportSchedule } from "@/lib/api";
import { BusyBlockInput, TimeBlock, StartDebateRequest } from "@/lib/types";
```
   and add:
```tsx
import { exportIcs } from "@/lib/api";
import { TimeBlock, StartDebateRequest } from "@/lib/types";
```

2. **Remove** `const google = useGoogleCalendar();` and the Google/import state +
   helpers that are now dead: `imported`, `importError`, `importing`, `importDone`,
   `importRequestIdRef`, `handleImport`, the `googleSlot` JSX block, and (in
   `handleWeekChange`) the `setImported([])` / `setImportDone(false)` / `setImportError(null)` /
   `setImporting(false)` lines. Keep `weekStart`, `latestWeekStartRef`, and the
   `handleWeekChange` shell (it still updates the week).

3. **Simplify `handleStart`** (drop the imported-block merge):
```tsx
  function handleStart(req: StartDebateRequest) {
    start({ ...req, week_start: weekStart });
  }
```

4. **Replace the `googleSlot` prop** passed to `TaskForm`. The form's `googleSlot` is an
   optional `ReactNode`; pass `undefined` (or remove the prop):
```tsx
        <TaskForm
          onStart={handleStart}
          weekStart={weekStart}
          onWeekChange={handleWeekChange}
        />
```

5. **Remove the login gate** — delete the entire block:
```tsx
  if (!google.statusKnown) return null;

  if (!google.connected) {
    return ( ... );  // the whole "Sign in with Google" <main> block
  }
```

6. **ExportButton** — make it always render (drop `google.connected &&`) and use `exportIcs`:
```tsx
                <ExportButton
                  onExport={() => exportIcs(toLocalMidnightISO(weekStart), editedBlocks)}
                />
```

- [ ] **Step 4: Run frontend tests + typecheck + build**

Run:
```bash
cd frontend && npx vitest run && npm run build
```
Expected: PASS — no references to `useGoogleCalendar`, `GoogleConnect`, `CalendarPicker`,
`ImportPreview`, `googleLoginUrl`, `exportSchedule`, or `BusyBlockInput` remain. `TaskForm`'s
`googleSlot` prop is optional, so omitting it typechecks.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: anonymous export-only flow, remove Google login gate and import UI"
```

---

## Task 8: Docs — red lines, env vars, README, obsolete verification doc

**Files:**
- Modify: `CLAUDE.md`, `README.md`
- Delete: `docs/google-oauth-verification.md`

**Interfaces:** none.

- [ ] **Step 1: Update `CLAUDE.md`**

- In **Architecture map**: replace the `google_calendar.py`, `integration.py`, `auth/`, and
  `google_routes.py` bullets with:
  - `src/weekforge/providers/ics_writer.py` — `ICSCalendarWriter` (schedule → downloadable `.ics`, tags `X-WEEKFORGE:1`).
  - `src/weekforge/api/ics_routes.py` — `POST /calendar/ics/export`.
  - Keep the `calendar.py` bullet (its `ICSCalendarProvider` stays, unused, for the future import path).
- Replace the **"Calendar data safety"** red line with:
  > **Calendar data safety (the core invariant):** WeekForge has **no write access to any
  > calendar**. It only ever emits a standalone `.ics` file the user chooses to import. Every
  > generated event is stamped `X-WEEKFORGE:1` so a future import path can skip WeekForge's own
  > output. Never remove the marker.
- Remove the **"Import skips marked events"** red-line bullet (no import this iteration).
- In **Environment variables**: delete the `GOOGLE_OAUTH_*` and `GOOGLE_TOKEN_PATH` rows.
  Keep `WEEKFORGE_FRONTEND_URL` (still used for CORS) but drop any OAuth-redirect mention.

- [ ] **Step 2: Update `README.md`**

Add under a "Calendar" / "Limitations" section:
```markdown
- **Export is file-based and API-free.** WeekForge generates an `.ics` you download and
  import into any calendar (Google / Apple / Outlook). No Google account, no OAuth.
- **No calendar import yet.** Enter your existing commitments as busy blocks in the form;
  WeekForge cannot read them from a calendar in this version.
```
Remove any README copy describing Google Calendar connect/import/export.

- [ ] **Step 3: Delete the obsolete verification doc**

```bash
git rm docs/google-oauth-verification.md
```

- [ ] **Step 4: Full verification**

Run:
```bash
uv run pytest && cd frontend && npx vitest run && npm run build
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: reframe calendar safety red line, drop OAuth docs/env"
```

---

## Self-Review notes

- **Spec coverage:** export (Tasks 1,2,5,6,7) ✓; remove Google code/deps (Tasks 3,4) ✓;
  anonymous/no-login (Task 7 removes the gate) ✓; reframed safety red line (Task 8) ✓;
  import deferred (no import tasks; manual entry retained) ✓; extensibility/no-ownership-baked-in
  (export endpoint carries no identity — Task 2) ✓.
- **Endpoint deviation from spec** (POST export carrying edited blocks vs `GET /schedule/{id}`)
  documented at top; required by the client-side edit flow.
- **Type consistency:** `exportIcs` (Task 5) matches its usage in Task 7; `to_ics(blocks, time_zone)`
  (Task 1) matches the router call (Task 2). No `from_bytes`/import symbols remain.
