# Google Calendar Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user connect their Google account to WeekForge, import their existing calendar events as busy blocks, and after the council forges the week, export the schedule into a dedicated "WeekForge" Google Calendar.

**Architecture:** A `GoogleIntegration` facade (injected into the FastAPI app like `council` already is) composes three independently-tested layers: an `OAuthTokenStore` for persisting credentials as JSON, a thin `GoogleCalendarClient` adapter (the testability seam — tests inject a fake), and a `GoogleCalendarProvider`/`GoogleCalendarWriter` pair that hold all domain logic. Six new routes hang off the existing FastAPI app. The debate engine is untouched.

**Tech Stack:** Python 3.12, `google-auth`, `google-auth-oauthlib`, `google-api-python-client`, FastAPI, pytest, `httpx` (already in dev deps).

---

## File map

| File | Create / Modify | Responsibility |
|---|---|---|
| `src/weekforge/auth/__init__.py` | Create | package marker |
| `src/weekforge/auth/token_store.py` | Create | `OAuthTokenStore` protocol + `JsonFileTokenStore` |
| `src/weekforge/auth/google_oauth.py` | Create | build auth URL, exchange code for credentials |
| `src/weekforge/providers/calendar.py` | Modify | add `CalendarWriter` protocol beside `CalendarProvider` |
| `src/weekforge/providers/google_calendar.py` | Create | `GoogleCalendarClient` protocol + real impl + `GoogleCalendarProvider` + `GoogleCalendarWriter` |
| `src/weekforge/integration.py` | Create | `GoogleIntegration` facade |
| `src/weekforge/api/google_routes.py` | Create | six new routes as a separate `APIRouter` |
| `src/weekforge/api/app.py` | Modify | inject `GoogleIntegration` |
| `src/weekforge/api/server.py` | Modify | build `GoogleIntegration` from env vars |
| `pyproject.toml` | Modify | add three google deps |
| `tests/auth/__init__.py` | Create | package marker |
| `tests/auth/test_token_store.py` | Create | `JsonFileTokenStore` unit tests |
| `tests/test_google_calendar.py` | Create | provider + writer tests against fake client |
| `tests/api/test_google_routes.py` | Create | route tests with fake `GoogleIntegration` |

---

## Task 1 — Add Google deps + `CalendarWriter` protocol

**Files:**
- Modify: `pyproject.toml`
- Modify: `src/weekforge/providers/calendar.py`

- [ ] **Step 1: Add Google libraries to `pyproject.toml`**

In the `dependencies` list, add three entries:

```toml
dependencies = [
    "pydantic>=2.7",
    "icalendar>=5.0",
    "langgraph>=0.2",
    "langgraph-checkpoint-sqlite>=2.0",
    "crewai>=0.80",
    "anthropic>=0.40",
    "fastapi>=0.110",
    "uvicorn[standard]>=0.27",
    "google-auth>=2.29",
    "google-auth-oauthlib>=1.2",
    "google-api-python-client>=2.126",
]
```

- [ ] **Step 2: Install the new deps**

Run: `cd /Users/Najum/weekforge && uv sync`
Expected: resolves and installs the three google packages without error.

- [ ] **Step 3: Add `CalendarWriter` protocol to `providers/calendar.py`**

Append after the existing `ICSCalendarProvider` class:

```python
@runtime_checkable
class CalendarWriter(Protocol):
    """A sink for writing time blocks back to a calendar."""

    def write_blocks(
        self,
        blocks: list[TimeBlock],
        week_start: datetime,
        week_end: datetime,
    ) -> int:
        """Write blocks to the calendar, replacing any previously-written blocks
        for the same [week_start, week_end) range. Returns the number written."""
        ...
```

- [ ] **Step 4: Verify the import is clean**

Run: `cd /Users/Najum/weekforge && uv run python -c "from weekforge.providers.calendar import CalendarWriter; print('ok')"`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml uv.lock src/weekforge/providers/calendar.py
git commit -m "feat: add Google deps and CalendarWriter protocol"
```

---

## Task 2 — `OAuthTokenStore` + `JsonFileTokenStore`

**Files:**
- Create: `src/weekforge/auth/__init__.py`
- Create: `src/weekforge/auth/token_store.py`
- Create: `tests/auth/__init__.py`
- Create: `tests/auth/test_token_store.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/auth/__init__.py` (empty) and `tests/auth/test_token_store.py`:

```python
"""Tests for OAuthTokenStore / JsonFileTokenStore."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from weekforge.auth.token_store import JsonFileTokenStore


def _creds() -> dict:
    return {
        "token": "access-token-abc",
        "refresh_token": "refresh-token-xyz",
        "token_uri": "https://oauth2.googleapis.com/token",
        "client_id": "client-id",
        "client_secret": "client-secret",
        "scopes": ["https://www.googleapis.com/auth/calendar"],
    }


def test_save_and_load_round_trip(tmp_path):
    store = JsonFileTokenStore(tmp_path / "token.json")
    creds = _creds()

    store.save(creds)
    loaded = store.load()

    assert loaded == creds


def test_load_returns_none_when_file_absent(tmp_path):
    store = JsonFileTokenStore(tmp_path / "token.json")
    assert store.load() is None


def test_save_creates_parent_directories(tmp_path):
    path = tmp_path / "nested" / "dir" / "token.json"
    store = JsonFileTokenStore(path)

    store.save(_creds())

    assert path.exists()


def test_clear_removes_file(tmp_path):
    store = JsonFileTokenStore(tmp_path / "token.json")
    store.save(_creds())

    store.clear()

    assert store.load() is None


def test_clear_is_idempotent_when_file_absent(tmp_path):
    store = JsonFileTokenStore(tmp_path / "token.json")
    store.clear()  # must not raise


def test_file_content_is_valid_json(tmp_path):
    path = tmp_path / "token.json"
    store = JsonFileTokenStore(path)
    store.save(_creds())

    raw = json.loads(path.read_text())
    assert raw["refresh_token"] == "refresh-token-xyz"
```

- [ ] **Step 2: Run to verify tests fail**

Run: `cd /Users/Najum/weekforge && uv run pytest tests/auth/test_token_store.py -v`
Expected: FAIL — `ModuleNotFoundError: weekforge.auth.token_store`

- [ ] **Step 3: Create `src/weekforge/auth/__init__.py`** (empty)

```python
```

- [ ] **Step 4: Create `src/weekforge/auth/token_store.py`**

```python
"""OAuth credential persistence behind the OAuthTokenStore protocol."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol, runtime_checkable


