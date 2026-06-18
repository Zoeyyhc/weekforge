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
from weekforge.auth.tokens import issue_token

VALID_SCHEDULE_JSON = (
    '[{"start": "2026-06-15T09:00:00+00:00", "end": "2026-06-15T10:00:00+00:00",'
    ' "label": "Write report", "task_id": "t1"}]'
)
TEST_AUTH_SECRET = "test-secret-key-with-32-bytes!!!"


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
def app(tmp_path):
    return create_app(
        council=MockCouncil(),
        api_key="test-key",
        db_path=str(tmp_path / "api_test.db"),
        auth_secret=TEST_AUTH_SECRET,
    )


@pytest.fixture(autouse=True)
def auth_secret_env(monkeypatch):
    monkeypatch.setenv("WEEKFORGE_AUTH_SECRET", TEST_AUTH_SECRET)


@pytest.fixture
def token(app):
    c = TestClient(app)
    resp = c.post(
        "/auth/signup",
        json={"email": "test@b.com", "password": "pw", "display_name": "Tester"},
    )
    assert resp.status_code == 200
    return resp.json()["token"]


@pytest.fixture
def unknown_user_token():
    return issue_token("missing-user-id", TEST_AUTH_SECRET)


@pytest.fixture
def client(app, token):
    c = TestClient(app)
    c.headers.update({"Authorization": f"Bearer {token}"})
    return c


@pytest.fixture
def anon_client(app):
    return TestClient(app)


@pytest.fixture
def anthropic_patch():
    """Returns a context manager: `with anthropic_patch(converge=True): ...`"""

    @contextmanager
    def _patch(converge: bool):
        with patch("weekforge.debate.nodes.Anthropic", _anthropic_factory(converge)):
            yield

    return _patch
