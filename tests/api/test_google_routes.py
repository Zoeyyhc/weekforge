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

    def list_calendars(self) -> list[dict]:
        return [
            {"id": "primary@x", "summary": "me@x", "primary": True, "selected_by_default": True},
            {"id": "holidays@x", "summary": "US Holidays", "primary": False, "selected_by_default": False},
        ]

    def import_busy(self, week_start: datetime, calendar_ids: list[str] | None = None) -> list[TimeBlock]:
        self.last_calendar_ids = calendar_ids
        return self._busy

    def export_schedule(
        self, blocks: list[TimeBlock], week_start: datetime, time_zone: str | None = None
    ) -> tuple[int, str]:
        self.last_export = blocks
        self.last_time_zone = time_zone
        return len(blocks), "https://calendar.google.com/calendar/r/week"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

class _MockCouncil:
    def propose(self, agent_name, context): return f"{agent_name} proposes."
    def critique(self, agent_name, context): return f"{agent_name} critiques."
    def arbitrate(self, context): return "[]"


@pytest.fixture
def unconnected_client(tmp_path):
    fake = FakeGoogleIntegration(connected=False)
    app = create_app(
        council=_MockCouncil(),
        api_key="test-key",
        db_path=str(tmp_path / "test.db"),
        google=fake,
    )
    return TestClient(app, follow_redirects=False), fake


@pytest.fixture
def connected_client(tmp_path):
    fake = FakeGoogleIntegration(connected=True)
    app = create_app(
        council=_MockCouncil(),
        api_key="test-key",
        db_path=str(tmp_path / "test.db"),
        google=fake,
    )
    return TestClient(app, follow_redirects=False), fake


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
    assert resp.headers["location"] == "http://localhost:3000/app?google=connected"
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


def test_import_busy_passes_selected_calendar_ids(connected_client):
    client, fake = connected_client
    resp = client.get("/calendar/google/busy?week_start=2026-06-15&calendar_ids=a@x&calendar_ids=b@x")
    assert resp.status_code == 200
    assert fake.last_calendar_ids == ["a@x", "b@x"]


def test_import_busy_defaults_calendar_ids_to_none(connected_client):
    client, fake = connected_client
    client.get("/calendar/google/busy?week_start=2026-06-15")
    assert fake.last_calendar_ids is None


# ---------------------------------------------------------------------------
# /calendar/google/calendars
# ---------------------------------------------------------------------------

def test_list_calendars_returns_calendars(connected_client):
    client, _ = connected_client
    resp = client.get("/calendar/google/calendars")
    assert resp.status_code == 200
    data = resp.json()
    assert "calendars" in data
    summaries = [c["summary"] for c in data["calendars"]]
    assert summaries == ["me@x", "US Holidays"]
    assert data["calendars"][0]["selected_by_default"] is True


def test_list_calendars_requires_connected(unconnected_client):
    client, _ = unconnected_client
    resp = client.get("/calendar/google/calendars")
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# /calendar/google/export
# ---------------------------------------------------------------------------

def test_export_writes_blocks_and_returns_count(connected_client):
    client, fake = connected_client
    body = {
        "week_start": "2026-06-15T00:00:00+00:00",
        "time_zone": "Australia/Sydney",
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
    assert fake.last_time_zone == "Australia/Sydney"


def test_export_requires_connected(unconnected_client):
    client, _ = unconnected_client
    body = {"week_start": "2026-06-15T00:00:00+00:00", "blocks": []}
    resp = client.post("/calendar/google/export", json=body)
    assert resp.status_code == 403
