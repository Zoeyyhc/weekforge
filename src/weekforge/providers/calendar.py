"""Calendar providers. Return busy TimeBlocks overlapping a date range."""

from __future__ import annotations

from datetime import datetime
from typing import Protocol, runtime_checkable

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
