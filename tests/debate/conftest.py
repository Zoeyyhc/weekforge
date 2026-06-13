"""Shared fixtures for debate engine tests."""

from __future__ import annotations

import pytest

from weekforge.debate.state import DEBATER_NAMES

MOCK_API_KEY = "test-api-key-not-real"


class MockCouncil:
    """Deterministic, LLM-free Council for unit tests."""

    def propose(self, agent_name: str, context: str) -> str:
        return f"{agent_name} proposes: Schedule all tasks sequentially starting Monday 9am."

    def critique(self, agent_name: str, context: str) -> str:
        return f"{agent_name} critiques: The proposal ignores my primary objective."

    def arbitrate(self, context: str) -> str:
        return (
            '[{"start": "2026-06-15T09:00:00+00:00", "end": "2026-06-15T10:00:00+00:00",'
            ' "label": "Task t1", "task_id": "t1"}]'
        )


@pytest.fixture
def mock_council():
    return MockCouncil()


@pytest.fixture
def mock_api_key():
    return MOCK_API_KEY
