"""Tests for GoogleCalendarProvider and GoogleCalendarWriter against a fake client."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from weekforge.models import TimeBlock
from weekforge.providers.google_calendar import (
    GoogleCalendarProvider,
    GoogleCalendarWriter,
    _is_weekforge_event,
    WEEKFORGE_MARKER_KEY,
    WEEKFORGE_MARKER_VALUE,
    WEEKFORGE_MARKER_QUERY,
)


def _utc(y, m, d, h=0, mn=0) -> datetime:
    return datetime(y, m, d, h, mn, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Fake GoogleCalendarClient
# ---------------------------------------------------------------------------

class FakeGoogleCalendarClient:
    """In-memory stand-in. Records writes, returns seeded events on reads."""

    def __init__(self, events: list[dict] | None = None, calendars: list[dict] | None = None) -> None:
        self._events: list[dict] = events or []
        self.inserted: list[dict] = []
        self.deleted_ranges: list[tuple] = []
        self.delete_filters: list[str | None] = []
        self._calendars: dict[str, str] = {}
        self._calendar_list: list[dict] = calendars or []

    def list_calendars(self) -> list[dict]:
        return self._calendar_list

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

    def delete_events_in_range(
        self, calendar_id: str, start: datetime, end: datetime,
        private_extended_property: str | None = None,
    ) -> None:
        self.deleted_ranges.append((calendar_id, start, end))
        self.delete_filters.append(private_extended_property)

        def _should_delete(e: dict) -> bool:
            in_range = (
                e.get("_calendar_id") == calendar_id
                and e["start_dt"] < end
                and e["end_dt"] > start
            )
            if not in_range:
                return False
            # Mirror Google's server-side privateExtendedProperty filter.
            if private_extended_property is not None:
                return _is_weekforge_event(e)
            return True

        self._events = [e for e in self._events if not _should_delete(e)]


# ---------------------------------------------------------------------------
# GoogleCalendarProvider tests
# ---------------------------------------------------------------------------

def _gcal_event(
    summary: str, start: datetime, end: datetime,
    calendar_id: str = "primary", marker: bool = False,
) -> dict:
    event = {
        "summary": summary,
        "start": {"dateTime": start.isoformat()},
        "end": {"dateTime": end.isoformat()},
        "start_dt": start,
        "end_dt": end,
        "_calendar_id": calendar_id,
    }
    if marker:
        event["extendedProperties"] = {"private": {"weekforge": "1"}}
    return event


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

    def test_defaults_to_primary_calendar_only(self):
        client = FakeGoogleCalendarClient(events=[
            _gcal_event("On primary", _utc(2026, 6, 15, 9), _utc(2026, 6, 15, 10), calendar_id="primary"),
            _gcal_event("On work", _utc(2026, 6, 15, 11), _utc(2026, 6, 15, 12), calendar_id="work@x.com"),
        ])
        provider = GoogleCalendarProvider(client)  # no calendar_ids → primary only

        blocks = provider.get_busy_blocks(_utc(2026, 6, 15), _utc(2026, 6, 22))

        labels = [b.label for b in blocks]
        assert labels == ["On primary"]

    def test_reads_and_merges_multiple_calendars(self):
        client = FakeGoogleCalendarClient(events=[
            _gcal_event("On primary", _utc(2026, 6, 15, 9), _utc(2026, 6, 15, 10), calendar_id="primary"),
            _gcal_event("On work", _utc(2026, 6, 16, 11), _utc(2026, 6, 16, 12), calendar_id="work@x.com"),
        ])
        provider = GoogleCalendarProvider(client, calendar_ids=["primary", "work@x.com"])

        blocks = provider.get_busy_blocks(_utc(2026, 6, 15), _utc(2026, 6, 22))

        labels = sorted(b.label for b in blocks)
        assert labels == ["On primary", "On work"]

    def test_skips_weekforge_marked_events_on_import(self):
        client = FakeGoogleCalendarClient(events=[
            _gcal_event("Standup", _utc(2026, 6, 15, 9), _utc(2026, 6, 15, 10)),  # foreign
            _gcal_event("Old deep work", _utc(2026, 6, 15, 13), _utc(2026, 6, 15, 15), marker=True),  # self
        ])
        provider = GoogleCalendarProvider(client)

        blocks = provider.get_busy_blocks(_utc(2026, 6, 15), _utc(2026, 6, 22))

        assert [b.label for b in blocks] == ["Standup"]


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

    def test_inserts_one_event_per_block(self):
        client = FakeGoogleCalendarClient()
        writer = GoogleCalendarWriter(client)

        count = writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))

        assert count == 2
        assert len(client.inserted) == 2

    def test_event_title_matches_block_label(self):
        client = FakeGoogleCalendarClient()
        writer = GoogleCalendarWriter(client)

        writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))

        titles = [e["summary"] for e in client.inserted]
        assert "Write report" in titles
        assert "Review PRs" in titles

    def test_clears_existing_events_before_writing(self):
        client = FakeGoogleCalendarClient()
        writer = GoogleCalendarWriter(client)

        writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))
        writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))

        assert len(client.deleted_ranges) == 2
        assert len(client.inserted) == 4  # 2 on first run + 2 on second

    def test_returns_count_of_written_events(self):
        client = FakeGoogleCalendarClient()
        writer = GoogleCalendarWriter(client)

        count = writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))

        assert count == 2

    def test_writes_wall_clock_time_with_timezone_when_provided(self):
        # The block's wall-clock hour (09:00) is the user's intended local time.
        # With a timeZone, Google must receive a naive dateTime + the IANA zone,
        # not the absolute UTC instant (which would shift the event).
        client = FakeGoogleCalendarClient()
        writer = GoogleCalendarWriter(client)

        writer.write_blocks(
            self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22),
            time_zone="Australia/Sydney",
        )

        start = client.inserted[0]["start"]
        assert start["dateTime"] == "2026-06-15T09:00:00"  # no offset suffix
        assert start["timeZone"] == "Australia/Sydney"
        assert client.inserted[0]["end"]["timeZone"] == "Australia/Sydney"

    def test_writes_offset_datetime_without_timezone_fallback(self):
        # No timezone supplied -> preserve the original offset-bearing isoformat.
        client = FakeGoogleCalendarClient()
        writer = GoogleCalendarWriter(client)

        writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))

        start = client.inserted[0]["start"]
        assert start["dateTime"] == "2026-06-15T09:00:00+00:00"
        assert "timeZone" not in start

    def test_writes_to_primary_without_creating_calendar(self):
        client = FakeGoogleCalendarClient()
        writer = GoogleCalendarWriter(client)

        writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))

        assert all(e["_calendar_id"] == "primary" for e in client.inserted)
        assert client._calendars == {}  # create_calendar never called

    def test_tags_each_event_with_marker_and_clean_title(self):
        client = FakeGoogleCalendarClient()
        writer = GoogleCalendarWriter(client)

        writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))

        for e in client.inserted:
            assert e["extendedProperties"]["private"]["weekforge"] == "1"
            # Titles are written verbatim from block.label; guard that the writer
            # never re-introduces the old "[tN]" task-number decoration that the
            # standalone-WeekForge-calendar export used to add.
            assert "[t" not in e["summary"]

    def test_delete_passes_marker_filter(self):
        client = FakeGoogleCalendarClient()
        writer = GoogleCalendarWriter(client)

        writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))

        assert client.delete_filters == ["weekforge=1"]

    def test_deletes_only_marked_events_and_keeps_foreign(self):
        foreign = _gcal_event("Real meeting", _utc(2026, 6, 15, 9), _utc(2026, 6, 15, 10))
        old_self = _gcal_event("Old deep work", _utc(2026, 6, 16, 13), _utc(2026, 6, 16, 15), marker=True)
        client = FakeGoogleCalendarClient(events=[foreign, old_self])
        writer = GoogleCalendarWriter(client)

        writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))

        remaining = [e["summary"] for e in client._events]
        assert "Real meeting" in remaining       # foreign untouched
        assert "Old deep work" not in remaining  # old WeekForge block cleared


# ---------------------------------------------------------------------------
# Marker detection
# ---------------------------------------------------------------------------

class TestWeekforgeMarker:
    def test_constants_compose_query_string(self):
        assert WEEKFORGE_MARKER_KEY == "weekforge"
        assert WEEKFORGE_MARKER_VALUE == "1"
        assert WEEKFORGE_MARKER_QUERY == "weekforge=1"

    def test_detects_marked_event(self):
        event = {"extendedProperties": {"private": {"weekforge": "1"}}}
        assert _is_weekforge_event(event) is True

    def test_unmarked_event_is_false(self):
        assert _is_weekforge_event({"summary": "Real meeting"}) is False

    def test_other_private_props_are_false(self):
        event = {"extendedProperties": {"private": {"something": "else"}}}
        assert _is_weekforge_event(event) is False

    def test_handles_missing_or_null_extended_properties(self):
        assert _is_weekforge_event({"extendedProperties": None}) is False
        assert _is_weekforge_event({"extendedProperties": {"private": None}}) is False


from weekforge.providers.google_calendar import RealGoogleCalendarClient


# ---------------------------------------------------------------------------
# Minimal fake googleapiclient service (chained .events().list()/.delete().execute())
# ---------------------------------------------------------------------------

class _FakeRequest:
    def __init__(self, result=None, on_execute=None):
        self._result = result
        self._on_execute = on_execute

    def execute(self):
        if self._on_execute is not None:
            self._on_execute()
        return self._result


class _FakeGoogleService:
    def __init__(self, items):
        self._items = items
        self.deleted_ids: list[str] = []
        self.list_kwargs: dict | None = None

    def events(self):
        return self

    def list(self, **kwargs):
        self.list_kwargs = kwargs
        return _FakeRequest(result={"items": self._items})

    def delete(self, calendarId, eventId):
        return _FakeRequest(on_execute=lambda: self.deleted_ids.append(eventId))


class TestRealClientDeleteGuard:
    def test_guard_skips_unmarked_even_if_server_filter_bypassed(self):
        marked = {"id": "wf-1", "extendedProperties": {"private": {"weekforge": "1"}}}
        foreign = {"id": "real-1"}  # user's real meeting, no marker
        svc = _FakeGoogleService(items=[marked, foreign])
        client = RealGoogleCalendarClient(svc)

        client.delete_events_in_range(
            "primary", _utc(2026, 6, 15), _utc(2026, 6, 22),
            private_extended_property=WEEKFORGE_MARKER_QUERY,
        )

        assert svc.deleted_ids == ["wf-1"]                       # foreign NOT deleted
        assert svc.list_kwargs["privateExtendedProperty"] == WEEKFORGE_MARKER_QUERY

    def test_no_filter_preserves_legacy_delete_all(self):
        svc = _FakeGoogleService(items=[{"id": "a"}, {"id": "b"}])
        client = RealGoogleCalendarClient(svc)

        client.delete_events_in_range("primary", _utc(2026, 6, 15), _utc(2026, 6, 22))

        assert svc.deleted_ids == ["a", "b"]
        assert "privateExtendedProperty" not in svc.list_kwargs
