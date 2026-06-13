# WeekForge Foundation (Data Layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the LLM-free foundation of WeekForge — domain models and pluggable data providers — fully covered by tests, so the debate engine (a later plan) has typed inputs to work with.

**Architecture:** Pure-Python package under `src/weekforge`. Pydantic models define the domain (`Task`, `TimeBlock`, `Preferences`, `Schedule`). Data sources sit behind `Protocol` interfaces so Mock / ICS / Google backends are hot-swappable; v1 ships `MockCalendarProvider`, `ICSCalendarProvider`, and `JSONTaskProvider`. No LLM, no web framework — this layer is deterministic and unit-testable.

**Tech Stack:** Python ≥3.12, `uv` (project + deps), `pydantic` v2 (models), `icalendar` (ICS parsing), `pytest` (tests).

---

## File Structure

- Create: `pyproject.toml` — project metadata, deps, pytest config
- Create: `.gitignore` — Python/venv ignores
- Create: `src/weekforge/__init__.py` — package marker
- Create: `src/weekforge/models.py` — `Task`, `TimeBlock`, `Preferences`, `Schedule`
- Create: `src/weekforge/providers/__init__.py` — package marker
- Create: `src/weekforge/providers/calendar.py` — `CalendarProvider` protocol, `MockCalendarProvider`, `ICSCalendarProvider`
- Create: `src/weekforge/providers/tasks.py` — `TaskProvider` protocol, `JSONTaskProvider`
- Create: `tests/test_models.py`
- Create: `tests/test_calendar_provider.py`
- Create: `tests/test_tasks_provider.py`
- Create: `tests/fixtures/sample_calendar.ics`
- Create: `tests/fixtures/sample_tasks.json`

---

## Task 1: Project scaffold & tooling

**Files:**
- Create: `pyproject.toml`
- Create: `.gitignore`
- Create: `src/weekforge/__init__.py`
- Create: `src/weekforge/providers/__init__.py`

- [ ] **Step 1: Create `pyproject.toml`**

```toml
[project]
name = "weekforge"
version = "0.1.0"
description = "WeekForge (Crucible) — a transparent multi-agent decision council."
requires-python = ">=3.12"
dependencies = [
    "pydantic>=2.7",
    "icalendar>=5.0",
]

[dependency-groups]
dev = [
    "pytest>=8.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/weekforge"]

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]
```

- [ ] **Step 2: Create package markers**

Create `src/weekforge/__init__.py`:

```python
"""WeekForge (Crucible) — a transparent multi-agent decision council."""

__version__ = "0.1.0"
```

Create `src/weekforge/providers/__init__.py`:

```python
"""Pluggable data-source providers (calendar, tasks)."""
```

- [ ] **Step 3: Create `.gitignore`**

```gitignore
__pycache__/
*.py[cod]
.venv/
.pytest_cache/
*.egg-info/
dist/
build/
.env
.env.local
```

- [ ] **Step 4: Install dependencies and verify the package imports**

Run: `uv sync`
Expected: creates `.venv/`, resolves and installs `pydantic`, `icalendar`, `pytest`.

Run: `uv run python -c "import weekforge; print(weekforge.__version__)"`
Expected: prints `0.1.0`

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml .gitignore src/weekforge/__init__.py src/weekforge/providers/__init__.py
git commit -m "chore: scaffold weekforge Python package"
```

---

## Task 2: Domain models

**Files:**
- Create: `src/weekforge/models.py`
- Test: `tests/test_models.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_models.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'weekforge.models'`

- [ ] **Step 3: Write the implementation**

Create `src/weekforge/models.py`:

```python
"""Domain models for WeekForge. Pure data, no I/O."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class Task(BaseModel):
    """A unit of work the council must schedule."""

    id: str
    title: str
    estimated_minutes: int = Field(gt=0)
    deadline: datetime | None = None
    priority: int = Field(default=3, ge=1, le=5)  # 1 = highest
    category: str | None = None  # used by the Focus Batcher for grouping
    depends_on: list[str] = Field(default_factory=list)


class TimeBlock(BaseModel):
    """A span of time. Used for calendar busy blocks and scheduled tasks."""

    start: datetime
    end: datetime
    label: str
    task_id: str | None = None  # set when the block is a scheduled task

    @model_validator(mode="after")
    def _end_after_start(self) -> TimeBlock:
        if self.end <= self.start:
            raise ValueError("TimeBlock.end must be after start")
        return self

    @property
    def duration_minutes(self) -> int:
        return int((self.end - self.start).total_seconds() // 60)


class Preferences(BaseModel):
    """User scheduling preferences."""

    workday_start_hour: int = Field(default=9, ge=0, le=23)
    workday_end_hour: int = Field(default=18, ge=1, le=24)
    max_focus_minutes_per_day: int = Field(default=360, gt=0)

    @model_validator(mode="after")
    def _end_after_start(self) -> Preferences:
        if self.workday_end_hour <= self.workday_start_hour:
            raise ValueError("workday_end_hour must be after workday_start_hour")
        return self


class Schedule(BaseModel):
    """The council's output: a set of time blocks for the week."""

    blocks: list[TimeBlock] = Field(default_factory=list)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_models.py -v`
Expected: PASS (7 passed)

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/models.py tests/test_models.py
git commit -m "feat: add domain models (Task, TimeBlock, Preferences, Schedule)"
```

