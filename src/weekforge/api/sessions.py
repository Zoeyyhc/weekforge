"""In-memory session registry mapping thread_id → debate inputs + pending intervention.

The debate's full mutable state is persisted by the LangGraph SQLite checkpointer,
keyed by the same thread_id. This registry only holds the original request inputs and
a one-shot human intervention to be consumed by the next stream call.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4

from weekforge.api.schemas import StartDebateRequest


@dataclass
class Session:
    request: StartDebateRequest
    user_id: str
    intervention: str | None = None


class SessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def create(self, request: StartDebateRequest, user_id: str) -> str:
        thread_id = uuid4().hex
        self._sessions[thread_id] = Session(request=request, user_id=user_id)
        return thread_id

    def get(self, thread_id: str) -> Session | None:
        return self._sessions.get(thread_id)

    def set_intervention(self, thread_id: str, value: str) -> None:
        session = self._sessions.get(thread_id)
        if session is not None:
            session.intervention = value

    def pop_intervention(self, thread_id: str) -> str | None:
        """Return and clear any pending intervention (consumed once)."""
        session = self._sessions.get(thread_id)
        if session is None:
            return None
        value = session.intervention
        session.intervention = None
        return value
