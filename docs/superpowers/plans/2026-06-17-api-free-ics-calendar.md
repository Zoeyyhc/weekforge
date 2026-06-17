# API-free ICS Calendar I/O Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace WeekForge's Google Calendar API integration with anonymous, API-free `.ics` upload (import) and `.ics` download (export), removing all Google OAuth/verification.

**Architecture:** Import is a stateless `POST` that parses uploaded `.ics` bytes into busy `TimeBlock`s; the frontend holds them and merges into the debate's `busy_blocks` on start (existing pattern). Export is a `POST` carrying the user's *edited* schedule blocks that returns a generated `.ics` file download. No Google API, no OAuth, no accounts.

**Tech Stack:** FastAPI, Pydantic, `icalendar` (already a dependency), Next.js 16 frontend, pytest + vitest.

**Spec:** `docs/superpowers/specs/2026-06-17-api-free-ics-calendar-design.md`

> **Spec refinement (intentional):** The spec sketched export as `GET /api/schedule/{id}/export.ics`. The real frontend lets the user edit blocks (`handleEditTime`/`handleDeleteBlock` in `app/app/page.tsx`) before export, and there is no server-persisted schedule keyed by id. Export is therefore `POST /calendar/ics/export` carrying the edited blocks. Import is `POST /calendar/ics/import` (multipart). Functionally identical, API-free, anonymous — honors the spec's intent.

## Global Constraints

- Python `>=3.12`; `icalendar>=5.0` is already a dependency — do **not** add new Python deps.
- **Remove** Python deps: `google-auth`, `google-auth-oauthlib`, `google-api-python-client`.
- TDD: write the failing test first (project convention; see `CLAUDE.md`).
- Frontend is **Next.js 16, NOT the version you know** — read `node_modules/next/dist/docs/` before writing any frontend code (`frontend/AGENTS.md`).
- **Safety red line (reframed):** WeekForge has **no write access to any calendar**; it only emits a standalone `.ics`. The `X-WEEKFORGE` marker exists solely so import skips WeekForge's own past output (no double-counting busy).
- v1 imports **single `VEVENT`s only** — recurring (RRULE) events are NOT expanded (known limitation).
- Tests must never call real Google/Anthropic; inject fakes through the protocol seams.
- Keep ICS endpoints free of session-ownership logic beyond what exists, so future auth stays additive.
- Frontend export copy: button reads **"Download .ics"**; safety note: "WeekForge builds a calendar file — your existing calendar is never touched."

---

## File Structure

**Backend — create:**
- `src/weekforge/providers/ics_writer.py` — `ICSCalendarWriter`: schedule blocks → `.ics` bytes.
- `src/weekforge/api/ics_routes.py` — `create_ics_router()`: import + export endpoints.
- `tests/providers/test_ics_writer.py`, `tests/api/test_ics_routes.py`

**Backend — modify:**
- `src/weekforge/providers/calendar.py` — add `ICSCalendarProvider.from_bytes` + `X-WEEKFORGE` skip.
- `src/weekforge/api/app.py` — mount ICS router; drop Google router.
- `src/weekforge/api/server.py` — drop Google integration wiring.
- `pyproject.toml` — remove Google deps.
- `CLAUDE.md`, `README.md`.

**Backend — delete:**
- `src/weekforge/auth/` (whole package), `src/weekforge/integration.py`,
  `src/weekforge/api/google_routes.py`, `src/weekforge/providers/google_calendar.py`.
- Dead tests: `tests/test_integration_oauth.py`, `tests/test_google_calendar.py`,
  `tests/test_integration_calendars.py`, `tests/api/test_google_routes.py`, `tests/auth/`.
- `docs/google-oauth-verification.md`.

**Frontend — create:**
- `frontend/components/IcsUpload.tsx` (+ `.test.tsx`) — file picker for `.ics` import.

**Frontend — modify:**
- `frontend/lib/api.ts` — replace Google functions with `importIcs` / `exportIcs`.
- `frontend/components/ExportButton.tsx` — "Download .ics" + blob download.
- `frontend/app/app/page.tsx` — remove login gate; wire upload/download.

**Frontend — delete:**
- `frontend/components/GoogleConnect.tsx` (+test), `frontend/components/CalendarPicker.tsx` (+test),
  `frontend/lib/useGoogleCalendar.ts` (+test).

---

## Task 1: ICSCalendarProvider reads uploaded bytes and skips WeekForge events

