"""Tests for the per-block semantic classifier."""

from __future__ import annotations

from datetime import datetime, timezone

from weekforge.debate.validation import classify_blocks, remaining_focus_budget
from weekforge.models import Preferences, Task, TimeBlock


def _utc(h, m=0, *, day=15):
    return datetime(2026, 6, day, h, m, tzinfo=timezone.utc)


def _block(label, start_h, end_h, *, task_id=None):
    return TimeBlock(start=_utc(start_h), end=_utc(end_h), label=label, task_id=task_id)


def _prefs(**kw):
    base = dict(workday_start_hour=9, workday_end_hour=18, max_focus_minutes_per_day=360)
    base.update(kw)
    return Preferences(**base)


def test_all_valid_report_is_ok_and_all_frozen():
    blocks = [_block("Deep work", 9, 11, task_id="t1")]
    report = classify_blocks(blocks, [Task(id="t1", title="X", estimated_minutes=120)], [], _prefs())
    assert report.ok is True
    assert report.frozen == blocks
    assert report.to_fix == []


def test_one_broken_block_others_frozen():
    good = _block("Good", 9, 11, task_id="t1")
    bad = _block("Early", 7, 8, task_id="t1")  # before work window
    report = classify_blocks([good, bad], [Task(id="t1", title="X", estimated_minutes=60)], [], _prefs())
    assert report.ok is False
    assert report.frozen == [good]
    assert [r.block for r in report.to_fix] == [bad]
    assert "before work window" in report.to_fix[0].errors[0]


def test_over_cap_day_marks_all_that_days_blocks_to_fix():
    # 4×120 = 480 > 360 cap, all within window → day-level violation
    blocks = [
        _block("A", 9, 11, task_id="t1"),
        _block("B", 11, 13, task_id="t1"),
        _block("C", 13, 15, task_id="t1"),
        _block("D", 15, 17, task_id="t1"),
    ]
    report = classify_blocks(blocks, [Task(id="t1", title="X", estimated_minutes=120)], [], _prefs(workday_end_hour=20))
    assert report.ok is False
    assert report.frozen == []          # whole over-cap day is movable
    assert len(report.to_fix) == 4
    assert any("focus cap" in r.day_reasons[0] for r in report.to_fix)


def test_remaining_focus_budget_subtracts_frozen_minutes():
    frozen = [_block("A", 9, 11, task_id="t1")]  # 120 min on Jun 15
    budget = remaining_focus_budget(frozen, _prefs(max_focus_minutes_per_day=360))
    assert budget[datetime(2026, 6, 15).date()] == 240


from datetime import datetime, timezone
from weekforge.debate.validation import compute_week_window


def _now(y, m, d, h, mn=0, tz="Australia/Sydney"):
    from zoneinfo import ZoneInfo
    return datetime(y, m, d, h, mn, tzinfo=ZoneInfo(tz))


def test_window_future_week_is_whole_week():
    # Picked week Mon 2026-06-22; now is the previous Wednesday → whole week schedulable.
    prefs = Preferences(workday_start_hour=9, workday_end_hour=18, timezone="Australia/Sydney")
    ws, we = compute_week_window("2026-06-22", prefs, now=_now(2026, 6, 17, 10))
    assert (ws.year, ws.month, ws.day, ws.hour) == (2026, 6, 22, 9)     # Monday 09:00
    assert (we.month, we.day, we.hour) == (6, 28, 18)                   # Sunday 18:00
    assert ws.utcoffset().total_seconds() == 10 * 3600                  # +10 (DST-correct, winter)


def test_window_current_week_clamps_to_today():
    # Picked week Mon 2026-06-15; today is Tue 2026-06-16 10:00 → starts today, not Monday.
    prefs = Preferences(workday_start_hour=9, workday_end_hour=18, timezone="Australia/Sydney")
    ws, we = compute_week_window("2026-06-15", prefs, now=_now(2026, 6, 16, 10))
    assert (ws.month, ws.day, ws.hour) == (6, 16, 9)                    # today 09:00
    assert (we.month, we.day) == (6, 21)                               # Sunday


def test_window_sunday_after_work_hours_is_empty():
    # Today is Sunday 2026-06-21 20:00 (past 18:00); picked week is that same week.
    prefs = Preferences(workday_start_hour=9, workday_end_hour=18, timezone="Australia/Sydney")
    ws, we = compute_week_window("2026-06-15", prefs, now=_now(2026, 6, 21, 20))
    assert ws > we                                                      # empty window


def test_window_end_24_uses_2359():
    prefs = Preferences(workday_start_hour=8, workday_end_hour=24, timezone="Australia/Sydney")
    ws, we = compute_week_window("2026-06-22", prefs, now=_now(2026, 6, 17, 10))
    assert (we.hour, we.minute) == (23, 59)
