"""Calendar providers. Return busy TimeBlocks overlapping a date range."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Protocol, runtime_checkable

from icalendar import Calendar as _ICalendar

from weekforge.models import TimeBlock


@runtime_checkable
class CalendarProvider(Protocol):
    """A source of fixed commitments (busy blocks)."""

    def get_busy_blocks(self, start: datetime, end: datetime) -> list[TimeBlock]:
        """Return busy blocks that overlap the half-open range [start, end)."""
        ...


def _overlaps(block: TimeBlock, start: datetime, end: datetime) -> bool:
    return block.start < end and block.end > start


class MockCalendarProvider:
    """In-memory provider seeded with a fixed list of blocks. For dev/tests."""

    def __init__(self, blocks: list[TimeBlock]) -> None:
        self._blocks = blocks

    def get_busy_blocks(self, start: datetime, end: datetime) -> list[TimeBlock]:
        return [b for b in self._blocks if _overlaps(b, start, end)]


class ICSCalendarProvider:
    """Reads busy blocks from an iCalendar (.ics) file.

    v1 reads from a local path. A future URL-backed variant (Google's secret
    iCal address) can wrap this by fetching the bytes first.
    """

    def __init__(self, ics_path: str | Path) -> None:
        self._path = Path(ics_path)

    def get_busy_blocks(self, start: datetime, end: datetime) -> list[TimeBlock]:
        calendar = _ICalendar.from_ical(self._path.read_bytes())
        blocks: list[TimeBlock] = []
        for event in calendar.walk("VEVENT"):
            block = TimeBlock(
                start=event.decoded("dtstart"),
                end=event.decoded("dtend"),
                label=str(event.get("summary", "Busy")),
            )
            if _overlaps(block, start, end):
                blocks.append(block)
        return blocks