@runtime_checkable
class OAuthTokenStore(Protocol):
    """Save, load, and clear serialised OAuth credentials."""

    def save(self, credentials: dict) -> None: ...
    def load(self) -> dict | None: ...
    def clear(self) -> None: ...


class JsonFileTokenStore:
    """Persists credentials as a JSON file on a local (or mounted) path."""

    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)

    def save(self, credentials: dict) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps(credentials))

    def load(self) -> dict | None:
        if not self._path.exists():
            return None
        return json.loads(self._path.read_text())

    def clear(self) -> None:
        if self._path.exists():
            self._path.unlink()
```

- [ ] **Step 5: Run to verify tests pass**

Run: `cd /Users/Najum/weekforge && uv run pytest tests/auth/test_token_store.py -v`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add src/weekforge/auth/__init__.py src/weekforge/auth/token_store.py \
        tests/auth/__init__.py tests/auth/test_token_store.py
git commit -m "feat: add OAuthTokenStore protocol and JsonFileTokenStore"
```

---

## Task 3 — `GoogleCalendarClient` protocol + `GoogleCalendarProvider` + `GoogleCalendarWriter`

**Files:**
- Create: `src/weekforge/providers/google_calendar.py`
- Create: `tests/test_google_calendar.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_google_calendar.py`:

