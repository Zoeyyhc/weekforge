"""Tests for the per-block semantic classifier."""

from __future__ import annotations

from datetime import datetime, timezone

from weekforge.debate.validation import (
    block_plan,
    classify_blocks,
    compute_week_window,
    remaining_focus_budget,
)
from weekforge.models import Preferences, Task, TimeBlock


def _utc(h, m=0, *, day=15):
    return datetime(2026, 6, day, h, m, tzinfo=timezone.utc)


def _block(label, start_h, end_h, *, task_id=None):
    return TimeBlock(start=_utc(start_h), end=_utc(end_h), label=label, task_id=task_id)


def _prefs(**kw):
    base = dict(workday_start_hour=9, workday_end_hour=18, max_focus_minutes_per_day=360, max_focus_minutes_per_block=120)
    base.update(kw)
    return Preferences(**base)


def test_all_valid_report_is_ok_and_all_frozen():
    blocks = [_block("Deep work", 9, 11, task_id="t1")]
    report = classify_blocks(blocks, [Task(id="t1", title="X", estimated_minutes=120)], [], _prefs())
    assert report.ok is True
    assert report.frozen == blocks
    assert report.to_fix == []


def test_one_broken_block_others_frozen():
    # All-or-nothing freezing is per-task: a broken block in one task must not
    # un-freeze a clean block belonging to a DIFFERENT task.
    good = _block("Good", 9, 11, task_id="t1")  # 120min == t1 estimate
    bad = _block("Early", 7, 8, task_id="t2")  # before work window
    report = classify_blocks(
        [good, bad],
        [Task(id="t1", title="X", estimated_minutes=120), Task(id="t2", title="Y", estimated_minutes=60)],
        [],
        _prefs(),
    )
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
    # Picked week Mon 2026-06-15; now is Tue 2026-06-16 10:00 → starts today at the
    # current moment (10:00), not Monday and not the 09:00 workday start (that hour
    # is already past).
    prefs = Preferences(workday_start_hour=9, workday_end_hour=18, timezone="Australia/Sydney")
    ws, we = compute_week_window("2026-06-15", prefs, now=_now(2026, 6, 16, 10))
    assert (ws.month, ws.day, ws.hour) == (6, 16, 10)                  # today, clamped to now
    assert (we.month, we.day) == (6, 21)                               # Sunday


def test_window_today_clamps_start_to_now_not_workday_start():
    # now is Fri 2026-06-19 17:30 local, workday 09:00–18:00. Today is still usable
    # (before 18:00), but the window must NOT start at 09:00 — that is 8.5h in the
    # past. The lower bound is the current moment, so a 10:00 block today is invalid.
    prefs = Preferences(workday_start_hour=9, workday_end_hour=18, timezone="Australia/Sydney")
    ws, we = compute_week_window("2026-06-15", prefs, now=_now(2026, 6, 19, 17, 30))
    assert (ws.month, ws.day, ws.hour, ws.minute) == (6, 19, 17, 30)


def test_window_sunday_after_work_hours_is_empty():
    # Today is Sunday 2026-06-21 20:00 (past 18:00); picked week is that same week.
    prefs = Preferences(workday_start_hour=9, workday_end_hour=18, timezone="Australia/Sydney")
    ws, we = compute_week_window("2026-06-15", prefs, now=_now(2026, 6, 21, 20))
    assert ws > we                                                      # empty window


def test_window_end_24_uses_2359():
    prefs = Preferences(workday_start_hour=8, workday_end_hour=24, timezone="Australia/Sydney")
    ws, we = compute_week_window("2026-06-22", prefs, now=_now(2026, 6, 17, 10))
    assert (we.hour, we.minute) == (23, 59)


def test_block_before_window_start_is_broken():
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("Australia/Sydney")
    prefs = Preferences(workday_start_hour=9, workday_end_hour=18, timezone="Australia/Sydney")
    window = (
        datetime(2026, 6, 16, 9, tzinfo=tz),   # Tue 09:00
        datetime(2026, 6, 21, 18, tzinfo=tz),  # Sun 18:00
    )
    # Block on Monday 2026-06-15 (before window) → must be flagged.
    block = TimeBlock(start=datetime(2026, 6, 15, 9, tzinfo=tz),
                      end=datetime(2026, 6, 15, 11, tzinfo=tz), label="Past", task_id="t1")
    report = classify_blocks([block], [Task(id="t1", title="X", estimated_minutes=120)], [], prefs, window=window)
    assert report.ok is False
    assert "outside the schedulable week" in report.to_fix[0].errors[0]


