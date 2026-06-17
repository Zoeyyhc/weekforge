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