```python
"""Tests for GoogleCalendarProvider and GoogleCalendarWriter against a fake client."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from weekforge.models import TimeBlock
from weekforge.providers.google_calendar import (
    GoogleCalendarProvider,
    GoogleCalendarWriter,
)


def _utc(y, m, d, h=0, mn=0) -> datetime:
    return datetime(y, m, d, h, mn, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Fake GoogleCalendarClient
# ---------------------------------------------------------------------------

class FakeGoogleCalendarClient:
    """In-memory stand-in. Records writes, returns seeded events on reads."""

    def __init__(self, events: list[dict] | None = None) -> None:
        self._events: list[dict] = events or []
        self.inserted: list[dict] = []
        self.deleted_ranges: list[tuple] = []
        self._calendars: dict[str, str] = {}

    def list_events(self, calendar_id: str, start: datetime, end: datetime) -> list[dict]:
        return [
            e for e in self._events
            if e.get("_calendar_id") == calendar_id
            and e["start_dt"] < end
            and e["end_dt"] > start
        ]

    def find_calendar(self, name: str) -> str | None:
        return self._calendars.get(name)

    def create_calendar(self, name: str) -> str:
        cal_id = f"cal-{name.lower()}"
        self._calendars[name] = cal_id
        return cal_id

    def insert_event(self, calendar_id: str, event: dict) -> str:
        event["_calendar_id"] = calendar_id
        event["_id"] = f"evt-{len(self.inserted)}"
        self.inserted.append(event)
        return event["_id"]

    def delete_events_in_range(self, calendar_id: str, start: datetime, end: datetime) -> None:
        self.deleted_ranges.append((calendar_id, start, end))
        self._events = [
            e for e in self._events
            if not (
                e.get("_calendar_id") == calendar_id
                and e["start_dt"] < end
                and e["end_dt"] > start
            )
        ]


# ---------------------------------------------------------------------------
# GoogleCalendarProvider tests
# ---------------------------------------------------------------------------

def _gcal_event(summary: str, start: datetime, end: datetime, calendar_id: str = "primary") -> dict:
    return {
        "summary": summary,
        "start": {"dateTime": start.isoformat()},
        "end": {"dateTime": end.isoformat()},
        "start_dt": start,
        "end_dt": end,
        "_calendar_id": calendar_id,
    }


def _allday_event(summary: str, date_str: str, calendar_id: str = "primary") -> dict:
    from datetime import date
    d = date.fromisoformat(date_str)
    start = _utc(d.year, d.month, d.day, 0, 0)
    end = _utc(d.year, d.month, d.day + 1, 0, 0)
    return {
        "summary": summary,
        "start": {"date": date_str},
        "end": {"date": date_str},
        "start_dt": start,
        "end_dt": end,
        "_calendar_id": calendar_id,
    }


class TestGoogleCalendarProvider:
    def test_returns_blocks_in_range(self):
        client = FakeGoogleCalendarClient(events=[
            _gcal_event("Standup", _utc(2026, 6, 15, 9), _utc(2026, 6, 15, 10)),
            _gcal_event("Next week", _utc(2026, 6, 22, 9), _utc(2026, 6, 22, 10)),
        ])
        provider = GoogleCalendarProvider(client)

        blocks = provider.get_busy_blocks(_utc(2026, 6, 15), _utc(2026, 6, 22))

        assert len(blocks) == 1
        assert blocks[0].label == "Standup"
        assert blocks[0].start == _utc(2026, 6, 15, 9)
        assert blocks[0].end == _utc(2026, 6, 15, 10)

    def test_normalises_allday_event_to_utc_midnight(self):
        client = FakeGoogleCalendarClient(events=[
            _allday_event("Holiday", "2026-06-15"),
        ])
        provider = GoogleCalendarProvider(client)

        blocks = provider.get_busy_blocks(_utc(2026, 6, 15), _utc(2026, 6, 16))

        assert len(blocks) == 1
        assert blocks[0].label == "Holiday"
        assert blocks[0].start == _utc(2026, 6, 15, 0, 0)

    def test_returns_empty_when_no_events(self):
        client = FakeGoogleCalendarClient()
        provider = GoogleCalendarProvider(client)

        blocks = provider.get_busy_blocks(_utc(2026, 6, 15), _utc(2026, 6, 22))

        assert blocks == []

    def test_uses_summary_as_label(self):
        client = FakeGoogleCalendarClient(events=[
            _gcal_event("Team sync", _utc(2026, 6, 15, 9), _utc(2026, 6, 15, 10)),
        ])
        provider = GoogleCalendarProvider(client)

        blocks = provider.get_busy_blocks(_utc(2026, 6, 15), _utc(2026, 6, 22))

        assert blocks[0].label == "Team sync"

    def test_falls_back_to_busy_when_no_summary(self):
        event = _gcal_event("", _utc(2026, 6, 15, 9), _utc(2026, 6, 15, 10))
        event["summary"] = ""
        client = FakeGoogleCalendarClient(events=[event])
        provider = GoogleCalendarProvider(client)

        blocks = provider.get_busy_blocks(_utc(2026, 6, 15), _utc(2026, 6, 22))

        assert blocks[0].label == "Busy"


# ---------------------------------------------------------------------------
# GoogleCalendarWriter tests
# ---------------------------------------------------------------------------

class TestGoogleCalendarWriter:
    def _blocks(self) -> list[TimeBlock]:
        return [
            TimeBlock(
                start=_utc(2026, 6, 15, 9),
                end=_utc(2026, 6, 15, 11),
                label="Write report",
                task_id="t1",
            ),
            TimeBlock(
                start=_utc(2026, 6, 16, 13),
                end=_utc(2026, 6, 16, 14),
                label="Review PRs",
                task_id="t2",
            ),
        ]

    def test_creates_weekforge_calendar_if_absent(self):
        client = FakeGoogleCalendarClient()
        writer = GoogleCalendarWriter(client, calendar_name="WeekForge")

        writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))

        assert client.find_calendar("WeekForge") is not None

    def test_reuses_existing_calendar(self):
        client = FakeGoogleCalendarClient()
        client.create_calendar("WeekForge")
        writer = GoogleCalendarWriter(client, calendar_name="WeekForge")

        writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))

        # Only one calendar should exist — not duplicated.
        assert len(client._calendars) == 1

    def test_inserts_one_event_per_block(self):
        client = FakeGoogleCalendarClient()
        writer = GoogleCalendarWriter(client, calendar_name="WeekForge")

        count = writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))

        assert count == 2
        assert len(client.inserted) == 2

    def test_event_title_matches_block_label(self):
        client = FakeGoogleCalendarClient()
        writer = GoogleCalendarWriter(client, calendar_name="WeekForge")

        writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))

        titles = [e["summary"] for e in client.inserted]
        assert "Write report" in titles
        assert "Review PRs" in titles

    def test_clears_existing_events_before_writing(self):
        client = FakeGoogleCalendarClient()
        writer = GoogleCalendarWriter(client, calendar_name="WeekForge")

        # First export.
        writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))
        # Second export — should clear + re-write, not accumulate.
        writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))

        assert len(client.deleted_ranges) == 2
        assert len(client.inserted) == 4  # 2 on first run + 2 on second

    def test_returns_count_of_written_events(self):
        client = FakeGoogleCalendarClient()
        writer = GoogleCalendarWriter(client, calendar_name="WeekForge")

        count = writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))

        assert count == 2
```

- [ ] **Step 2: Run to verify tests fail**

Run: `cd /Users/Najum/weekforge && uv run pytest tests/test_google_calendar.py -v`
Expected: FAIL — `ModuleNotFoundError: weekforge.providers.google_calendar`

- [ ] **Step 3: Create `src/weekforge/providers/google_calendar.py`**