**Files:**
- Modify: `src/weekforge/providers/calendar.py`
- Test: `tests/providers/test_ics_calendar_provider.py` (create if absent)

**Interfaces:**
- Consumes: existing `ICSCalendarProvider`, `TimeBlock`.
- Produces: `ICSCalendarProvider.from_bytes(data: bytes) -> ICSCalendarProvider`; `get_busy_blocks` skips any `VEVENT` whose `X-WEEKFORGE` property is set.

- [ ] **Step 1: Write the failing test**

```python
# tests/providers/test_ics_calendar_provider.py
from datetime import datetime, timezone

from weekforge.providers.calendar import ICSCalendarProvider

ICS_WITH_MARKER = b"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:real-1
SUMMARY:Dentist
DTSTART:20260615T090000Z
DTEND:20260615T100000Z
END:VEVENT
BEGIN:VEVENT
UID:wf-1
SUMMARY:WeekForge: Deep work
DTSTART:20260615T140000Z
DTEND:20260615T160000Z
X-WEEKFORGE:1
END:VEVENT
END:VCALENDAR
"""


def test_from_bytes_parses_real_events():
    provider = ICSCalendarProvider.from_bytes(ICS_WITH_MARKER)
    start = datetime(2026, 6, 15, tzinfo=timezone.utc)
    end = datetime(2026, 6, 16, tzinfo=timezone.utc)
    blocks = provider.get_busy_blocks(start, end)
    labels = [b.label for b in blocks]
    assert labels == ["Dentist"]  # the X-WEEKFORGE event is skipped


def test_from_bytes_skips_weekforge_marked_events():
    provider = ICSCalendarProvider.from_bytes(ICS_WITH_MARKER)
    start = datetime(2026, 6, 15, tzinfo=timezone.utc)
    end = datetime(2026, 6, 16, tzinfo=timezone.utc)
    assert all("Deep work" not in b.label for b in provider.get_busy_blocks(start, end))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/providers/test_ics_calendar_provider.py -v`
Expected: FAIL — `AttributeError: type object 'ICSCalendarProvider' has no attribute 'from_bytes'`

- [ ] **Step 3: Implement `from_bytes` + marker skip**

In `src/weekforge/providers/calendar.py`, change `ICSCalendarProvider` to hold raw bytes and add `from_bytes`, and skip marked events in `get_busy_blocks`:

```python
class ICSCalendarProvider:
    """Reads busy blocks from iCalendar (.ics) data.

    Skips events tagged with the WeekForge marker (``X-WEEKFORGE``) so a
    re-uploaded WeekForge export is never re-counted as busy.
    """

    def __init__(self, ics_path: str | Path) -> None:
        self._data = Path(ics_path).read_bytes()

    @classmethod
    def from_bytes(cls, data: bytes) -> "ICSCalendarProvider":
        self = cls.__new__(cls)
        self._data = data
        return self

    def get_busy_blocks(self, start: datetime, end: datetime) -> list[TimeBlock]:
        calendar = _ICalendar.from_ical(self._data)
        blocks: list[TimeBlock] = []
        for event in calendar.walk("VEVENT"):
            if event.get("X-WEEKFORGE") is not None:
                continue  # WeekForge's own output — never re-count as busy
            block = TimeBlock(
                start=self._normalise(event.decoded("dtstart")),
                end=self._normalise(event.decoded("dtend")),
                label=str(event.get("summary", "Busy")),
            )
            if _overlaps(block, start, end):
                blocks.append(block)
        return blocks

    @staticmethod
    def _normalise(v: datetime | date) -> datetime:
        if not isinstance(v, datetime):
            return datetime(v.year, v.month, v.day, tzinfo=timezone.utc)
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/providers/test_ics_calendar_provider.py -v`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/providers/calendar.py tests/providers/test_ics_calendar_provider.py
git commit -m "feat: ICSCalendarProvider.from_bytes + skip X-WEEKFORGE events"
```

---

## Task 2: ICSCalendarWriter generates a downloadable .ics

**Files:**
- Create: `src/weekforge/providers/ics_writer.py`
- Test: `tests/providers/test_ics_writer.py`

**Interfaces:**
- Consumes: `TimeBlock` from `weekforge.models`.
- Produces: `ICSCalendarWriter().to_ics(blocks: list[TimeBlock], time_zone: str | None = None) -> bytes`. Every emitted `VEVENT` carries `X-WEEKFORGE:1`; times are emitted as UTC instants (`...Z`), so import is DST-correct and round-trips through `ICSCalendarProvider`.

- [ ] **Step 1: Write the failing test**

```python
# tests/providers/test_ics_writer.py
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from weekforge.models import TimeBlock
from weekforge.providers.calendar import ICSCalendarProvider
from weekforge.providers.ics_writer import ICSCalendarWriter


