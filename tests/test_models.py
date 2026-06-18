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
    assert schedule.week_start is None


def test_task_preferred_days_defaults_to_none():
    task = Task(id="t1", title="Write report", estimated_minutes=60)
    assert task.preferred_days is None


def test_task_preferred_days_accepts_ordered_list():
    task = Task(id="t1", title="Write report", estimated_minutes=60, preferred_days=["Wed", "Fri"])
    assert task.preferred_days == ["Wed", "Fri"]


def test_task_preferred_days_accepts_empty_list():
    task = Task(id="t1", title="Write report", estimated_minutes=60, preferred_days=[])
    assert task.preferred_days == []


def test_task_remark_defaults_to_none():
    task = Task(id="t1", title="Write report", estimated_minutes=90)
    assert task.remark is None


def test_task_remark_accepts_string():
    task = Task(id="t1", title="Write report", estimated_minutes=90, remark="Do this in the morning")
    assert task.remark == "Do this in the morning"


def test_preferences_default_max_focus_per_block_is_90():
    assert Preferences().max_focus_minutes_per_block == 90


def test_preferences_per_block_clamps_to_per_day_when_larger():
    # A per-block cap above the daily cap is meaningless (the daily cap dominates),
    # so it is clamped down rather than rejected — keeps loading robust.
    prefs = Preferences(max_focus_minutes_per_day=120, max_focus_minutes_per_block=240)
    assert prefs.max_focus_minutes_per_block == 120


def test_preferences_legacy_json_without_per_block_clamps_to_per_day():
    # Existing users saved prefs before the per-block field existed. If their daily
    # cap is below the new default (90), loading must clamp — never crash.
    legacy = (
        '{"workday_start_hour": 9, "workday_end_hour": 18, '
        '"max_focus_minutes_per_day": 60, "timezone": null}'
    )
    prefs = Preferences.model_validate_json(legacy)
    assert prefs.max_focus_minutes_per_block == 60


def test_preferences_per_block_equal_to_per_day_is_allowed():
    prefs = Preferences(max_focus_minutes_per_day=120, max_focus_minutes_per_block=120)
    assert prefs.max_focus_minutes_per_block == 120


def test_preferences_per_block_must_be_positive():
    with pytest.raises(ValidationError):
        Preferences(max_focus_minutes_per_block=0)