```python
"""Google Calendar provider (read) and writer (export).

The GoogleCalendarClient protocol is the testability seam — tests inject a
FakeGoogleCalendarClient; production injects RealGoogleCalendarClient.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Protocol, runtime_checkable

from weekforge.models import TimeBlock


# ---------------------------------------------------------------------------
# Thin adapter protocol — the only Google API calls we make
# ---------------------------------------------------------------------------

@runtime_checkable
class GoogleCalendarClient(Protocol):
    def list_events(self, calendar_id: str, start: datetime, end: datetime) -> list[dict]: ...
    def find_calendar(self, name: str) -> str | None: ...
    def create_calendar(self, name: str) -> str: ...
    def insert_event(self, calendar_id: str, event: dict) -> str: ...
    def delete_events_in_range(self, calendar_id: str, start: datetime, end: datetime) -> None: ...


# ---------------------------------------------------------------------------
# Real thin adapter (wraps google-api-python-client)
# ---------------------------------------------------------------------------

class RealGoogleCalendarClient:
    """Thin pass-through adapter over the Google Calendar API.

    Receives a built googleapiclient service object from the caller.
    """

    def __init__(self, service) -> None:
        self._svc = service

    def list_events(self, calendar_id: str, start: datetime, end: datetime) -> list[dict]:
        resp = (
            self._svc.events()
            .list(
                calendarId=calendar_id,
                timeMin=start.isoformat(),
                timeMax=end.isoformat(),
                singleEvents=True,
            )
            .execute()
        )
        raw = resp.get("items", [])
        for e in raw:
            # Attach parsed datetimes so callers don't need to re-parse.
            e["start_dt"] = self._parse_dt(e["start"])
            e["end_dt"] = self._parse_dt(e["end"])
        return raw

    def find_calendar(self, name: str) -> str | None:
        resp = self._svc.calendarList().list().execute()
        for cal in resp.get("items", []):
            if cal.get("summary") == name:
                return cal["id"]
        return None

    def create_calendar(self, name: str) -> str:
        cal = self._svc.calendars().insert(body={"summary": name}).execute()
        return cal["id"]

    def insert_event(self, calendar_id: str, event: dict) -> str:
        result = self._svc.events().insert(calendarId=calendar_id, body=event).execute()
        return result["id"]

    def delete_events_in_range(self, calendar_id: str, start: datetime, end: datetime) -> None:
        resp = (
            self._svc.events()
            .list(
                calendarId=calendar_id,
                timeMin=start.isoformat(),
                timeMax=end.isoformat(),
                singleEvents=True,
            )
            .execute()
        )
        for event in resp.get("items", []):
            self._svc.events().delete(calendarId=calendar_id, eventId=event["id"]).execute()

    @staticmethod
    def _parse_dt(dt_field: dict) -> datetime:
        if "dateTime" in dt_field:
            return datetime.fromisoformat(dt_field["dateTime"]).astimezone(timezone.utc)
        # All-day event: "date" field only — treat as UTC midnight.
        d = dt_field["date"]  # "YYYY-MM-DD"
        parts = [int(x) for x in d.split("-")]
        return datetime(parts[0], parts[1], parts[2], tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# GoogleCalendarProvider — implements CalendarProvider
# ---------------------------------------------------------------------------

class GoogleCalendarProvider:
    """Reads busy blocks from the user's primary Google Calendar."""

    def __init__(self, client: GoogleCalendarClient) -> None:
        self._client = client

    def get_busy_blocks(self, start: datetime, end: datetime) -> list[TimeBlock]:
        raw_events = self._client.list_events("primary", start, end)
        blocks: list[TimeBlock] = []
        for e in raw_events:
            label = e.get("summary") or "Busy"
            blocks.append(
                TimeBlock(
                    start=e["start_dt"],
                    end=e["end_dt"],
                    label=label,
                )
            )
        return blocks


# ---------------------------------------------------------------------------
# GoogleCalendarWriter — implements CalendarWriter
# ---------------------------------------------------------------------------

class GoogleCalendarWriter:
    """Writes forged schedule blocks into a dedicated WeekForge calendar.

    Re-export for the same week first clears the calendar range, then writes
    fresh events — idempotent by design. Only the WeekForge calendar is ever
    touched; the user's primary calendar is never modified.
    """

    def __init__(self, client: GoogleCalendarClient, calendar_name: str = "WeekForge") -> None:
        self._client = client
        self._calendar_name = calendar_name

    def write_blocks(
        self,
        blocks: list[TimeBlock],
        week_start: datetime,
        week_end: datetime,
    ) -> int:
        cal_id = self._client.find_calendar(self._calendar_name)
        if cal_id is None:
            cal_id = self._client.create_calendar(self._calendar_name)

        self._client.delete_events_in_range(cal_id, week_start, week_end)

        for block in blocks:
            event = {
                "summary": block.label,
                "start": {"dateTime": block.start.isoformat()},
                "end": {"dateTime": block.end.isoformat()},
            }
            self._client.insert_event(cal_id, event)

        return len(blocks)
```

- [ ] **Step 4: Run to verify tests pass**

Run: `cd /Users/Najum/weekforge && uv run pytest tests/test_google_calendar.py -v`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/providers/google_calendar.py tests/test_google_calendar.py
git commit -m "feat: add GoogleCalendarProvider and GoogleCalendarWriter"
```

---

## Task 4 — `google_oauth` module

**Files:**
- Create: `src/weekforge/auth/google_oauth.py`

No separate unit test here — the OAuth module is a thin wrapper over `google-auth-oauthlib` whose real value is the live redirect flow. It is tested end-to-end in the route tests (Task 6) via fake injection, and by manual smoke.

- [ ] **Step 1: Create `src/weekforge/auth/google_oauth.py`**

```python
"""Helpers for the Google OAuth 2.0 authorization-code flow.

Config comes entirely from environment variables so local and deployed
environments differ only by .env values, not code.
"""

from __future__ import annotations

import os

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow

SCOPES = ["https://www.googleapis.com/auth/calendar"]


def _client_config() -> dict:
    return {
        "web": {
            "client_id": os.environ["GOOGLE_OAUTH_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_OAUTH_CLIENT_SECRET"],
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [os.environ["GOOGLE_OAUTH_REDIRECT_URI"]],
        }
    }