def _block(h_start, h_end, tz):
    return TimeBlock(
        start=datetime(2026, 6, 15, h_start, 0, tzinfo=tz),
        end=datetime(2026, 6, 15, h_end, 0, tzinfo=tz),
        label="Deep work",
        task_id="t1",
    )


def test_to_ics_marks_every_event_and_round_trips():
    tz = ZoneInfo("Australia/Sydney")
    data = ICSCalendarWriter().to_ics([_block(9, 11, tz)])
    text = data.decode()
    assert "BEGIN:VEVENT" in text
    assert "X-WEEKFORGE:1" in text
    # Round-trip: a provider reading this back skips it (it is WeekForge output)
    provider = ICSCalendarProvider.from_bytes(data)
    window_start = datetime(2026, 6, 15, tzinfo=timezone.utc)
    window_end = datetime(2026, 6, 16, tzinfo=timezone.utc)
    assert provider.get_busy_blocks(window_start, window_end) == []


def test_to_ics_localises_naive_wall_clock_with_time_zone():
    # Naive block = wall-clock; writer anchors to time_zone, emits the right UTC instant.
    naive = TimeBlock(
        start=datetime(2026, 6, 15, 9, 0),
        end=datetime(2026, 6, 15, 11, 0),
        label="Deep work",
        task_id="t1",
    )
    data = ICSCalendarWriter().to_ics([naive], time_zone="Australia/Sydney")
    text = data.decode()
    # Sydney is UTC+10 in June (no DST) → 09:00 local == 23:00Z prior day.
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
the user chooses to import. Every event is tagged X-WEEKFORGE:1 so a later
re-upload is skipped by ICSCalendarProvider and never re-counted as busy.
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

## Task 3: ICS API router — import + export endpoints

**Files:**
- Create: `src/weekforge/api/ics_routes.py`
- Test: `tests/api/test_ics_routes.py`

**Interfaces:**
- Consumes: `ICSCalendarProvider.from_bytes`, `ICSCalendarWriter`, `TimeBlock`.
- Produces: `create_ics_router() -> APIRouter` with:
  - `POST /calendar/ics/import` — multipart form: `file` (`.ics`) + `week_start` (ISO). Returns `{"busy_blocks": [...]}`.
  - `POST /calendar/ics/export` — JSON body `{week_start, blocks, time_zone?}`. Returns `text/calendar` attachment.

- [ ] **Step 1: Write the failing test**

```python
# tests/api/test_ics_routes.py
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from weekforge.api.ics_routes import create_ics_router

ICS = b"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//t//EN
BEGIN:VEVENT
UID:1
SUMMARY:Dentist
DTSTART:20260615T090000Z
DTEND:20260615T100000Z
END:VEVENT
END:VCALENDAR
"""


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(create_ics_router())
    return TestClient(app)


def test_import_parses_uploaded_ics():
    res = _client().post(
        "/calendar/ics/import",
        data={"week_start": "2026-06-15T00:00:00"},
        files={"file": ("cal.ics", ICS, "text/calendar")},
    )
    assert res.status_code == 200
    blocks = res.json()["busy_blocks"]
    assert [b["label"] for b in blocks] == ["Dentist"]


def test_import_rejects_non_ics():
    res = _client().post(
        "/calendar/ics/import",
        data={"week_start": "2026-06-15T00:00:00"},
        files={"file": ("notes.txt", b"hello not a calendar", "text/plain")},
    )
    assert res.status_code == 400


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/api/test_ics_routes.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'weekforge.api.ics_routes'`

- [ ] **Step 3: Implement the router**

