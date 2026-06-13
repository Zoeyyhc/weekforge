"""Fixtures for API tests.

The convergence-check and validate nodes call the real Anthropic SDK, so streaming
tests patch `weekforge.debate.nodes.Anthropic` with a deterministic fake. The fake
answers the convergence check ("yes"/"no") based on a `converge` flag, and returns a
valid schedule JSON for the validate node (distinguished by max_tokens).
"""

from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from weekforge.api.app import create_app

VALID_SCHEDULE_JSON = (
    '[{"start": "2026-06-15T09:00:00+00:00", "end": "2026-06-15T10:00:00+00:00",'
    ' "label": "Write report", "task_id": "t1"}]'
)


class MockCouncil:
    """LLM-free council for API tests."""

    def propose(self, agent_name: str, context: str) -> str:
        return f"{agent_name} proposes a packed schedule."

    def critique(self, agent_name: str, context: str) -> str:
        return f"{agent_name} critiques the proposal."

    def arbitrate(self, context: str) -> str:
        return VALID_SCHEDULE_JSON


class _MockBlock:
    def __init__(self, text: str) -> None:
        self.text = text


class _MockResponse:
    def __init__(self, text: str) -> None:
        self.content = [_MockBlock(text)]


class _MockMessages:
    def __init__(self, converge: bool) -> None:
        self._converge = converge

    def create(self, **kwargs):
        # The convergence check uses a tiny max_tokens; validate uses a large one.
        if kwargs.get("max_tokens", 0) <= 16:
            return _MockResponse("yes" if self._converge else "no")
        return _MockResponse(VALID_SCHEDULE_JSON)


class _MockClient:
    def __init__(self, converge: bool) -> None:
        self.messages = _MockMessages(converge)


def _anthropic_factory(converge: bool):
    def _factory(*args, **kwargs):
        return _MockClient(converge)
    return _factory


@pytest.fixture
def client(tmp_path):
    app = create_app(
        council=MockCouncil(),
        api_key="test-key",
        db_path=str(tmp_path / "api_test.db"),
    )
    return TestClient(app)


@pytest.fixture
def anthropic_patch():
    """Returns a context manager: `with anthropic_patch(converge=True): ...`"""

    @contextmanager
    def _patch(converge: bool):
        with patch("weekforge.debate.nodes.Anthropic", _anthropic_factory(converge)):
            yield

    return _patch
