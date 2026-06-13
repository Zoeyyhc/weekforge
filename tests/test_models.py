from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from weekforge.models import Preferences, Schedule, Task, TimeBlock


def _utc(y, m, d, h, mn=0):
    return datetime(y, m, d, h, mn, tzinfo=timezone.utc)


def test_task_defaults():
    task = Task(id="t1", title="Write report", estimated_minutes=90)
    assert task.priority == 3
    assert task.deadline is None
    assert task.category is None
    assert task.depends_on == []


def test_task_rejects_nonpositive_estimate():
    with pytest.raises(ValidationError):
        Task(id="t1", title="x", estimated_minutes=0)


def test_task_priority_bounds():
    with pytest.raises(ValidationError):
        Task(id="t1", title="x", estimated_minutes=10, priority=6)


def test_timeblock_duration_minutes():
    block = TimeBlock(start=_utc(2026, 6, 15, 9), end=_utc(2026, 6, 15, 10, 30), label="Busy")
    assert block.duration_minutes == 90


def test_timeblock_rejects_end_before_start():
    with pytest.raises(ValidationError):
        TimeBlock(start=_utc(2026, 6, 15, 10), end=_utc(2026, 6, 15, 9), label="bad")


def test_preferences_defaults_and_validation():
    prefs = Preferences()
    assert prefs.workday_start_hour == 9
    assert prefs.workday_end_hour == 18
    assert prefs.max_focus_minutes_per_day == 360
    with pytest.raises(ValidationError):
        Preferences(workday_start_hour=18, workday_end_hour=9)


def test_schedule_defaults_empty():
    schedule = Schedule()
    assert schedule.blocks == []