```python
# src/weekforge/api/ics_routes.py
"""API-free calendar I/O: upload an .ics to import busy blocks, download an .ics export."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from weekforge.models import TimeBlock
from weekforge.providers.calendar import ICSCalendarProvider
from weekforge.providers.ics_writer import ICSCalendarWriter


class ExportRequest(BaseModel):
    week_start: datetime
    blocks: list[TimeBlock]
    time_zone: str | None = None  # browser IANA zone for naive (wall-clock) blocks


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def create_ics_router() -> APIRouter:
    router = APIRouter()

    @router.post("/calendar/ics/import")
    async def ics_import(file: UploadFile = File(...), week_start: datetime = Form(...)):
        raw = await file.read()
        try:
            provider = ICSCalendarProvider.from_bytes(raw)
            start = _aware(week_start)
            blocks = provider.get_busy_blocks(start, start + timedelta(days=7))
        except Exception as exc:  # malformed/non-ICS upload
            raise HTTPException(status_code=400, detail=f"Could not read .ics file: {exc}")
        return {"busy_blocks": [b.model_dump(mode="json") for b in blocks]}

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
Expected: PASS (all three). If multipart import errors with "python-multipart not installed", it is already pulled in by FastAPI/Starlette in this project; confirm with `uv run python -c "import multipart"`.

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/api/ics_routes.py tests/api/test_ics_routes.py
git commit -m "feat: ICS import/export API endpoints"
```

---

## Task 4: Mount the ICS router; remove Google wiring from the app

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


def test_app_exposes_ics_routes_and_no_google_routes():
    app = create_app(council=_StubCouncil(), api_key="test", db_path="test_wiring.db")
    paths = {route.path for route in app.routes}
    assert "/calendar/ics/import" in paths
    assert "/calendar/ics/export" in paths
    assert not any(p.startswith("/auth/google") for p in paths)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/api/test_app_wiring.py -v`
Expected: FAIL — `/calendar/ics/import` not in paths (and/or `google` kwarg still present).

- [ ] **Step 3: Update `app.py`**

Replace the Google import/mount. In `src/weekforge/api/app.py`:
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
git commit -m "feat: mount ICS router, remove Google integration wiring"
```

---

## Task 5: Delete all Google API/OAuth code, deps, and dead tests

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
Expected: no hits in `src/` or non-deleted tests. (Hits only in the files being deleted in Step 2 are fine.)

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

## Task 6: Frontend API client — importIcs / exportIcs

**Files:**
- Modify: `frontend/lib/api.ts`
- Test: `frontend/lib/api.test.ts` (create if absent)

**Interfaces:**
- Produces:
  - `importIcs(file: File, weekStart: string, base?): Promise<TimeBlock[]>` → POST multipart to `/calendar/ics/import`.
  - `exportIcs(weekStart: string, blocks: TimeBlock[], timeZone?, base?): Promise<Blob>` → POST JSON to `/calendar/ics/export`, returns the `.ics` blob.
- Removes: `googleStatus`, `googleLoginUrl`, `googleDisconnectUrl`, `googleDisconnect`, `listCalendars`, `importBusy`, `exportSchedule`, `CalendarInfo`, `ExportResult`.

- [ ] **Step 1: Read the Next.js docs note** (`frontend/AGENTS.md`) — confirm no app-router fetch caveats apply to these client-side `fetch` calls.

- [ ] **Step 2: Write the failing test**

```ts
// frontend/lib/api.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { importIcs, exportIcs } from "@/lib/api";

afterEach(() => vi.restoreAllMocks());

describe("importIcs", () => {
  it("POSTs multipart and returns busy blocks", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ busy_blocks: [{ start: "s", end: "e", label: "Dentist", task_id: null }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["BEGIN:VCALENDAR"], "cal.ics", { type: "text/calendar" });
    const blocks = await importIcs(file, "2026-06-15T00:00:00", "http://api");
    expect(fetchMock).toHaveBeenCalledWith("http://api/calendar/ics/import", expect.objectContaining({ method: "POST" }));
    expect(blocks[0].label).toBe("Dentist");
  });
});

describe("exportIcs", () => {
  it("POSTs blocks and returns a blob", async () => {
    const blob = new Blob(["BEGIN:VCALENDAR"], { type: "text/calendar" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
    vi.stubGlobal("fetch", fetchMock);
    const out = await exportIcs("2026-06-15T00:00:00", [], "Australia/Sydney", "http://api");
    expect(fetchMock).toHaveBeenCalledWith("http://api/calendar/ics/export", expect.objectContaining({ method: "POST" }));
    expect(out).toBe(blob);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run lib/api.test.ts`
Expected: FAIL — `importIcs`/`exportIcs` are not exported.

- [ ] **Step 4: Rewrite the calendar section of `frontend/lib/api.ts`**

Delete the `CalendarInfo`, `ExportResult` interfaces and every `google*` / `listCalendars` / `importBusy` / `exportSchedule` function. Add:

