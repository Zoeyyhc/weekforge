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
    def list_calendars(self) -> list[dict]: ...
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

    def list_calendars(self) -> list[dict]:
        resp = self._svc.calendarList().list().execute()
        return resp.get("items", [])

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
    """Reads busy blocks from one or more of the user's Google Calendars.

    Defaults to the primary calendar; pass calendar_ids to read (and merge)
    events from a specific set of calendars.
    """

    def __init__(
        self,
        client: GoogleCalendarClient,
        calendar_ids: list[str] | None = None,
    ) -> None:
        self._client = client
        self._calendar_ids = calendar_ids or ["primary"]

    def get_busy_blocks(self, start: datetime, end: datetime) -> list[TimeBlock]:
        blocks: list[TimeBlock] = []
        for calendar_id in self._calendar_ids:
            for e in self._client.list_events(calendar_id, start, end):
                label = e.get("summary") or "Busy"
                blocks.append(
                    TimeBlock(start=e["start_dt"], end=e["end_dt"], label=label)
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