def build_authorization_url() -> tuple[str, str]:
    """Return (authorization_url, state) for the OAuth consent redirect."""
    flow = Flow.from_client_config(
        _client_config(),
        scopes=SCOPES,
        redirect_uri=os.environ["GOOGLE_OAUTH_REDIRECT_URI"],
    )
    url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    return url, state


def exchange_code(code: str) -> dict:
    """Exchange the callback auth code for credentials dict (access + refresh token)."""
    flow = Flow.from_client_config(
        _client_config(),
        scopes=SCOPES,
        redirect_uri=os.environ["GOOGLE_OAUTH_REDIRECT_URI"],
    )
    flow.fetch_token(code=code)
    creds: Credentials = flow.credentials
    return {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes or SCOPES),
    }


def credentials_from_dict(data: dict) -> Credentials:
    """Rebuild a Credentials object from a stored dict (handles refresh automatically)."""
    return Credentials(
        token=data["token"],
        refresh_token=data.get("refresh_token"),
        token_uri=data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=data.get("client_id"),
        client_secret=data.get("client_secret"),
        scopes=data.get("scopes", SCOPES),
    )
```

- [ ] **Step 2: Verify the import is clean**

Run: `cd /Users/Najum/weekforge && uv run python -c "from weekforge.auth.google_oauth import build_authorization_url; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add src/weekforge/auth/google_oauth.py
git commit -m "feat: add google_oauth helpers for auth-code flow"
```

---

## Task 5 — `GoogleIntegration` facade

**Files:**
- Create: `src/weekforge/integration.py`

The facade wires together the token store, provider, writer, and OAuth helpers. The route tests (Task 6) inject a `FakeGoogleIntegration` instead of this class.

- [ ] **Step 1: Create `src/weekforge/integration.py`**

```python
"""GoogleIntegration facade — composes auth, provider, and writer.

Injected into the FastAPI app identically to how `council` is already injected.
Tests inject a FakeGoogleIntegration; this class is verified by manual smoke.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from googleapiclient.discovery import build as _build_service

from weekforge.auth.google_oauth import credentials_from_dict, build_authorization_url, exchange_code
from weekforge.auth.token_store import OAuthTokenStore
from weekforge.models import TimeBlock
from weekforge.providers.google_calendar import (
    GoogleCalendarWriter,
    GoogleCalendarProvider,
    RealGoogleCalendarClient,
)


class GoogleIntegration:
    """Facade used by all Google Calendar routes."""

    def __init__(
        self,
        token_store: OAuthTokenStore,
        calendar_name: str = "WeekForge",
        frontend_url: str = "http://localhost:3000",
    ) -> None:
        self._store = token_store
        self._calendar_name = calendar_name
        self._frontend_url = frontend_url

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    def is_connected(self) -> bool:
        return self._store.load() is not None

    def login_url(self) -> str:
        url, _state = build_authorization_url()
        return url

    def complete_login(self, code: str) -> None:
        creds_dict = exchange_code(code)
        self._store.save(creds_dict)

    def disconnect(self) -> None:
        self._store.clear()

    def frontend_url(self) -> str:
        return self._frontend_url

    # ------------------------------------------------------------------
    # Calendar read/write — build client from stored credentials
    # ------------------------------------------------------------------

    def _client(self) -> RealGoogleCalendarClient:
        data = self._store.load()
        if data is None:
            raise RuntimeError("Not connected to Google Calendar")
        creds = credentials_from_dict(data)
        service = _build_service("calendar", "v3", credentials=creds)
        return RealGoogleCalendarClient(service)

    def import_busy(self, week_start: datetime) -> list[TimeBlock]:
        week_end = week_start + timedelta(days=7)
        provider = GoogleCalendarProvider(self._client())
        return provider.get_busy_blocks(week_start, week_end)

    def export_schedule(
        self, blocks: list[TimeBlock], week_start: datetime
    ) -> tuple[int, str]:
        """Write blocks to the WeekForge calendar. Returns (written_count, calendar_url)."""
        week_end = week_start + timedelta(days=7)
        writer = GoogleCalendarWriter(self._client(), calendar_name=self._calendar_name)
        count = writer.write_blocks(blocks, week_start, week_end)
        calendar_url = "https://calendar.google.com/calendar/r/week"
        return count, calendar_url


class UnconfiguredGoogleIntegration:
    """Returned when Google env vars are absent. All routes gracefully return not-connected."""

    def is_connected(self) -> bool:
        return False

    def login_url(self) -> str:
        raise RuntimeError("Google OAuth is not configured")

    def complete_login(self, code: str) -> None:
        raise RuntimeError("Google OAuth is not configured")

    def disconnect(self) -> None:
        pass

    def frontend_url(self) -> str:
        return os.environ.get("WEEKFORGE_FRONTEND_URL", "http://localhost:3000")

    def import_busy(self, week_start: datetime) -> list[TimeBlock]:
        raise RuntimeError("Google Calendar is not configured")

    def export_schedule(self, blocks: list[TimeBlock], week_start: datetime) -> tuple[int, str]:
        raise RuntimeError("Google Calendar is not configured")
```

- [ ] **Step 2: Verify the import is clean**

Run: `cd /Users/Najum/weekforge && uv run python -c "from weekforge.integration import GoogleIntegration; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add src/weekforge/integration.py
git commit -m "feat: add GoogleIntegration facade"
```

---

## Task 6 — Six new API routes + route tests

**Files:**
- Create: `src/weekforge/api/google_routes.py`
- Modify: `src/weekforge/api/app.py`
- Create: `tests/api/test_google_routes.py`

- [ ] **Step 1: Write the failing route tests**

Create `tests/api/test_google_routes.py`:

```python
"""Route tests for the six Google Calendar endpoints.

