# Guardrail + Local-time Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `_fmt_busy` to show local time to debaters, and add a semantic guardrail (`validate_blocks`) that rejects schedules violating work-hours, busy-block, or daily-cap constraints.

**Architecture:** All changes are confined to `src/weekforge/debate/nodes.py`. A new pure function `validate_blocks` holds the four semantic rules independent of LangGraph state, making it easy to unit-test. `make_validate_node` calls it after successful JSON parsing; any errors trigger the existing retry route via `validation_error` + `transcript`.

**Tech Stack:** Python 3.12+, `zoneinfo` (stdlib), `pytest`, Pydantic models from `weekforge.models`

---

## File Map

| Action | Path |
|--------|------|
| Modify | `src/weekforge/debate/nodes.py` |
| Create | `tests/debate/test_validate_blocks.py` |
| Modify | `tests/debate/test_nodes.py` (add one test case) |

---

### Task 1: Write failing test for `_fmt_busy` local-time conversion

**Files:**
- Modify: `tests/debate/test_nodes.py`

- [ ] **Step 1: Add test at bottom of test_nodes.py**

Append after the last test in `tests/debate/test_nodes.py`:

```python
def test_fmt_busy_converts_utc_to_local_timezone(base_state):
    from weekforge.debate.nodes import _fmt_busy

    state = {
        **base_state,
        "preferences": Preferences(timezone="Australia/Sydney"),
        "busy_blocks": [
            TimeBlock(
                start=datetime(2026, 6, 15, 12, 0, tzinfo=timezone.utc),
                end=datetime(2026, 6, 15, 13, 0, tzinfo=timezone.utc),
                label="Meeting",
            )
        ],
    }
    result = _fmt_busy(state)
    # Jun 2026 → AEST (UTC+10), so 12:00 UTC = 22:00 local
    assert "22:00" in result
    assert "local" in result
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/Najum/weekforge && uv run pytest tests/debate/test_nodes.py::test_fmt_busy_converts_utc_to_local_timezone -v
```

Expected: FAIL — current `_fmt_busy` uses raw `strftime` on UTC datetime, will produce `12:00` not `22:00`, and has no "local" suffix.

---

### Task 2: Fix `_fmt_busy` and update imports

**Files:**
- Modify: `src/weekforge/debate/nodes.py`

- [ ] **Step 1: Update the import block at top of nodes.py**

Replace:
```python
from datetime import datetime
```
With:
```python
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo
```

Also extend the models import:
```python
from weekforge.models import Schedule, TimeBlock
```
→
```python
from weekforge.models import Preferences, Schedule, Task, TimeBlock
```

- [ ] **Step 2: Replace `_fmt_busy` (lines 39–44 in nodes.py)**

Replace:
```python
def _fmt_busy(state: DebateState) -> str:
    lines = [
        f"- {b.label}: {b.start.strftime('%a %d %b %H:%M')}–{b.end.strftime('%H:%M')}"
        for b in state["busy_blocks"]
    ]
    return "\n".join(lines) if lines else "No fixed commitments."
```

With:
```python
def _fmt_busy(state: DebateState) -> str:
    tz_name = state["preferences"].timezone
    tz = ZoneInfo(tz_name) if tz_name else timezone.utc
    lines = [
        f"- {b.label}: "
        f"{b.start.astimezone(tz).strftime('%a %d %b %H:%M')}–"
        f"{b.end.astimezone(tz).strftime('%H:%M')} local"
        for b in state["busy_blocks"]
    ]
    return "\n".join(lines) if lines else "No fixed commitments."
```

- [ ] **Step 3: Run the failing test from Task 1**

```bash
cd /Users/Najum/weekforge && uv run pytest tests/debate/test_nodes.py::test_fmt_busy_converts_utc_to_local_timezone -v
```

Expected: PASS

- [ ] **Step 4: Run full test suite to check for regressions**

```bash
cd /Users/Najum/weekforge && uv run pytest tests/debate/test_nodes.py -v
```