---

## Task 3: Calendar providers (protocol + Mock)

**Files:**
- Create: `src/weekforge/providers/calendar.py`
- Test: `tests/test_calendar_provider.py`

- [ ] **Step 1: Write the failing tests for the Mock provider**

Create `tests/test_calendar_provider.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_calendar_provider.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'weekforge.providers.calendar'`

- [ ] **Step 3: Write the protocol and Mock implementation**

Create `src/weekforge/providers/calendar.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_calendar_provider.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/providers/calendar.py tests/test_calendar_provider.py
git commit -m "feat: add CalendarProvider protocol and MockCalendarProvider"
```

---

## Task 4: ICS calendar provider

**Files:**
- Modify: `src/weekforge/providers/calendar.py` (append `ICSCalendarProvider`)
- Create: `tests/fixtures/sample_calendar.ics`
- Modify: `tests/test_calendar_provider.py` (append ICS tests)

- [ ] **Step 1: Create the ICS fixture**

Create `tests/fixtures/sample_calendar.ics`:

```ics
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//WeekForge//Test//EN
BEGIN:VEVENT
UID:evt-1@weekforge.test
DTSTART:20260615T090000Z
DTEND:20260615T100000Z
SUMMARY:Team standup
END:VEVENT
BEGIN:VEVENT
UID:evt-2@weekforge.test
DTSTART:20260620T140000Z
DTEND:20260620T150000Z
SUMMARY:Out-of-range meeting
END:VEVENT
END:VCALENDAR
```

- [ ] **Step 2: Write the failing tests for the ICS provider**

Append to `tests/test_calendar_provider.py`:

```python
from pathlib import Path

from weekforge.providers.calendar import ICSCalendarProvider

FIXTURE = Path(__file__).parent / "fixtures" / "sample_calendar.ics"


def test_ics_parses_event_in_range():
    provider = ICSCalendarProvider(FIXTURE)

    result = provider.get_busy_blocks(_utc(2026, 6, 15, 0), _utc(2026, 6, 16, 0))

    assert len(result) == 1
    assert result[0].label == "Team standup"
    assert result[0].duration_minutes == 60
    assert result[0].start == _utc(2026, 6, 15, 9)


def test_ics_excludes_event_out_of_range():
    provider = ICSCalendarProvider(FIXTURE)

    result = provider.get_busy_blocks(_utc(2026, 6, 15, 0), _utc(2026, 6, 16, 0))

    labels = [b.label for b in result]
    assert "Out-of-range meeting" not in labels
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/test_calendar_provider.py -v -k ics`
Expected: FAIL — `ImportError: cannot import name 'ICSCalendarProvider'`

- [ ] **Step 4: Implement the ICS provider**

Append to `src/weekforge/providers/calendar.py`:

```python
from pathlib import Path

from icalendar import Calendar as _ICalendar


class ICSCalendarProvider:
    """Reads busy blocks from an iCalendar (.ics) file.

    v1 reads from a local path. A future URL-backed variant (Google's secret
    iCal address) can wrap this by fetching the bytes first.
    """

    def __init__(self, ics_path: str | Path) -> None:
        self._path = Path(ics_path)

    def get_busy_blocks(self, start: datetime, end: datetime) -> list[TimeBlock]:
        calendar = _ICalendar.from_ical(self._path.read_bytes())
        blocks: list[TimeBlock] = []
        for event in calendar.walk("VEVENT"):
            block = TimeBlock(
                start=event.decoded("dtstart"),
                end=event.decoded("dtend"),
                label=str(event.get("summary", "Busy")),
            )
            if _overlaps(block, start, end):
                blocks.append(block)
        return blocks
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_calendar_provider.py -v`
Expected: PASS (5 passed — 3 mock + 2 ICS)