Uses a FakeGoogleIntegration injected via create_app so no real Google calls
are made. Pattern copied from tests/api/conftest.py (MockCouncil injection).
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from weekforge.api.app import create_app
from weekforge.models import TimeBlock


# ---------------------------------------------------------------------------
# Fake facade
# ---------------------------------------------------------------------------

class FakeGoogleIntegration:
    def __init__(self, connected: bool = False) -> None:
        self._connected = connected
        self.disconnected = False
        self.last_export: list[TimeBlock] | None = None
        self._busy: list[TimeBlock] = [
            TimeBlock(
                start=datetime(2026, 6, 15, 9, tzinfo=timezone.utc),
                end=datetime(2026, 6, 15, 10, tzinfo=timezone.utc),
                label="Standup",
            )
        ]

    def is_connected(self) -> bool:
        return self._connected

    def login_url(self) -> str:
        return "https://accounts.google.com/o/oauth2/auth?fake=1"

    def complete_login(self, code: str) -> None:
        self._connected = True

    def disconnect(self) -> None:
        self._connected = False
        self.disconnected = True

    def frontend_url(self) -> str:
        return "http://localhost:3000"

    def import_busy(self, week_start: datetime) -> list[TimeBlock]:
        return self._busy

    def export_schedule(self, blocks: list[TimeBlock], week_start: datetime) -> tuple[int, str]:
        self.last_export = blocks
        return len(blocks), "https://calendar.google.com/calendar/r/week"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def unconnected_client(tmp_path):
    fake = FakeGoogleIntegration(connected=False)
    app = create_app(
        council=_mock_council(),
        api_key="test-key",
        db_path=str(tmp_path / "test.db"),
        google=fake,
    )
    return TestClient(app, follow_redirects=False), fake


@pytest.fixture
def connected_client(tmp_path):
    fake = FakeGoogleIntegration(connected=True)
    app = create_app(
        council=_mock_council(),
        api_key="test-key",
        db_path=str(tmp_path / "test.db"),
        google=fake,
    )
    return TestClient(app, follow_redirects=False), fake


class _MockCouncil:
    def propose(self, agent_name, context): return f"{agent_name} proposes."
    def critique(self, agent_name, context): return f"{agent_name} critiques."
    def arbitrate(self, context): return "[]"


def _mock_council():
    return _MockCouncil()


# ---------------------------------------------------------------------------
# /auth/google/status
# ---------------------------------------------------------------------------

def test_status_not_connected(unconnected_client):
    client, _ = unconnected_client
    resp = client.get("/auth/google/status")
    assert resp.status_code == 200
    assert resp.json() == {"connected": False}


def test_status_connected(connected_client):
    client, _ = connected_client
    resp = client.get("/auth/google/status")
    assert resp.status_code == 200
    assert resp.json() == {"connected": True}


# ---------------------------------------------------------------------------
# /auth/google/login
# ---------------------------------------------------------------------------

def test_login_redirects_to_google(unconnected_client):
    client, _ = unconnected_client
    resp = client.get("/auth/google/login")
    assert resp.status_code == 307
    assert "accounts.google.com" in resp.headers["location"]


# ---------------------------------------------------------------------------
# /auth/google/callback
# ---------------------------------------------------------------------------

def test_callback_completes_login_and_redirects_to_frontend(unconnected_client):
    client, fake = unconnected_client
    resp = client.get("/auth/google/callback?code=fake-code&state=s")
    assert resp.status_code == 307
    assert resp.headers["location"].startswith("http://localhost:3000")
    assert fake.is_connected()


# ---------------------------------------------------------------------------
# /auth/google/disconnect
# ---------------------------------------------------------------------------

def test_disconnect_clears_connection(connected_client):
    client, fake = connected_client
    resp = client.post("/auth/google/disconnect")
    assert resp.status_code == 200
    assert resp.json() == {"status": "disconnected"}
    assert fake.disconnected


# ---------------------------------------------------------------------------
# /calendar/google/busy
# ---------------------------------------------------------------------------

def test_import_busy_returns_blocks(connected_client):
    client, _ = connected_client
    resp = client.get("/calendar/google/busy?week_start=2026-06-15")
    assert resp.status_code == 200
    data = resp.json()
    assert "busy_blocks" in data
    assert len(data["busy_blocks"]) == 1
    assert data["busy_blocks"][0]["label"] == "Standup"


def test_import_busy_requires_connected(unconnected_client):
    client, _ = unconnected_client
    resp = client.get("/calendar/google/busy?week_start=2026-06-15")
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# /calendar/google/export
# ---------------------------------------------------------------------------

def test_export_writes_blocks_and_returns_count(connected_client):
    client, fake = connected_client
    body = {
        "week_start": "2026-06-15T00:00:00+00:00",
        "blocks": [
            {
                "start": "2026-06-15T09:00:00+00:00",
                "end": "2026-06-15T11:00:00+00:00",
                "label": "Write report",
                "task_id": "t1",
            }
        ],
    }
    resp = client.post("/calendar/google/export", json=body)
    assert resp.status_code == 200
    data = resp.json()
    assert data["written"] == 1
    assert "calendar_url" in data
    assert fake.last_export is not None
    assert fake.last_export[0].label == "Write report"


