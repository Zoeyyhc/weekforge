"""Unit tests for GoogleIntegration.list_calendars and multi-calendar import.

The real `_client()` builds a networked Google service, so these tests inject a
fake client onto the instance to exercise the facade's own logic (WeekForge
exclusion, primary-default marking, calendar_ids passthrough).
"""

from __future__ import annotations

from datetime import datetime, timezone

from weekforge.integration import GoogleIntegration
from weekforge.models import TimeBlock


class _FakeStore:
    def save(self, c): ...
    def load(self): return {"token": "t"}
    def clear(self): ...


def _utc(y, m, d, h=0):
    return datetime(y, m, d, h, tzinfo=timezone.utc)


class FakeClient:
    def __init__(self, calendars=None, events=None):
        self._calendars = calendars or []
        self._events = events or []
        self.inserted = []
        self.deleted = []

    def list_calendars(self):
        return self._calendars

    def list_events(self, calendar_id, start, end):
        return [
            e for e in self._events
            if e["_calendar_id"] == calendar_id and e["start_dt"] < end and e["end_dt"] > start
        ]

    def insert_event(self, calendar_id, event):
        event["_calendar_id"] = calendar_id
        self.inserted.append(event)
        return f"evt-{len(self.inserted)}"

    def delete_events_in_range(self, calendar_id, start, end, private_extended_property=None):
        self.deleted.append((calendar_id, private_extended_property))


def _make(client) -> GoogleIntegration:
    google = GoogleIntegration(token_store=_FakeStore())
    google._client = lambda: client  # inject fake client
    return google


def test_list_calendars_includes_all_calendars_and_selects_all_by_default():
    client = FakeClient(calendars=[
        {"id": "najum@gmail.com", "summary": "najum@gmail.com", "primary": True},
        {"id": "holidays@x", "summary": "US Holidays"},
        {"id": "wf@x", "summary": "WeekForge"},
    ])
    google = _make(client)

    cals = google.list_calendars()

    summaries = [c["summary"] for c in cals]
    # WeekForge calendar is now included — importing previous output is intentional
    assert "WeekForge" in summaries
    assert len(cals) == 3

    # All calendars default-selected so import picks up everything
    assert all(c["selected_by_default"] for c in cals)


def test_import_busy_defaults_to_primary_when_no_ids():
    client = FakeClient(events=[
        {"summary": "On primary", "start_dt": _utc(2026, 6, 15, 9), "end_dt": _utc(2026, 6, 15, 10),
         "start": {"dateTime": "x"}, "end": {"dateTime": "y"}, "_calendar_id": "primary"},
        {"summary": "On work", "start_dt": _utc(2026, 6, 15, 11), "end_dt": _utc(2026, 6, 15, 12),
         "start": {"dateTime": "x"}, "end": {"dateTime": "y"}, "_calendar_id": "work@x"},
    ])
    google = _make(client)

    blocks = google.import_busy(_utc(2026, 6, 15))

    assert [b.label for b in blocks] == ["On primary"]


def test_import_busy_reads_selected_calendars():
    client = FakeClient(events=[
        {"summary": "On primary", "start_dt": _utc(2026, 6, 15, 9), "end_dt": _utc(2026, 6, 15, 10),
         "start": {"dateTime": "x"}, "end": {"dateTime": "y"}, "_calendar_id": "primary"},
        {"summary": "On work", "start_dt": _utc(2026, 6, 16, 11), "end_dt": _utc(2026, 6, 16, 12),
         "start": {"dateTime": "x"}, "end": {"dateTime": "y"}, "_calendar_id": "work@x"},
    ])
    google = _make(client)

    blocks = google.import_busy(_utc(2026, 6, 15), calendar_ids=["primary", "work@x"])

    assert sorted(b.label for b in blocks) == ["On primary", "On work"]


def test_export_schedule_writes_marked_event_to_primary():
    client = FakeClient()
    google = _make(client)
    blocks = [TimeBlock(start=_utc(2026, 6, 15, 9), end=_utc(2026, 6, 15, 10),
                        label="Deep work", task_id="t1")]

    count, url = google.export_schedule(blocks, _utc(2026, 6, 15))

    assert count == 1
    assert client.inserted[0]["_calendar_id"] == "primary"
    assert client.inserted[0]["extendedProperties"]["private"]["weekforge"] == "1"
    assert client.deleted == [("primary", "weekforge=1")]
