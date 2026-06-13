import pytest
from pydantic import ValidationError

from weekforge.api.schemas import (
    InterventionRequest,
    StartDebateRequest,
    StartDebateResponse,
)


def test_start_request_parses_full_body():
    body = {
        "tasks": [{"id": "t1", "title": "Write report", "estimated_minutes": 120, "priority": 1}],
        "busy_blocks": [
            {"start": "2026-06-15T10:00:00+00:00", "end": "2026-06-15T11:00:00+00:00", "label": "Standup"}
        ],
        "preferences": {"workday_start_hour": 9, "workday_end_hour": 18, "max_focus_minutes_per_day": 360},
        "max_rounds": 3,
    }
    req = StartDebateRequest(**body)
    assert req.tasks[0].id == "t1"
    assert req.busy_blocks[0].label == "Standup"
    assert req.preferences.workday_start_hour == 9
    assert req.max_rounds == 3


def test_start_request_applies_defaults():
    req = StartDebateRequest(tasks=[{"id": "t1", "title": "X", "estimated_minutes": 30}])
    assert req.busy_blocks == []
    assert req.preferences.workday_start_hour == 9   # Preferences default
    assert req.max_rounds == 3


def test_start_request_requires_tasks():
    with pytest.raises(ValidationError):
        StartDebateRequest()


def test_start_response_shape():
    resp = StartDebateResponse(thread_id="abc123")
    assert resp.thread_id == "abc123"


def test_intervention_request_requires_input():
    req = InterventionRequest(input="Prioritise the report")
    assert req.input == "Prioritise the report"
    with pytest.raises(ValidationError):
        InterventionRequest()