def test_export_requires_connected(unconnected_client):
    client, _ = unconnected_client
    body = {"week_start": "2026-06-15T00:00:00+00:00", "blocks": []}
    resp = client.post("/calendar/google/export", json=body)
    assert resp.status_code == 403
```

- [ ] **Step 2: Run to verify tests fail**

Run: `cd /Users/Najum/weekforge && uv run pytest tests/api/test_google_routes.py -v`
Expected: FAIL — `TypeError: create_app() got an unexpected keyword argument 'google'`

- [ ] **Step 3: Create `src/weekforge/api/google_routes.py`**

```python
"""Six Google Calendar routes mounted on the existing FastAPI app."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from weekforge.models import TimeBlock


class ExportRequest(BaseModel):
    week_start: datetime
    blocks: list[TimeBlock]


def create_google_router(google) -> APIRouter:
    """Build the Google routes, closing over the injected GoogleIntegration."""
    router = APIRouter()

    @router.get("/auth/google/status")
    def auth_status():
        return {"connected": google.is_connected()}

    @router.get("/auth/google/login")
    def auth_login():
        url = google.login_url()
        return RedirectResponse(url=url, status_code=307)

    @router.get("/auth/google/callback")
    def auth_callback(code: str, state: str = ""):
        google.complete_login(code)
        frontend = google.frontend_url()
        return RedirectResponse(url=f"{frontend}?google=connected", status_code=307)

    @router.post("/auth/google/disconnect")
    def auth_disconnect():
        google.disconnect()
        return {"status": "disconnected"}

    @router.get("/calendar/google/busy")
    def calendar_busy(week_start: str):
        if not google.is_connected():
            raise HTTPException(status_code=403, detail="Not connected to Google Calendar")
        dt = datetime.fromisoformat(week_start).replace(tzinfo=timezone.utc)
        blocks = google.import_busy(dt)
        return {"busy_blocks": [b.model_dump(mode="json") for b in blocks]}

    @router.post("/calendar/google/export")
    def calendar_export(request: ExportRequest):
        if not google.is_connected():
            raise HTTPException(status_code=403, detail="Not connected to Google Calendar")
        count, url = google.export_schedule(request.blocks, request.week_start)
        return {"written": count, "calendar_url": url}

    return router
```

- [ ] **Step 4: Modify `src/weekforge/api/app.py` to accept and wire `google`**

Replace the entire file with:

```python
"""FastAPI application factory for the WeekForge API."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from weekforge.api.routes import create_router
from weekforge.api.google_routes import create_google_router
from weekforge.api.sessions import SessionManager
from weekforge.debate.debaters import Council


