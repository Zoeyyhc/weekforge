"""Tests for LangGraph node functions using MockCouncil (no real LLM calls)."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from weekforge.debate.nodes import (
    finalize_node,
    make_arbitrate_node,
    make_critique_node,
    make_gather_proposals_node,
    make_validate_node,
    human_interrupt_node,
)
from weekforge.debate.state import DEBATER_NAMES, DebateEvent, DebateState
from weekforge.models import Preferences, Schedule, Task, TimeBlock


def _utc(y, m, d, h, mn=0):
    return datetime(y, m, d, h, mn, tzinfo=timezone.utc)


@pytest.fixture
def base_state(mock_council) -> DebateState:
    return DebateState(
        tasks=[Task(id="t1", title="Write report", estimated_minutes=120, priority=1)],
        busy_blocks=[TimeBlock(start=_utc(2026, 6, 15, 10), end=_utc(2026, 6, 15, 11), label="Standup")],
        preferences=Preferences(),
        max_rounds=3,
        round_number=0,
        proposals={},
        critiques={},
        converged=False,
        interrupt_reason=None,
        human_input=None,
        arbiter_output=None,
        validation_error=None,
        schedule=None,
        transcript=[],
    )


# ── gather_proposals ────────────────────────────────────────────────────────

def test_gather_proposals_increments_round(mock_council, base_state):
    node = make_gather_proposals_node(mock_council)
    result = node(base_state)
    assert result["round_number"] == 1


def test_gather_proposals_creates_proposal_for_each_debater(mock_council, base_state):
    node = make_gather_proposals_node(mock_council)
    result = node(base_state)
    assert set(result["proposals"].keys()) == set(DEBATER_NAMES)


def test_gather_proposals_adds_transcript_events(mock_council, base_state):
    node = make_gather_proposals_node(mock_council)
    result = node(base_state)
    assert len(result["transcript"]) == len(DEBATER_NAMES)
    assert all(e["event_type"] == "proposal" for e in result["transcript"])
    assert all(e["round"] == 1 for e in result["transcript"])


# ── critique ────────────────────────────────────────────────────────────────

def test_critique_creates_critique_for_each_debater(mock_council, base_state):
    state = {**base_state, "proposals": {n: "proposal text" for n in DEBATER_NAMES}, "round_number": 1}
    node = make_critique_node(mock_council)
    result = node(state)
    assert set(result["critiques"].keys()) == set(DEBATER_NAMES)


def test_critique_adds_transcript_events(mock_council, base_state):
    state = {**base_state, "proposals": {n: "proposal text" for n in DEBATER_NAMES}, "round_number": 1}
    node = make_critique_node(mock_council)
    result = node(state)
    assert len(result["transcript"]) == len(DEBATER_NAMES)
    assert all(e["event_type"] == "critique" for e in result["transcript"])


# ── arbitrate ───────────────────────────────────────────────────────────────

def test_arbitrate_calls_council_and_adds_transcript(mock_council, base_state):
    state = {
        **base_state,
        "proposals": {n: "proposal" for n in DEBATER_NAMES},
        "critiques": {n: "critique" for n in DEBATER_NAMES},
        "round_number": 1,
    }
    node = make_arbitrate_node(mock_council)
    result = node(state)
    assert result["arbiter_output"] is not None
    assert len(result["transcript"]) == 1
    assert result["transcript"][0]["speaker"] == "Arbiter"
    assert result["transcript"][0]["event_type"] == "arbitration"


def test_arbitrate_includes_human_input_when_present(mock_council, base_state):
    state = {
        **base_state,
        "proposals": {n: "p" for n in DEBATER_NAMES},
        "critiques": {n: "c" for n in DEBATER_NAMES},
        "round_number": 2,
        "human_input": "Please prioritise the report over emails.",
    }
    node = make_arbitrate_node(mock_council)
    result = node(state)
    assert result["arbiter_output"] is not None


# ── validate ────────────────────────────────────────────────────────────────

def test_validate_parses_valid_json_into_schedule(base_state, mock_api_key):
    valid_json_output = (
        '[{"start": "2026-06-15T09:00:00+00:00", "end": "2026-06-15T10:00:00+00:00",'
        ' "label": "Write report", "task_id": "t1"}]'
    )
    state = {**base_state, "arbiter_output": valid_json_output, "round_number": 1}

    with patch("weekforge.debate.nodes.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_response = MagicMock()
        mock_response.content[0].text = valid_json_output
        mock_client.messages.create.return_value = mock_response

        node = make_validate_node(mock_api_key)
        result = node(state)

    assert result["schedule"] is not None
    assert isinstance(result["schedule"], Schedule)
    assert len(result["schedule"].blocks) == 1
    assert result["schedule"].blocks[0].label == "Write report"
    assert result["validation_error"] is None


def test_validate_sets_error_on_invalid_json(base_state, mock_api_key):
    state = {**base_state, "arbiter_output": "not json at all", "round_number": 1}

    with patch("weekforge.debate.nodes.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_response = MagicMock()
        mock_response.content[0].text = "this is not valid json {"
        mock_client.messages.create.return_value = mock_response

        node = make_validate_node(mock_api_key)
        result = node(state)

    assert result["schedule"] is None
    assert result["validation_error"] is not None
    assert len(result["transcript"]) == 1
    assert result["transcript"][0]["event_type"] == "validation_fail"


# ── finalize ────────────────────────────────────────────────────────────────

def test_finalize_returns_schedule_unchanged(base_state):
    block = TimeBlock(start=_utc(2026, 6, 15, 9), end=_utc(2026, 6, 15, 10), label="Work")
    schedule = Schedule(blocks=[block])
    state = {**base_state, "schedule": schedule}
    result = finalize_node(state)
    assert result["schedule"] is schedule


def test_fmt_tasks_includes_preferred_days_and_deadline(base_state):
    from weekforge.debate.nodes import _fmt_tasks

    state = {
        **base_state,
        "tasks": [
            Task(
                id="t1",
                title="Review PRs",
                estimated_minutes=90,
                priority=2,
                deadline=datetime(2026, 6, 18, 23, 59, tzinfo=timezone.utc),
                preferred_days=["Wed", "Fri"],
            )
        ],
    }
    result = _fmt_tasks(state)
    assert "deadline" in result
    assert "Thu" in result        # Jun 18 2026 is a Thursday
    assert "prefer" in result
    assert "Wed" in result
    assert "Fri" in result
