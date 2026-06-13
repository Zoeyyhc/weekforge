"""Request/response models for the WeekForge API."""

from __future__ import annotations

from pydantic import BaseModel, Field

from weekforge.models import Preferences, Task, TimeBlock


class StartDebateRequest(BaseModel):
    """Body for POST /debate — everything the council needs to plan a week."""

    tasks: list[Task]
    busy_blocks: list[TimeBlock] = Field(default_factory=list)
    preferences: Preferences = Field(default_factory=Preferences)
    max_rounds: int = Field(default=3, ge=1, le=10)


class StartDebateResponse(BaseModel):
    """Returned by POST /debate — the thread to stream and intervene on."""

    thread_id: str


class InterventionRequest(BaseModel):
    """Body for POST /debate/{thread_id}/intervene — the human's arbitration."""

    input: str