def create_app(
    council: Council,
    api_key: str,
    db_path: str = "weekforge_api.db",
    allow_origins: list[str] | None = None,
    google=None,
) -> FastAPI:
    """Build the WeekForge FastAPI app.

    Args:
        council: CrewAI Council (or a mock in tests).
        api_key: Anthropic API key passed to the convergence-check and validate nodes.
        db_path: SQLite file backing the LangGraph checkpointer.
        allow_origins: CORS origins for the frontend.
        google: GoogleIntegration facade (or fake in tests). Pass None to omit Google routes.
    """
    app = FastAPI(title="WeekForge API", description="A transparent multi-agent decision council.")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins or ["http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    sessions = SessionManager()
    app.state.sessions = sessions
    app.include_router(create_router(council=council, api_key=api_key, db_path=db_path, sessions=sessions))

    if google is not None:
        app.include_router(create_google_router(google))

    return app
```

- [ ] **Step 5: Run to verify route tests pass**

Run: `cd /Users/Najum/weekforge && uv run pytest tests/api/test_google_routes.py -v`
Expected: all tests pass.

- [ ] **Step 6: Verify existing tests still pass**

Run: `cd /Users/Najum/weekforge && uv run pytest tests/ -v`
Expected: all existing + new tests pass, nothing broken.

- [ ] **Step 7: Commit**

```bash
git add src/weekforge/api/google_routes.py src/weekforge/api/app.py \
        tests/api/test_google_routes.py
git commit -m "feat: add six Google Calendar routes and wire into create_app"
```

---

## Task 7 — Wire `GoogleIntegration` into `build_app` (production server)

**Files:**
- Modify: `src/weekforge/api/server.py`

- [ ] **Step 1: Modify `src/weekforge/api/server.py`**

Replace the entire file with:

```python
"""Uvicorn entrypoint for the WeekForge API.

Run with the real Claude-backed council and Google Calendar:

    ANTHROPIC_API_KEY=sk-...
    GOOGLE_OAUTH_CLIENT_ID=...
    GOOGLE_OAUTH_CLIENT_SECRET=...
    GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8000/auth/google/callback
    GOOGLE_TOKEN_PATH=./weekforge_tokens.json
    WEEKFORGE_FRONTEND_URL=http://localhost:3000
    uv run weekforge-api
"""

from __future__ import annotations

import os

from fastapi import FastAPI

from weekforge.api.app import create_app
from weekforge.debate.debaters import build_council


def _build_google_integration():
    """Return a configured GoogleIntegration, or UnconfiguredGoogleIntegration if env absent."""
    client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET")
    if not client_id or not client_secret:
        from weekforge.integration import UnconfiguredGoogleIntegration
        return UnconfiguredGoogleIntegration()

    from weekforge.auth.token_store import JsonFileTokenStore
    from weekforge.integration import GoogleIntegration

    token_path = os.environ.get("GOOGLE_TOKEN_PATH", "weekforge_tokens.json")
    calendar_name = os.environ.get("WEEKFORGE_CALENDAR_NAME", "WeekForge")
    frontend_url = os.environ.get("WEEKFORGE_FRONTEND_URL", "http://localhost:3000")

    return GoogleIntegration(
        token_store=JsonFileTokenStore(token_path),
        calendar_name=calendar_name,
        frontend_url=frontend_url,
    )


def build_app() -> FastAPI:
    """Construct the production app from environment configuration."""
    api_key = os.environ["ANTHROPIC_API_KEY"]
    db_path = os.environ.get("WEEKFORGE_DB_PATH", "weekforge_api.db")
    from weekforge.debate.debaters import DEFAULT_MODEL
    model = os.environ.get("WEEKFORGE_MODEL", DEFAULT_MODEL)
    council = build_council(api_key, model=model)
    google = _build_google_integration()
    return create_app(council=council, api_key=api_key, db_path=db_path, google=google)


def main() -> None:
    import uvicorn

    host = os.environ.get("WEEKFORGE_HOST", "127.0.0.1")
    port = int(os.environ.get("WEEKFORGE_PORT", "8000"))
    uvicorn.run(build_app(), host=host, port=port)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify the server still starts (without Google env vars)**

Run: `cd /Users/Najum/weekforge && ANTHROPIC_API_KEY=test uv run python -c "from weekforge.api.server import build_app; app = build_app(); print('ok')"`
Expected: `ok` — no crash, gracefully uses `UnconfiguredGoogleIntegration`.

- [ ] **Step 3: Run full test suite to confirm nothing regressed**

Run: `cd /Users/Najum/weekforge && uv run pytest tests/ -v`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/weekforge/api/server.py
git commit -m "feat: wire GoogleIntegration into build_app from env vars"
```

---

## Task 8 — Manual smoke test (real Google account)

No code in this task — this is the only check that exercises the live OAuth flow and the real `GoogleCalendarClient` adapter.

- [ ] **Step 1: Register OAuth credentials in Google Cloud Console**

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials.
2. Create an OAuth 2.0 Client ID (type: Web application).
3. Add authorized redirect URI: `http://localhost:8000/auth/google/callback`.
4. Enable the Google Calendar API for the project.
5. In OAuth consent screen: set publishing status to **Testing**, add your email as a test user.

- [ ] **Step 2: Create `.env` file (do not commit)**

```bash
ANTHROPIC_API_KEY=sk-...
GOOGLE_OAUTH_CLIENT_ID=<your-client-id>
GOOGLE_OAUTH_CLIENT_SECRET=<your-client-secret>
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8000/auth/google/callback
GOOGLE_TOKEN_PATH=./weekforge_tokens.json
WEEKFORGE_FRONTEND_URL=http://localhost:3000
WEEKFORGE_CALENDAR_NAME=WeekForge
```

- [ ] **Step 3: Start the backend**

```bash
cd /Users/Najum/weekforge && set -a && source .env && set +a && uv run weekforge-api
```

- [ ] **Step 4: Verify status endpoint returns not connected**

```bash
curl http://localhost:8000/auth/google/status
# Expected: {"connected": false}
```

- [ ] **Step 5: Connect Google account**

Open `http://localhost:8000/auth/google/login` in a browser. Authorise with your Google account. Confirm the browser redirects to `http://localhost:3000?google=connected`.

- [ ] **Step 6: Verify status shows connected and token file exists**

```bash
curl http://localhost:8000/auth/google/status
# Expected: {"connected": true}
ls weekforge_tokens.json   # must exist
```

- [ ] **Step 7: Import busy blocks**

```bash
curl "http://localhost:8000/calendar/google/busy?week_start=2026-06-15"
# Expected: JSON with your real calendar events for that week as busy_blocks
```

- [ ] **Step 8: Export a schedule to Google Calendar**

```bash
curl -X POST http://localhost:8000/calendar/google/export \
  -H "Content-Type: application/json" \
  -d '{
    "week_start": "2026-06-15T00:00:00+00:00",
    "blocks": [
      {"start":"2026-06-15T09:00:00+00:00","end":"2026-06-15T11:00:00+00:00","label":"Write report","task_id":"t1"},
      {"start":"2026-06-16T13:00:00+00:00","end":"2026-06-16T14:00:00+00:00","label":"Review PRs","task_id":"t2"}
    ]
  }'
# Expected: {"written": 2, "calendar_url": "https://calendar.google.com/calendar/r/week"}
```

Open Google Calendar — a "WeekForge" calendar should be present with two events.

- [ ] **Step 9: Verify re-export does not duplicate**

Run the same `curl` from Step 8 again. Open Google Calendar — still exactly 2 events in the WeekForge calendar (replaced, not duplicated).

- [ ] **Step 10: Disconnect**

```bash
curl -X POST http://localhost:8000/auth/google/disconnect
# Expected: {"status": "disconnected"}
curl http://localhost:8000/auth/google/status
# Expected: {"connected": false}
ls weekforge_tokens.json   # must not exist (or be absent)
```

---

## Done criteria

- `uv run pytest tests/` → all tests pass (existing suite + new auth + provider/writer + route tests).
- `uv run weekforge-api` starts cleanly when Google env vars are absent (graceful degradation).
- Manual smoke: connect → import busy blocks from real Google Calendar → debate → export schedule → WeekForge calendar events appear → re-export replaces, does not duplicate → disconnect clears credentials.
