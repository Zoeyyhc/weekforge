"""Tests for the validate_blocks guardrail pure function."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from weekforge.debate.nodes import validate_blocks
from weekforge.models import Preferences, Task, TimeBlock


def _utc(h, m=0, *, day=15):
    """Return a UTC-aware datetime on 2026-06-<day>."""
    return datetime(2026, 6, day, h, m, tzinfo=timezone.utc)


def _block(label, start_h, end_h, *, task_id=None, start_day=15, end_day=15):
    return TimeBlock(
        start=_utc(start_h, day=start_day),
        end=_utc(end_h, day=end_day),
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
    errors = validate_blocks(blocks, [], [], Preferences(workday_start_hour=9, workday_end_hour=18))
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


# ── Rule 3: busy-block overlap ───────────────────────────────────────────────

def test_block_overlapping_busy_is_reported():
    blocks = [_block("Work", 10, 12)]
    busy = [_block("Meeting", 11, 13)]
    errors = validate_blocks(blocks, [], busy, Preferences())
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
    prefs = Preferences(workday_start_hour=8, workday_end_hour=20, max_focus_minutes_per_day=360)
    errors = validate_blocks(blocks, [], [], prefs)
    assert not any("exceeds" in e for e in errors)


# ── All rules satisfied ──────────────────────────────────────────────────────

def test_all_valid_returns_empty_list():
    blocks = [_block("Deep work", 9, 11, task_id="t1")]
    tasks = [_task("t1")]
    busy = [_block("Standup", 8, 9)]
    prefs = Preferences(workday_start_hour=9, workday_end_hour=18, max_focus_minutes_per_day=360)
    errors = validate_blocks(blocks, tasks, busy, prefs)
    assert errors == []


# ── timezone=None fallback ───────────────────────────────────────────────────

def test_timezone_none_fallback_utc_does_not_crash():
    # Block at 07:00 UTC before work start 09:00; preferences.timezone=None → UTC
    blocks = [_block("Early", 7, 8)]
    prefs = Preferences(workday_start_hour=9, timezone=None)
    errors = validate_blocks(blocks, [], [], prefs)
    assert any("before work window" in e for e in errors)
