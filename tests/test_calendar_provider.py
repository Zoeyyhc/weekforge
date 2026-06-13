from datetime import datetime, timezone

from weekforge.models import TimeBlock
from weekforge.providers.calendar import MockCalendarProvider


def _utc(y, m, d, h, mn=0):
    return datetime(y, m, d, h, mn, tzinfo=timezone.utc)


def test_mock_returns_blocks_overlapping_range():
    inside = TimeBlock(start=_utc(2026, 6, 15, 9), end=_utc(2026, 6, 15, 10), label="Standup")
    outside = TimeBlock(start=_utc(2026, 6, 20, 9), end=_utc(2026, 6, 20, 10), label="Later")
    provider = MockCalendarProvider([inside, outside])

    result = provider.get_busy_blocks(_utc(2026, 6, 15, 0), _utc(2026, 6, 16, 0))

    assert result == [inside]


def test_mock_includes_partial_overlap():
    spanning = TimeBlock(start=_utc(2026, 6, 14, 23), end=_utc(2026, 6, 15, 1), label="Overnight")
    provider = MockCalendarProvider([spanning])

    result = provider.get_busy_blocks(_utc(2026, 6, 15, 0), _utc(2026, 6, 16, 0))

    assert result == [spanning]


def test_mock_empty_when_no_overlap():
    block = TimeBlock(start=_utc(2026, 6, 10, 9), end=_utc(2026, 6, 10, 10), label="Old")
    provider = MockCalendarProvider([block])

    result = provider.get_busy_blocks(_utc(2026, 6, 15, 0), _utc(2026, 6, 16, 0))

    assert result == []
