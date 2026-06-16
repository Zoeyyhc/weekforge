import operator
from datetime import datetime, timezone

from weekforge.debate.state import DEBATER_NAMES, DebateEvent, DebateState
from weekforge.models import Preferences, Schedule, Task, TimeBlock


def _utc(y, m, d, h, mn=0):
    return datetime(y, m, d, h, mn, tzinfo=timezone.utc)


def _make_task(tid: str) -> Task:
    return Task(id=tid, title=f"Task {tid}", estimated_minutes=60)


def test_debater_names_are_three_strings():
    assert len(DEBATER_NAMES) == 3
    assert all(isinstance(n, str) for n in DEBATER_NAMES)
    assert "DeadlineHawk" in DEBATER_NAMES
    assert "EnergyGuardian" in DEBATER_NAMES
    assert "FocusBatcher" in DEBATER_NAMES


def test_debate_event_is_typed_dict():
    event: DebateEvent = {
        "round": 1,
        "speaker": "DeadlineHawk",
        "content": "I propose packing the schedule.",
        "event_type": "proposal",
    }
    assert event["round"] == 1
    assert event["speaker"] == "DeadlineHawk"


def test_transcript_reducer_appends():
    existing = [{"round": 1, "speaker": "A", "content": "x", "event_type": "proposal"}]
    new_events = [{"round": 1, "speaker": "B", "content": "y", "event_type": "critique"}]
    result = operator.add(existing, new_events)
    assert len(result) == 2
    assert result[0]["speaker"] == "A"
    assert result[1]["speaker"] == "B"


def test_debate_state_shape():
    import typing
    hints = typing.get_type_hints(DebateState)
    required_keys = {
        "tasks", "busy_blocks", "preferences", "max_rounds",
        "round_number", "proposals", "critiques", "converged",
        "interrupt_reason", "human_input", "arbiter_output",
        "validation_error", "schedule", "transcript",
        "validation_attempts", "max_validation_attempts", "best_effort_schedule",
    }
    assert required_keys.issubset(hints.keys()), f"Missing keys: {required_keys - hints.keys()}"