def test_block_inside_window_is_ok():
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("Australia/Sydney")
    prefs = Preferences(workday_start_hour=9, workday_end_hour=18, max_focus_minutes_per_block=120, timezone="Australia/Sydney")
    window = (datetime(2026, 6, 16, 9, tzinfo=tz), datetime(2026, 6, 21, 18, tzinfo=tz))
    block = TimeBlock(start=datetime(2026, 6, 16, 9, tzinfo=tz),
                      end=datetime(2026, 6, 16, 11, tzinfo=tz), label="OK", task_id="t1")
    report = classify_blocks([block], [Task(id="t1", title="X", estimated_minutes=120)], [], prefs, window=window)
    assert report.ok is True


# ── block_plan helper ────────────────────────────────────────────────────────

def test_block_plan_single_when_within_cap():
    assert block_plan(90, 90) == [90]
    assert block_plan(45, 90) == [45]


def test_block_plan_even_split():
    assert block_plan(180, 90) == [90, 90]
    assert block_plan(180, 45) == [45, 45, 45, 45]


def test_block_plan_uneven_remainder_each_within_cap():
    plan = block_plan(170, 45)
    assert plan == [43, 43, 42, 42]
    assert sum(plan) == 170
    assert all(d <= 45 for d in plan)


def test_block_plan_sums_to_estimate_and_respects_cap():
    plan = block_plan(200, 90)
    assert sum(plan) == 200
    assert all(d <= 90 for d in plan)
    assert len(plan) == 3


# ── Rule 7: per-task conformance + all-or-nothing freezing ───────────────────

def _tb(start_h, start_m, end_h, end_m, label, task_id):
    return TimeBlock(
        start=datetime(2026, 6, 16, start_h, start_m, tzinfo=timezone.utc),
        end=datetime(2026, 6, 16, end_h, end_m, tzinfo=timezone.utc),
        label=label, task_id=task_id,
    )


def test_conforming_split_task_all_frozen():
    prefs = _prefs(max_focus_minutes_per_block=90)              # plan [90,90]
    blocks = [
        _tb(9, 0, 10, 30, "Report (1/2)", "t1"),               # 90min
        _tb(11, 0, 12, 30, "Report (2/2)", "t1"),              # 90min
    ]
    report = classify_blocks(blocks, [Task(id="t1", title="Report", estimated_minutes=180)], [], prefs)
    assert all(r.frozen for r in report.reports)


def test_over_placement_marks_whole_task_broken():
    prefs = _prefs(max_focus_minutes_per_block=90)              # plan [90,90]
    blocks = [
        _tb(9, 0, 10, 30, "Report (1/3)", "t1"),
        _tb(11, 0, 12, 30, "Report (2/3)", "t1"),
        _tb(13, 0, 14, 30, "Report (3/3)", "t1"),              # 3rd block > plan
    ]
    report = classify_blocks(blocks, [Task(id="t1", title="Report", estimated_minutes=180)], [], prefs)
    assert all(not r.frozen for r in report.reports)
    assert any("re-placed as a unit" in e for r in report.reports for e in r.errors)


def test_under_placement_conforms_and_freezes():
    # Only one of the two planned blocks placed -> sub-multiset, still clean.
    prefs = _prefs(max_focus_minutes_per_block=90)              # plan [90,90]
    blocks = [_tb(9, 0, 10, 30, "Report (1/2)", "t1")]
    report = classify_blocks(blocks, [Task(id="t1", title="Report", estimated_minutes=180)], [], prefs)
    assert report.reports[0].frozen


def test_one_broken_block_marks_whole_task_broken():
    # 2 conforming-duration blocks but one is outside the work window -> all re-place.
    prefs = _prefs(max_focus_minutes_per_block=90)              # plan [90,90]
    blocks = [
        _tb(9, 0, 10, 30, "Report (1/2)", "t1"),               # valid
        _tb(7, 0, 8, 30, "Report (2/2)", "t1"),                # before 09:00 window
    ]
    report = classify_blocks(blocks, [Task(id="t1", title="Report", estimated_minutes=180)], [], prefs)
    assert all(not r.frozen for r in report.reports)
