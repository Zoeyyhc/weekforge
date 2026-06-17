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
