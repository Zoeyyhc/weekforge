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
