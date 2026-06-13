"""Tests for the run_debate() streaming runner."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from weekforge.debate.runner import DebateResult, run_debate
from weekforge.models import Preferences, Schedule, Task, TimeBlock


def _utc(y, m, d, h, mn=0):
    return datetime(y, m, d, h, mn, tzinfo=timezone.utc)


@pytest.fixture
def sample_tasks():
    return [Task(id="t1", title="Write report", estimated_minutes=120, priority=1)]


@pytest.fixture
def sample_busy():
    return [TimeBlock(start=_utc(2026, 6, 15, 10), end=_utc(2026, 6, 15, 11), label="Standup")]


@pytest.fixture
def sample_prefs():
    return Preferences()


def test_run_debate_yields_debate_events(mock_council, mock_api_key, sample_tasks, sample_busy, sample_prefs):
    """run_debate should yield dicts with 'type' key from the transcript."""
    final_schedule = Schedule()

    with patch("weekforge.debate.runner.build_graph") as mock_build:
        mock_graph = MagicMock()
        mock_build.return_value = mock_graph

        mock_graph.stream.return_value = iter([
            {"gather_proposals": {
                "transcript": [
                    {"round": 1, "speaker": "DeadlineHawk", "content": "Pack it!", "event_type": "proposal"}
                ],
                "round_number": 1,
            }},
            {"finalize": {
                "schedule": final_schedule,
                "transcript": [],
            }},
        ])

        events = list(run_debate(
            tasks=sample_tasks,
            busy_blocks=sample_busy,
            preferences=sample_prefs,
            thread_id="test-thread-1",
            api_key=mock_api_key,
            council=mock_council,
        ))

    assert len(events) >= 1
    debate_events = [e for e in events if e["type"] == "debate_event"]
    assert len(debate_events) >= 1
    assert debate_events[0]["speaker"] == "DeadlineHawk"


def test_run_debate_yields_done_event_with_schedule(mock_council, mock_api_key, sample_tasks, sample_busy, sample_prefs):
    """run_debate must yield a final 'done' event carrying the Schedule."""
    final_schedule = Schedule()

    with patch("weekforge.debate.runner.build_graph") as mock_build:
        mock_graph = MagicMock()
        mock_build.return_value = mock_graph
        mock_graph.stream.return_value = iter([
            {"finalize": {"schedule": final_schedule, "transcript": []}},
        ])

        events = list(run_debate(
            tasks=sample_tasks,
            busy_blocks=sample_busy,
            preferences=sample_prefs,
            thread_id="test-thread-2",
            api_key=mock_api_key,
            council=mock_council,
        ))

    done_events = [e for e in events if e["type"] == "done"]
    assert len(done_events) == 1
    assert done_events[0]["schedule"] is final_schedule


def test_run_debate_yields_interrupt_event_when_graph_pauses(mock_council, mock_api_key, sample_tasks, sample_busy, sample_prefs):
    """When the graph hits human_interrupt, run_debate yields an 'interrupt' event."""
    from langgraph.types import Interrupt

    with patch("weekforge.debate.runner.build_graph") as mock_build:
        mock_graph = MagicMock()
        mock_build.return_value = mock_graph
        mock_graph.stream.return_value = iter([
            {"__interrupt__": (Interrupt(value={"type": "needs_human_input", "interrupt_reason": "Stalled"}),)},
        ])

        events = list(run_debate(
            tasks=sample_tasks,
            busy_blocks=sample_busy,
            preferences=sample_prefs,
            thread_id="test-thread-3",
            api_key=mock_api_key,
            council=mock_council,
        ))

    interrupt_events = [e for e in events if e["type"] == "interrupt"]
    assert len(interrupt_events) == 1
    assert interrupt_events[0]["interrupt_reason"] == "Stalled"


def test_debate_result_shape():
    result: DebateResult = {
        "thread_id": "abc",
        "schedule": Schedule(),
        "transcript": [],
    }
    assert result["thread_id"] == "abc"


def test_run_debate_resume_passes_command(mock_council, mock_api_key, sample_tasks, sample_busy, sample_prefs):
    """When resume_value is given, the graph is streamed a Command(resume=...) not the initial state."""
    from langgraph.types import Command

    with patch("weekforge.debate.runner.build_graph") as mock_build:
        mock_graph = MagicMock()
        mock_build.return_value = mock_graph
        mock_graph.stream.return_value = iter([
            {"finalize": {"schedule": Schedule(), "transcript": []}},
        ])

        list(run_debate(
            tasks=sample_tasks,
            busy_blocks=sample_busy,
            preferences=sample_prefs,
            thread_id="resume-thread",
            api_key=mock_api_key,
            council=mock_council,
            resume_value="Prioritise the report.",
        ))

        stream_arg = mock_graph.stream.call_args.args[0]
        assert isinstance(stream_arg, Command)
        assert stream_arg.resume == "Prioritise the report."


def test_run_debate_suppresses_done_after_interrupt(mock_council, mock_api_key, sample_tasks, sample_busy, sample_prefs):
    """A run that pauses at an interrupt must NOT also yield a 'done' event."""
    from langgraph.types import Interrupt

    with patch("weekforge.debate.runner.build_graph") as mock_build:
        mock_graph = MagicMock()
        mock_build.return_value = mock_graph
        mock_graph.stream.return_value = iter([
            {"__interrupt__": (Interrupt(value={"interrupt_reason": "Stalled", "proposals": {}}),)},
        ])

        events = list(run_debate(
            tasks=sample_tasks,
            busy_blocks=sample_busy,
            preferences=sample_prefs,
            thread_id="interrupt-thread",
            api_key=mock_api_key,
            council=mock_council,
        ))

    assert any(e["type"] == "interrupt" for e in events)
    assert not any(e["type"] == "done" for e in events)
