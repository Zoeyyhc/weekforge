"""Tests for the validate_blocks guardrail pure function."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from weekforge.debate.nodes import validate_blocks
from weekforge.debate.validation import classify_blocks, underscheduled_tasks
from weekforge.models import Preferences, Task, TimeBlock


def _utc(h, m=0, *, day=15):
    """Return a UTC-aware datetime on 2026-06-<day>."""
    return datetime(2026, 6, day, h, m, tzinfo=timezone.utc)


def _block(label, start_h, end_h, *, task_id=None, start_day=15, end_day=15, end_m=0):
    return TimeBlock(
        start=_utc(start_h, day=start_day),
        end=_utc(end_h, end_m, day=end_day),
        label=label,
        task_id=task_id,
    )


def _task(tid="t1"):
    return Task(id=tid, title="Task", estimated_minutes=60, priority=1)


# ── Rule 1: unknown task_id ──────────────────────────────────────────────────

def test_unknown_task_id_is_reported():
    blocks = [_block("Deep work", 9, 10, task_id="t99")]
    errors = validate_blocks(blocks, [_task("t1")], [], Preferences())
    assert len(errors) == 1
    assert "unknown task_id" in errors[0]
    assert "t99" in errors[0]


def test_known_task_id_passes():
    blocks = [_block("Deep work", 9, 10, task_id="t1")]
    errors = validate_blocks(blocks, [_task("t1")], [], Preferences())
    assert errors == []


def test_null_task_id_passes():
    blocks = [_block("Break", 9, 10, task_id=None)]
    errors = validate_blocks(blocks, [], [], Preferences())
    assert errors == []


# ── Rule 2: work window (local time) ────────────────────────────────────────

def test_block_before_work_start_is_reported():
    # Block at 07:00 UTC, workday starts at 09:00, timezone=None → UTC fallback
    blocks = [_block("Early bird", 7, 8)]
    errors = validate_blocks(blocks, [], [], Preferences(workday_start_hour=9))
    assert len(errors) == 1
    assert "before work window" in errors[0]
    assert "07:00" in errors[0]
    assert "09:00" in errors[0]


def test_block_within_work_window_passes():
    blocks = [_block("Focus", 9, 11)]
    errors = validate_blocks(blocks, [], [], Preferences(workday_start_hour=9, workday_end_hour=18, max_focus_minutes_per_block=120))
    assert errors == []


def test_workday_end_24_allows_late_blocks():
    # Block from 22:00 to 23:00 should be valid when workday_end_hour=24
    blocks = [_block("Late session", 22, 23)]
    errors = validate_blocks(
        blocks, [], [], Preferences(workday_start_hour=8, workday_end_hour=24)
    )
    assert errors == []


def test_local_timezone_applied_for_work_window():
    # 00:00 UTC = 10:00 AEST (UTC+10); workday starts 09:00 → should pass
    blocks = [
        TimeBlock(
            start=datetime(2026, 6, 15, 0, 0, tzinfo=timezone.utc),
            end=datetime(2026, 6, 15, 1, 0, tzinfo=timezone.utc),
            label="Morning focus",
        )
    ]
    prefs = Preferences(workday_start_hour=9, workday_end_hour=18, timezone="Australia/Sydney")
    errors = validate_blocks(blocks, [], [], prefs)
    assert errors == []


# ── Rule 2: no cross-midnight blocks ─────────────────────────────────────────

def test_cross_midnight_block_is_reported():
    # Starts 22:00 on the 15th, ends 00:30 on the 16th → spans midnight.
    blocks = [_block("Night owl", 22, 0, start_day=15, end_day=16, end_m=30)]
    prefs = Preferences(workday_start_hour=8, workday_end_hour=24, max_focus_minutes_per_block=180)
    errors = validate_blocks(blocks, [], [], prefs)
    assert len(errors) == 1
    assert "spans midnight" in errors[0]
    assert "Night owl" in errors[0]


def test_cross_midnight_uses_local_dates_not_utc_dates():
    # 13:30-14:30 UTC on Jun 15 = 23:30 Jun 15 to 00:30 Jun 16 in Sydney.
    blocks = [
        TimeBlock(
            start=datetime(2026, 6, 15, 13, 30, tzinfo=timezone.utc),
            end=datetime(2026, 6, 15, 14, 30, tzinfo=timezone.utc),
            label="Sydney late session",
        )
    ]
    prefs = Preferences(workday_start_hour=8, workday_end_hour=24, timezone="Australia/Sydney")
    errors = validate_blocks(blocks, [], [], prefs)
    assert len(errors) == 1
    assert "spans midnight" in errors[0]
    assert "Sydney late session" in errors[0]


def test_same_day_block_after_work_end_is_reported():
    # Same-day block ending 19:00 with workday_end_hour=18 → after work window.
    blocks = [_block("Overtime", 9, 19)]
    errors = validate_blocks(
        blocks,
        [],
        [],
        Preferences(workday_start_hour=9, workday_end_hour=18, max_focus_minutes_per_day=600, max_focus_minutes_per_block=600),
    )
    assert len(errors) == 1
    assert "after work window" in errors[0]
    assert "19:00" in errors[0]


# ── Rule 3: busy-block overlap ───────────────────────────────────────────────

def test_block_overlapping_busy_is_reported():
    blocks = [_block("Work", 10, 12)]
    busy = [_block("Meeting", 11, 13)]
    errors = validate_blocks(blocks, [], busy, Preferences(max_focus_minutes_per_block=120))
    assert len(errors) == 1
    assert "overlaps with busy" in errors[0]
    assert "Meeting" in errors[0]


def test_adjacent_block_not_overlap():
    # Block ends at 10:00, busy starts at 10:00 → no overlap
    blocks = [_block("Work", 9, 10)]
    busy = [_block("Meeting", 10, 11)]
    errors = validate_blocks(blocks, [], busy, Preferences())
    assert errors == []


def test_fully_contained_in_busy_is_reported():
    blocks = [_block("Work", 10, 11)]
    busy = [_block("Long meeting", 9, 12)]
    errors = validate_blocks(blocks, [], busy, Preferences())
    assert len(errors) == 1
    assert "overlaps with busy" in errors[0]


# ── Rule 4: daily max focus minutes ─────────────────────────────────────────

def test_exceeding_daily_max_is_reported():
    # 4×120 = 480 min > 360 limit; within work window
    blocks = [
        _block("Block A", 9, 11),
        _block("Block B", 11, 13),
        _block("Block C", 13, 15),
        _block("Block D", 15, 17),
    ]
    prefs = Preferences(workday_start_hour=8, workday_end_hour=20, max_focus_minutes_per_day=360)
    errors = validate_blocks(blocks, [], [], prefs)
    assert any("exceeds" in e and "360min/day" in e for e in errors)


def test_meeting_daily_max_exactly_passes():
    # 3×120 = 360 min == limit → no error
    blocks = [
        _block("Block A", 9, 11),
        _block("Block B", 11, 13),
        _block("Block C", 13, 15),
    ]
    prefs = Preferences(workday_start_hour=8, workday_end_hour=20, max_focus_minutes_per_day=360, max_focus_minutes_per_block=120)
    errors = validate_blocks(blocks, [], [], prefs)
    assert not any("exceeds" in e for e in errors)


# ── All rules satisfied ──────────────────────────────────────────────────────

def test_all_valid_returns_empty_list():
    blocks = [_block("Deep work", 9, 11, task_id="t1")]
    tasks = [_task("t1")]
    busy = [_block("Standup", 8, 9)]
    prefs = Preferences(workday_start_hour=9, workday_end_hour=18, max_focus_minutes_per_day=360, max_focus_minutes_per_block=120)
    errors = validate_blocks(blocks, tasks, busy, prefs)
    assert errors == []


# ── timezone=None fallback ───────────────────────────────────────────────────

def test_timezone_none_fallback_utc_does_not_crash():
    # Block at 07:00 UTC before work start 09:00; preferences.timezone=None → UTC
    blocks = [_block("Early", 7, 8)]
    prefs = Preferences(workday_start_hour=9, timezone=None)
    errors = validate_blocks(blocks, [], [], prefs)
    assert any("before work window" in e for e in errors)


# ── Rule 6: per-block focus cap ──────────────────────────────────────────────

def test_block_over_per_block_cap_is_reported_and_not_frozen():
    prefs = Preferences(max_focus_minutes_per_block=90, max_focus_minutes_per_day=360)
    task = Task(id="t1", title="Report", estimated_minutes=180)
    block = TimeBlock(
        start=datetime(2026, 6, 16, 9, 0, tzinfo=timezone.utc),
        end=datetime(2026, 6, 16, 12, 0, tzinfo=timezone.utc),  # 180min
        label="Report",
        task_id="t1",
    )
    report = classify_blocks([block], [task], [], prefs)
    rep = report.reports[0]
    assert not rep.frozen
    assert any("single-focus cap" in e for e in rep.errors)


def test_block_at_per_block_cap_is_clean():
    prefs = Preferences(max_focus_minutes_per_block=90, max_focus_minutes_per_day=360)
    task = Task(id="t1", title="Report", estimated_minutes=90)
    block = TimeBlock(
        start=datetime(2026, 6, 16, 9, 0, tzinfo=timezone.utc),
        end=datetime(2026, 6, 16, 10, 30, tzinfo=timezone.utc),  # 90min
        label="Report",
        task_id="t1",
    )
    report = classify_blocks([block], [task], [], prefs)
    assert report.reports[0].frozen


# ── underscheduled_tasks helper ──────────────────────────────────────────────

def test_underscheduled_tasks_flags_short_task():
    tasks = [Task(id="t1", title="Report", estimated_minutes=180)]
    blocks = [
        TimeBlock(
            start=datetime(2026, 6, 16, 9, 0, tzinfo=timezone.utc),
            end=datetime(2026, 6, 16, 10, 30, tzinfo=timezone.utc),  # 90min
            label="Report (1/2)",
            task_id="t1",
        )
    ]
    assert underscheduled_tasks(blocks, tasks) == {"t1": (90, 180)}


def test_underscheduled_tasks_sums_multiple_blocks_and_omits_complete():
    tasks = [Task(id="t1", title="Report", estimated_minutes=180)]
    blocks = [
        TimeBlock(
            start=datetime(2026, 6, 16, 9, 0, tzinfo=timezone.utc),
            end=datetime(2026, 6, 16, 10, 30, tzinfo=timezone.utc),  # 90
            label="Report (1/2)", task_id="t1",
        ),
        TimeBlock(
            start=datetime(2026, 6, 16, 11, 0, tzinfo=timezone.utc),
            end=datetime(2026, 6, 16, 12, 30, tzinfo=timezone.utc),  # 90
            label="Report (2/2)", task_id="t1",
        ),
    ]
    assert underscheduled_tasks(blocks, tasks) == {}


def test_underscheduled_tasks_ignores_blocks_without_task_id():
    tasks = [Task(id="t1", title="Report", estimated_minutes=60)]
    blocks = [
        TimeBlock(
            start=datetime(2026, 6, 16, 9, 0, tzinfo=timezone.utc),
            end=datetime(2026, 6, 16, 10, 0, tzinfo=timezone.utc),
            label="Lunch", task_id=None,
        )
    ]
    assert underscheduled_tasks(blocks, tasks) == {"t1": (0, 60)}
