"""Domain models for WeekForge. Pure data, no I/O."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

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
    preferred_days: list[Literal["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]] | None = None
    remark: str | None = None  # planner's note to the council


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
    max_focus_minutes_per_block: int = Field(default=90, gt=0)
    timezone: str | None = None

    @model_validator(mode="after")
    def _end_after_start(self) -> Preferences:
        if self.workday_end_hour <= self.workday_start_hour:
            raise ValueError("workday_end_hour must be after workday_start_hour")
        # A per-block cap above the daily cap is meaningless (the daily cap already
        # dominates), so clamp it down rather than reject. This keeps loading legacy
        # preferences — saved before this field existed, with a daily cap below the
        # default 90 — robust instead of crashing. The frontend validates user input.
        if self.max_focus_minutes_per_block > self.max_focus_minutes_per_day:
            self.max_focus_minutes_per_block = self.max_focus_minutes_per_day
        return self


class Schedule(BaseModel):
    """The council's output: a set of time blocks for the week."""

    week_start: datetime | None = None
    blocks: list[TimeBlock] = Field(default_factory=list)