Expected: all existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/Najum/weekforge add src/weekforge/debate/nodes.py tests/debate/test_nodes.py
git -C /Users/Najum/weekforge commit -m "fix: convert busy blocks to local timezone in _fmt_busy"
```

---

### Task 3: Write failing tests for `validate_blocks`

**Files:**
- Create: `tests/debate/test_validate_blocks.py`

- [ ] **Step 1: Create the test file**

```python
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
    # 4×120 = 480 min > 360 limit; spread across the day to avoid work-window issues
    blocks = [
        _block("Block A", 9, 11),   # 120 min
        _block("Block B", 11, 13),  # 120 min
        _block("Block C", 13, 15),  # 120 min
        _block("Block D", 15, 17),  # 120 min
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
    # Must not raise; must still report the work-window violation
    errors = validate_blocks(blocks, [], [], prefs)
    assert any("before work window" in e for e in errors)
```

- [ ] **Step 2: Run tests to verify they all fail**

```bash
cd /Users/Najum/weekforge && uv run pytest tests/debate/test_validate_blocks.py -v
```

Expected: all FAIL with `ImportError: cannot import name 'validate_blocks' from 'weekforge.debate.nodes'`

---

### Task 4: Implement `validate_blocks`

**Files:**
- Modify: `src/weekforge/debate/nodes.py`

- [ ] **Step 1: Add `validate_blocks` after `_fmt_transcript_tail` and before the node factories**

Insert this function at approximately line 64 (after `_fmt_transcript_tail`, before `# ── Node factories ──`):

```python
def validate_blocks(
    blocks: list[TimeBlock],
    tasks: list[Task],
    busy_blocks: list[TimeBlock],
    preferences: Preferences,
) -> list[str]:
    """Return all semantic error descriptions. Empty list = pass."""
    errors: list[str] = []
    known_ids = {t.id for t in tasks}
    tz = ZoneInfo(preferences.timezone) if preferences.timezone else timezone.utc

    minutes_per_day: dict[date, int] = {}

    for block in blocks:
        local_start = block.start.astimezone(tz)
        local_end = block.end.astimezone(tz)

        # Rule 1: task_id must be known or None
        if block.task_id is not None and block.task_id not in known_ids:
            errors.append(f"Block '{block.label}': unknown task_id '{block.task_id}'")

        # Rule 2: block must start within work window (local time)
        if local_start.hour + local_start.minute / 60 < preferences.workday_start_hour:
            errors.append(
                f"Block '{block.label}': starts {local_start.strftime('%H:%M')} local, "
                f"before work window {preferences.workday_start_hour:02d}:00"
            )
        # Check end time only for same-day blocks and when end_hour < 24
        cross_day = local_start.date() != local_end.date()
        if not cross_day and preferences.workday_end_hour < 24:
            if local_end.hour + local_end.minute / 60 > preferences.workday_end_hour:
                errors.append(
                    f"Block '{block.label}': ends {local_end.strftime('%H:%M')} local, "
                    f"after work window {preferences.workday_end_hour:02d}:00"
                )

        # Rule 3: no overlap with busy blocks
        for busy in busy_blocks:
            if block.start < busy.end and block.end > busy.start:
                busy_local = busy.start.astimezone(tz)
                busy_local_end = busy.end.astimezone(tz)
                errors.append(
                    f"Block '{block.label}': overlaps with busy '{busy.label}' "
                    f"({busy_local.strftime('%H:%M')}–{busy_local_end.strftime('%H:%M')} local)"
                )

        # Accumulate minutes per local day for Rule 4
        day = local_start.date()
        minutes_per_day[day] = minutes_per_day.get(day, 0) + block.duration_minutes

    # Rule 4: daily focus cap
    for day, total in minutes_per_day.items():
        if total > preferences.max_focus_minutes_per_day:
            errors.append(
                f"{day.strftime('%a %d %b')}: {total}min scheduled, "
                f"exceeds {preferences.max_focus_minutes_per_day}min/day limit"
            )

    return errors
```

- [ ] **Step 2: Run validate_blocks tests**

```bash
cd /Users/Najum/weekforge && uv run pytest tests/debate/test_validate_blocks.py -v
```

Expected: all PASS.

- [ ] **Step 3: Run full debate test suite to check no regressions**

```bash
cd /Users/Najum/weekforge && uv run pytest tests/debate/ -v
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git -C /Users/Najum/weekforge add src/weekforge/debate/nodes.py tests/debate/test_validate_blocks.py
git -C /Users/Najum/weekforge commit -m "feat: add validate_blocks semantic guardrail"
```

---

### Task 5: Write failing test for semantic validation in `make_validate_node`

**Files:**
- Modify: `tests/debate/test_nodes.py`

- [ ] **Step 1: Add test after the existing `test_validate_sets_error_on_invalid_json` test**

```python
def test_validate_sets_error_on_semantic_violation(base_state, mock_api_key):
    # Block at 02:00 UTC with timezone=None (UTC fallback) before workday_start=9
    out_of_hours_json = (
        '[{"start": "2026-06-15T02:00:00+00:00", "end": "2026-06-15T03:00:00+00:00",'
        ' "label": "Night work", "task_id": "t1"}]'
    )
    state = {
        **base_state,
        "arbiter_output": out_of_hours_json,
        "round_number": 1,
        "preferences": Preferences(workday_start_hour=9, timezone=None),
    }

    with patch("weekforge.debate.nodes.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_response = MagicMock()
        mock_response.content[0].text = out_of_hours_json
        mock_client.messages.create.return_value = mock_response

        node = make_validate_node(mock_api_key)
        result = node(state)

    assert result["schedule"] is None
    assert result["validation_error"] is not None
    assert "semantic validation" in result["validation_error"]
    assert len(result["transcript"]) == 1
    assert result["transcript"][0]["event_type"] == "validation_fail"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/Najum/weekforge && uv run pytest tests/debate/test_nodes.py::test_validate_sets_error_on_semantic_violation -v
```

Expected: FAIL — current `make_validate_node` does no semantic check, returns a `Schedule` for syntactically valid JSON.

---

### Task 6: Wire `validate_blocks` into `make_validate_node`

**Files:**
- Modify: `src/weekforge/debate/nodes.py`

- [ ] **Step 1: Replace the happy-path return in `make_validate_node`**

Inside the `try` block of `validate`, find:
```python
            schedule = Schedule(blocks=blocks)
            return {"schedule": schedule, "validation_error": None}
```

Replace with:
```python
            errors = validate_blocks(
                blocks,
                state["tasks"],
                state["busy_blocks"],
                state["preferences"],
            )
            if errors:
                error_msg = "Schedule failed semantic validation:\n" + "\n".join(
                    f"  - {e}" for e in errors
                )
                event = {
                    "round": state["round_number"],
                    "speaker": "System",
                    "content": "Schedule failed semantic validation. Retrying arbitration.",
                    "event_type": "validation_fail",
                }
                return {"schedule": None, "validation_error": error_msg, "transcript": [event]}
            return {"schedule": Schedule(blocks=blocks), "validation_error": None}
```

- [ ] **Step 2: Run the new test**

```bash
cd /Users/Najum/weekforge && uv run pytest tests/debate/test_nodes.py::test_validate_sets_error_on_semantic_violation -v
```

Expected: PASS.

- [ ] **Step 3: Run the full test suite**

```bash
cd /Users/Najum/weekforge && uv run pytest tests/ -v
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git -C /Users/Najum/weekforge add src/weekforge/debate/nodes.py tests/debate/test_nodes.py
git -C /Users/Najum/weekforge commit -m "feat: wire validate_blocks guardrail into make_validate_node"
```

---

## Self-Review

### Spec coverage

| Spec requirement | Task |
|---|---|
| `_fmt_busy` converts UTC → local using `ZoneInfo` | Task 2 |
| Fallback to UTC when `timezone` is None | Task 2, tested in Task 3 |
| Append "local" suffix | Task 2 |
| `validate_blocks` pure function with 4 rules | Task 4 |
| Rule 1: unknown task_id | Task 3+4 |
| Rule 2: outside work window (local) | Task 3+4 |
| Rule 3: overlaps busy block | Task 3+4 |
| Rule 4: daily cap exceeded | Task 3+4 |
| `workday_end_hour=24` edge case | Task 3+4 (`test_workday_end_24_allows_late_blocks`) |
| Cross-day blocks: only check start hour | Task 4 (in implementation, `cross_day` guard) |
| `make_validate_node` calls guardrail after parse | Task 6 |
| Errors feed back into retry via `validation_error` | Task 6 |
| No changes to `graph.py` | Satisfied — nothing in graph.py touched |
| Tests: `test_validate_blocks.py` covering all 6 required scenarios | Task 3 |
| Tests: `_fmt_busy` UTC+10 case | Task 1 |

### Placeholder scan

No TBD, TODO, or "similar to Task N" patterns. All code steps contain concrete, runnable code.

### Type consistency

- `validate_blocks` signature uses `list[TimeBlock]`, `list[Task]`, `list[TimeBlock]`, `Preferences` — all from `weekforge.models`, imported in Task 2.
- `block.duration_minutes` property exists on `TimeBlock` (line 40 of models.py).
- `state["tasks"]`, `state["busy_blocks"]`, `state["preferences"]` are all present in `DebateState`.
- `ZoneInfo` and `timezone` both imported in Task 2; used consistently in both `_fmt_busy` and `validate_blocks`.
