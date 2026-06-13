"""LangGraph state types for the WeekForge debate engine."""

from __future__ import annotations

import operator
from typing import Annotated, TypedDict

from weekforge.models import Preferences, Schedule, Task, TimeBlock

DEBATER_NAMES: tuple[str, ...] = ("DeadlineHawk", "EnergyGuardian", "FocusBatcher")


class DebateEvent(TypedDict):
    """A single entry in the visible debate transcript."""

    round: int
    speaker: str       # "DeadlineHawk" | "EnergyGuardian" | "FocusBatcher" | "Arbiter" | "Human" | "System"
    content: str
    event_type: str    # "proposal" | "critique" | "arbitration" | "human_intervention" | "validation_fail" | "system"


class DebateState(TypedDict):
    """Full mutable state flowing through the LangGraph debate graph."""

    # ── Inputs (set once at graph entry) ──────────────────────────────────
    tasks: list[Task]
    busy_blocks: list[TimeBlock]
    preferences: Preferences
    max_rounds: int

    # ── Round tracking ─────────────────────────────────────────────────────
    round_number: int           # incremented by gather_proposals_node

    # ── Per-round positions (replaced each round, not appended) ────────────
    proposals: dict[str, str]   # agent_name -> proposal text
    critiques: dict[str, str]   # agent_name -> critique text

    # ── Convergence / interrupt ────────────────────────────────────────────
    converged: bool
    interrupt_reason: str | None   # non-None triggers human_interrupt routing
    human_input: str | None        # set by human_interrupt_node after resume

    # ── Arbitration & output ───────────────────────────────────────────────
    arbiter_output: str | None     # raw text from Arbiter's synthesis
    validation_error: str | None   # non-None if schedule parsing failed
    schedule: Schedule | None      # structured output; set by validate_node

    # ── Append-only transcript (operator.add merges by concatenation) ──────
    transcript: Annotated[list[DebateEvent], operator.add]