```ts
export async function importIcs(
  file: File,
  weekStart: string,
  base: string = API_BASE,
): Promise<TimeBlock[]> {
  const form = new FormData();
  form.set("file", file);
  form.set("week_start", weekStart);
  const res = await fetch(`${base}/calendar/ics/import`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Could not read calendar file (${res.status})`);
  const data = await res.json();
  return data.busy_blocks as TimeBlock[];
}

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
git commit -m "feat: frontend importIcs/exportIcs, drop Google API client"
```

---

## Task 7: IcsUpload component

**Files:**
- Create: `frontend/components/IcsUpload.tsx`, `frontend/components/IcsUpload.test.tsx`

**Interfaces:**
- Produces: `IcsUpload({ onFile, busy }: { onFile: (file: File) => void; busy: boolean })` — renders a `.ics` file input; calls `onFile` with the chosen file.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/IcsUpload.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { IcsUpload } from "@/components/IcsUpload";

describe("IcsUpload", () => {
  it("calls onFile with the chosen .ics", () => {
    const onFile = vi.fn();
    render(<IcsUpload onFile={onFile} busy={false} />);
    const input = screen.getByTestId("ics-input") as HTMLInputElement;
    const file = new File(["BEGIN:VCALENDAR"], "cal.ics", { type: "text/calendar" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFile).toHaveBeenCalledWith(file);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run components/IcsUpload.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// frontend/components/IcsUpload.tsx
"use client";

import { useRef } from "react";

export function IcsUpload({
  onFile,
  busy,
}: {
  onFile: (file: File) => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2">
      <input
        ref={ref}
        data-testid="ics-input"
        type="file"
        accept=".ics,text/calendar"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = ""; // allow re-selecting the same file
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => ref.current?.click()}
        className="self-start rounded-lg border border-guardian/40 bg-guardian/[0.08] px-3.5 py-2 text-sm font-semibold text-guardian transition-colors hover:border-guardian/70 hover:bg-guardian/15 disabled:opacity-50"
      >
        {busy ? "Reading…" : "↑ Upload calendar (.ics)"}
      </button>
      <p className="text-xs leading-relaxed text-muted">
        Export your calendar as an .ics file and upload it. WeekForge reads only your busy
        times — nothing is sent to Google.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run components/IcsUpload.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/components/IcsUpload.tsx frontend/components/IcsUpload.test.tsx
git commit -m "feat: IcsUpload component"
```

---

## Task 8: ExportButton downloads a .ics

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

## Task 9: Rewire the app page — remove login gate, wire upload/download, delete Google UI

**Files:**
- Modify: `frontend/app/app/page.tsx`
- Delete: `frontend/components/GoogleConnect.tsx` (+`.test.tsx`),
  `frontend/components/CalendarPicker.tsx` (+`.test.tsx`),
  `frontend/lib/useGoogleCalendar.ts` (+`.test.ts`)

**Interfaces:**
- Consumes: `importIcs`, `exportIcs` (Task 6), `IcsUpload` (Task 7), `ExportButton` (Task 8).

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
import { googleLoginUrl, exportSchedule } from "@/lib/api";
```
   and add:
```tsx
import { IcsUpload } from "@/components/IcsUpload";
import { importIcs, exportIcs } from "@/lib/api";
```

2. **Remove** `const google = useGoogleCalendar();` (line ~36).

3. **Replace `handleImport`** with a file-driven version:
```tsx
  async function handleImport(file: File) {
    const requestWeekStart = weekStart;
    const requestId = importRequestIdRef.current + 1;
    importRequestIdRef.current = requestId;
    setImporting(true);
    setImportError(null);
    setImportDone(false);
    try {
      const blocks = await importIcs(file, toLocalMidnightISO(requestWeekStart));
      if (
        importRequestIdRef.current === requestId &&
        latestWeekStartRef.current === requestWeekStart
      ) {
        setImported(blocks);
        setImportDone(true);
      }
    } catch (err) {
      if (
        importRequestIdRef.current === requestId &&
        latestWeekStartRef.current === requestWeekStart
      ) {
        setImportError(err instanceof Error ? err.message : "Could not read the calendar file.");
      }
    } finally {
      if (importRequestIdRef.current === requestId) setImporting(false);
    }
  }
