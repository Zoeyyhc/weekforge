"""Pure semantic validation helpers for WeekForge debate blocks."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timezone
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


def classify_blocks(
    blocks: list[TimeBlock],
    tasks: list[Task],
    busy_blocks: list[TimeBlock],
    preferences: Preferences,
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

        day = local_start.date()
        block_local_day.append(day)
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
        if day in over_cap_days:
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