- [ ] **Step 6: Commit**

```bash
git add src/weekforge/providers/calendar.py tests/test_calendar_provider.py tests/fixtures/sample_calendar.ics
git commit -m "feat: add ICSCalendarProvider reading busy blocks from .ics"
```

---

## Task 5: Task provider (protocol + JSON)

**Files:**
- Create: `src/weekforge/providers/tasks.py`
- Create: `tests/fixtures/sample_tasks.json`
- Test: `tests/test_tasks_provider.py`

- [ ] **Step 1: Create the tasks fixture**

Create `tests/fixtures/sample_tasks.json`:

```json
[
  {
    "id": "t1",
    "title": "Draft quarterly report",
    "estimated_minutes": 180,
    "deadline": "2026-06-19T17:00:00+00:00",
    "priority": 1,
    "category": "writing"
  },
  {
    "id": "t2",
    "title": "Review two pull requests",
    "estimated_minutes": 60,
    "priority": 2,
    "category": "code",
    "depends_on": []
  },
  {
    "id": "t3",
    "title": "Reply to backlog emails",
    "estimated_minutes": 45,
    "category": "admin"
  }
]
```

- [ ] **Step 2: Write the failing tests**

Create `tests/test_tasks_provider.py`:

```python
from datetime import datetime, timezone
from pathlib import Path

from weekforge.providers.tasks import JSONTaskProvider

FIXTURE = Path(__file__).parent / "fixtures" / "sample_tasks.json"


def test_json_loads_all_tasks():
    provider = JSONTaskProvider(FIXTURE)

    tasks = provider.get_tasks()

    assert [t.id for t in tasks] == ["t1", "t2", "t3"]


def test_json_parses_fields_and_defaults():
    provider = JSONTaskProvider(FIXTURE)

    tasks = {t.id: t for t in provider.get_tasks()}

    assert tasks["t1"].deadline == datetime(2026, 6, 19, 17, 0, tzinfo=timezone.utc)
    assert tasks["t1"].priority == 1
    assert tasks["t1"].category == "writing"
    # t3 omits priority -> default 3, omits deadline -> None
    assert tasks["t3"].priority == 3
    assert tasks["t3"].deadline is None
    assert tasks["t3"].depends_on == []
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/test_tasks_provider.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'weekforge.providers.tasks'`

- [ ] **Step 4: Implement the task provider**

Create `src/weekforge/providers/tasks.py`:

```python
"""Task providers. Return the list of tasks the council must schedule."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol, runtime_checkable

from weekforge.models import Task


@runtime_checkable
class TaskProvider(Protocol):
    """A source of tasks to schedule."""

    def get_tasks(self) -> list[Task]:
        ...


class JSONTaskProvider:
    """Loads tasks from a JSON file containing a list of task objects."""

    def __init__(self, json_path: str | Path) -> None:
        self._path = Path(json_path)

    def get_tasks(self) -> list[Task]:
        raw = json.loads(self._path.read_text())
        return [Task(**item) for item in raw]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_tasks_provider.py -v`
Expected: PASS (2 passed)

- [ ] **Step 6: Run the full suite and commit**

Run: `uv run pytest -v`
Expected: PASS (14 passed total)

```bash
git add src/weekforge/providers/tasks.py tests/test_tasks_provider.py tests/fixtures/sample_tasks.json
git commit -m "feat: add TaskProvider protocol and JSONTaskProvider"
```

---

## Done criteria

- `uv run pytest -v` → 14 passing tests.
- `src/weekforge/models.py` exports `Task`, `TimeBlock`, `Preferences`, `Schedule`.
- `src/weekforge/providers/calendar.py` exports `CalendarProvider`, `MockCalendarProvider`, `ICSCalendarProvider`.
- `src/weekforge/providers/tasks.py` exports `TaskProvider`, `JSONTaskProvider`.
- These typed models and provider interfaces are the inputs the debate engine (next plan) consumes.
