"""Pure semantic validation helpers for WeekForge debate blocks."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from weekforge.models import Preferences, Task, TimeBlock


@dataclass
class BlockReport:
    """Per-block validation result."""

    block: TimeBlock
    errors: list[str] = field(default_factory=list)
    day_reasons: list[str] = field(default_factory=list)

    @property
    def frozen(self) -> bool:
        """A block is freezable only if it has no own violations and is not on an over-cap day."""
        return not self.errors and not self.day_reasons


@dataclass
class ValidationReport:
    reports: list[BlockReport]
    day_errors: list[str]

    @property
    def ok(self) -> bool:
        return not self.day_errors and all(r.frozen for r in self.reports)

    @property
    def frozen(self) -> list[TimeBlock]:
        return [r.block for r in self.reports if r.frozen]

    @property
    def to_fix(self) -> list[BlockReport]:
        return [r for r in self.reports if not r.frozen]


def _tz(preferences: Preferences):
    return ZoneInfo(preferences.timezone) if preferences.timezone else timezone.utc


def _localize(value: str, preferences: Preferences) -> datetime:
    """Parse a wall-clock ISO string and attach the DST-correct local offset.

    Any offset the model emitted is discarded — the wall-clock components are
    authoritative and `ZoneInfo` supplies the right offset for that date.
    """
    dt = datetime.fromisoformat(value)
    return dt.replace(tzinfo=None).replace(tzinfo=_tz(preferences))


def classify_blocks(
    blocks: list[TimeBlock],
    tasks: list[Task],
    busy_blocks: list[TimeBlock],
    preferences: Preferences,
    window: tuple[datetime, datetime] | None = None,
) -> ValidationReport:
    """Classify each block as valid (freezable) or broken, with reasons."""
    tz = _tz(preferences)
    known_ids = {t.id for t in tasks}
    reports = [BlockReport(block=b) for b in blocks]
    minutes_per_day: dict[date, int] = {}
    block_local_day: list[date] = []

    for rep in reports:
        block = rep.block
        local_start = block.start.astimezone(tz)
        local_end = block.end.astimezone(tz)

        # Rule 1: task_id must be known or None
        if block.task_id is not None and block.task_id not in known_ids:
            rep.errors.append(f"Block '{block.label}': unknown task_id '{block.task_id}'")

        day = local_start.date()
        block_local_day.append(day)

        # Rules 2/3/5/6 and the daily-cap count police FOCUS blocks only. Fixed
        # commitments and soft buffers (task_id is None) may sit outside the work
        # window, exceed the per-block cap, and overlap each other.
        if block.task_id is None:
            continue

        # Rule 2: one local day + inside the work window
        cross_day = local_start.date() != local_end.date()
        if cross_day:
            rep.errors.append(
                f"Block '{block.label}': spans midnight "
                f"(starts {local_start.strftime('%a %d %b')}, "
                f"ends {local_end.strftime('%a %d %b')}); "
                f"focus blocks must stay within one day"
            )
        else:
            if local_start.hour + local_start.minute / 60 < preferences.workday_start_hour:
                rep.errors.append(
                    f"Block '{block.label}': starts {local_start.strftime('%H:%M')} local, "
                    f"before work window {preferences.workday_start_hour:02d}:00"
                )
            if preferences.workday_end_hour < 24:
                if local_end.hour + local_end.minute / 60 > preferences.workday_end_hour:
                    rep.errors.append(
                        f"Block '{block.label}': ends {local_end.strftime('%H:%M')} local, "
                        f"after work window {preferences.workday_end_hour:02d}:00"
                    )

        # Rule 3: no overlap with busy blocks
        for busy in busy_blocks:
            if block.start < busy.end and block.end > busy.start:
                busy_local = busy.start.astimezone(tz)
                busy_local_end = busy.end.astimezone(tz)
                rep.errors.append(
                    f"Block '{block.label}': overlaps with busy '{busy.label}' "
                    f"({busy_local.strftime('%H:%M')}–{busy_local_end.strftime('%H:%M')} local)"
                )

        # Rule 5: block must fall inside the schedulable week window
        if window is not None:
            window_start, window_end = window
            if block.start < window_start or block.end > window_end:
                ws = window_start.astimezone(tz)
                we = window_end.astimezone(tz)
                rep.errors.append(
                    f"Block '{block.label}': outside the schedulable week "
                    f"({ws.strftime('%a %d %b %H:%M')}–{we.strftime('%a %d %b %H:%M')} local)"
                )

        # Rule 6: single block must not exceed the per-block focus cap
        if block.duration_minutes > preferences.max_focus_minutes_per_block:
            rep.errors.append(
                f"Block '{block.label}': {block.duration_minutes}min exceeds "
                f"{preferences.max_focus_minutes_per_block}min single-focus cap"
            )

        minutes_per_day[day] = minutes_per_day.get(day, 0) + block.duration_minutes

    # Rule 4: daily focus cap (day-level)
    day_errors: list[str] = []
    over_cap_days: set[date] = set()
    for day, total in minutes_per_day.items():
        if total > preferences.max_focus_minutes_per_day:
            over_cap_days.add(day)
            day_errors.append(
                f"{day.strftime('%a %d %b')}: {total}min scheduled, "
                f"exceeds {preferences.max_focus_minutes_per_day}min/day limit"
            )

    for rep, day in zip(reports, block_local_day):
        if rep.block.task_id is not None and day in over_cap_days:
            rep.day_reasons.append(
                f"{day.strftime('%a %d %b')} is over the "
                f"{preferences.max_focus_minutes_per_day}min focus cap"
            )

    return ValidationReport(reports=reports, day_errors=day_errors)


def validate_blocks(
    blocks: list[TimeBlock],
    tasks: list[Task],
    busy_blocks: list[TimeBlock],
    preferences: Preferences,
) -> list[str]:
    """Flat list of every semantic error (back-compat wrapper over classify_blocks)."""
    report = classify_blocks(blocks, tasks, busy_blocks, preferences)
    errors: list[str] = []
    for rep in report.reports:
        errors.extend(rep.errors)
    errors.extend(report.day_errors)
    return errors


def block_plan(estimated_minutes: int, cap: int) -> list[int]:
    """Per-task focus-block durations: each <= cap, summing to the estimate, as
    even as possible. Returns [estimated_minutes] when it already fits in one block.

    Code owns the split count and durations; the council only chooses start times.
    """
    if estimated_minutes <= cap:
        return [estimated_minutes]
    n = math.ceil(estimated_minutes / cap)
    base = estimated_minutes // n
    remainder = estimated_minutes % n
    return [base + 1 if i < remainder else base for i in range(n)]


def underscheduled_tasks(
    blocks: list[TimeBlock],
    tasks: list[Task],
) -> dict[str, tuple[int, int]]:
    """Per task_id: (scheduled_minutes, estimated_minutes) where scheduled < estimated.

    Used for a non-blocking warning: splitting an over-long task can silently
    drop work, so we surface any task whose scheduled minutes fall short.
    """
    scheduled: dict[str, int] = {}
    for b in blocks:
        if b.task_id is not None:
            scheduled[b.task_id] = scheduled.get(b.task_id, 0) + b.duration_minutes
    short: dict[str, tuple[int, int]] = {}
    for t in tasks:
        got = scheduled.get(t.id, 0)
        if got < t.estimated_minutes:
            short[t.id] = (got, t.estimated_minutes)
    return short


def remaining_focus_budget(
    frozen_blocks: list[TimeBlock],
    preferences: Preferences,
) -> dict[date, int]:
    """Per local day: focus-cap minus minutes already consumed by the frozen blocks."""
    tz = _tz(preferences)
    used: dict[date, int] = {}
    for b in frozen_blocks:
        day = b.start.astimezone(tz).date()
        used[day] = used.get(day, 0) + b.duration_minutes
    return {day: preferences.max_focus_minutes_per_day - mins for day, mins in used.items()}


def compute_week_window(
    week_start: str | None,
    preferences: Preferences,
    now: datetime,
) -> tuple[datetime, datetime]:
    """Return (window_start, window_end) tz-aware datetimes for the schedulable window.

    The picked week is [Monday, Sunday]; the lower bound is clamped so we never
    schedule in the past. `now` is injected for testability.
    """
    tz = _tz(preferences)
    now_local = now.astimezone(tz)
    today = now_local.date()
    today_usable = now_local.hour + now_local.minute / 60 < preferences.workday_end_hour
    earliest_day = today if today_usable else today + timedelta(days=1)

    if week_start:
        picked_monday = date.fromisoformat(week_start)
    else:
        picked_monday = today - timedelta(days=today.weekday())  # Monday of current week
    picked_sunday = picked_monday + timedelta(days=6)

    window_start_day = max(picked_monday, earliest_day)
    start_t = time(hour=preferences.workday_start_hour)
    end_t = time(hour=23, minute=59) if preferences.workday_end_hour >= 24 else time(hour=preferences.workday_end_hour)

    window_start = datetime.combine(window_start_day, start_t, tzinfo=tz)
    window_end = datetime.combine(picked_sunday, end_t, tzinfo=tz)
    return window_start, window_end