```

4. **Replace the `googleSlot` JSX** with an upload slot:
```tsx
  const importSlot = (
    <div className="flex flex-col gap-3 rounded-xl border border-[#272430] bg-gradient-to-b from-[#15171f] to-[#101219] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <IcsUpload onFile={handleImport} busy={importing} />
      {importError && (
        <p className="text-sm text-rose-300" data-testid="import-error">{importError}</p>
      )}
      {importDone && imported.length === 0 && !importError && (
        <p className="text-sm text-muted" data-testid="import-empty">
          No events found for the week of {weekStart}.
        </p>
      )}
      {imported.length > 0 && (
        <ImportPreview blocks={imported} onRemove={(i) => setImported((p) => p.filter((_, j) => j !== i))} />
      )}
    </div>
  );
```

5. **Remove the login gate** — delete the entire block:
```tsx
  if (!google.statusKnown) return null;

  if (!google.connected) {
    return ( ... );  // the whole "Sign in with Google" <main> block
  }
```

6. **Pass `importSlot`** to `TaskForm` (rename the prop usage): change `googleSlot={googleSlot}` to `googleSlot={importSlot}` (keep the `TaskForm` prop name unless you also rename it in `TaskForm.tsx`).

7. **ExportButton** — make it always render (drop `google.connected &&`) and use `exportIcs`:
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
Expected: PASS — no references to `useGoogleCalendar`, `GoogleConnect`, `CalendarPicker`, `googleLoginUrl`, or `exportSchedule` remain. If `TaskForm` types `googleSlot`, it still accepts a `ReactNode` — no change needed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: anonymous .ics upload/download flow, remove Google login gate"
```

---

## Task 10: Docs — red lines, env vars, README limitation, obsolete verification doc

**Files:**
- Modify: `CLAUDE.md`, `README.md`
- Delete: `docs/google-oauth-verification.md`

**Interfaces:** none.

- [ ] **Step 1: Update `CLAUDE.md`**

- In **Architecture map**: replace the `google_calendar.py`, `integration.py`, `auth/`, and `google_routes.py` bullets with:
  - `src/weekforge/providers/calendar.py` — `CalendarProvider` protocol + `ICSCalendarProvider` (reads uploaded `.ics`, skips `X-WEEKFORGE` events).
  - `src/weekforge/providers/ics_writer.py` — `ICSCalendarWriter` (schedule → downloadable `.ics`, tags `X-WEEKFORGE:1`).
  - `src/weekforge/api/ics_routes.py` — `POST /calendar/ics/import`, `POST /calendar/ics/export`.
- Replace the **"Calendar data safety"** red line with:
  > **Calendar data safety (the core invariant):** WeekForge has **no write access to any calendar**. It only ever emits a standalone `.ics` file the user chooses to import. Every generated event carries `extendedProperties`-style marker `X-WEEKFORGE:1`; **import skips `X-WEEKFORGE` events** so WeekForge never re-counts its own output as busy. Never remove the marker or the import-skip.
- Remove the **"Import skips marked events"** bullet's Google-specific wording (now covered above).
- In **Environment variables**: delete the `GOOGLE_OAUTH_*`, `GOOGLE_TOKEN_PATH`, and `WEEKFORGE_FRONTEND_URL` (OAuth-redirect) rows that only served OAuth. Keep `WEEKFORGE_FRONTEND_URL` only if still used for CORS (it is — keep it, drop the OAuth mention).

- [ ] **Step 2: Add the known limitation to `README.md`**

Add under a "Limitations" or "Calendar" section:
```markdown
- **Calendar sync is file-based.** Import by uploading an `.ics` export of your calendar;
  export downloads an `.ics` you import back. WeekForge never connects to Google — no
  account, no OAuth.
- **Recurring events (RRULE) are not yet expanded on import** — a weekly meeting defined
  as a recurrence won't register as busy. Add single events for now.
```

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
git commit -m "docs: reframe calendar safety red line, drop OAuth docs/env, note RRULE limit"
```

---

## Self-Review notes

- **Spec coverage:** import (Tasks 1,3,6,7,9) ✓; export (Tasks 2,3,6,8,9) ✓; remove Google code/deps (Tasks 4,5) ✓; anonymous/no-login (Task 9 removes the gate) ✓; reframed safety red line (Task 10) ✓; RRULE known-limitation (Tasks 1,10) ✓; extensibility/no-ownership-baked-in (endpoints carry no identity — Task 3) ✓.
- **Endpoint deviation from spec** (POST export carrying edited blocks vs `GET /schedule/{id}`) is documented at the top and is required by the client-side edit flow.
- **Type consistency:** `importIcs`/`exportIcs` (Task 6) match their usage in Task 9; `to_ics(blocks, time_zone)` (Task 2) matches the router call (Task 3); `from_bytes` (Task 1) matches router + writer test usage.
