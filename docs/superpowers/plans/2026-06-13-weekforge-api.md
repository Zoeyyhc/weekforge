# WeekForge API (FastAPI + SSE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the debate engine over HTTP — start a debate, stream the deliberation live via Server-Sent Events (SSE), and let the user intervene (human-in-the-loop) so the council resumes from the checkpoint with their input.

**Architecture:** A FastAPI app wraps the existing `run_debate()` generator. A `SessionManager` holds per-`thread_id` inputs and any pending human intervention. `POST /debate` stashes inputs and returns a `thread_id`; `GET /debate/{thread_id}/stream` runs the graph and emits each `DebateEvent` as an SSE frame; `POST /debate/{thread_id}/intervene` records the user's arbitration so the next stream call resumes the interrupted graph via LangGraph's `Command(resume=...)`. The graph's SQLite checkpointer (file-backed) is what makes resume-across-requests work.

**Tech Stack:** `fastapi`, `uvicorn[standard]`, `httpx` (test client), existing `langgraph` + `crewai` + `anthropic`, `pytest`.

---

## File Structure

```
src/weekforge/
├── debate/
│   └── runner.py          — MODIFY: add resume_value param + suppress "done" after interrupt
└── api/
    ├── __init__.py        — re-export create_app
    ├── schemas.py         — StartDebateRequest, StartDebateResponse, InterventionRequest
    ├── sse.py             — format_sse(event) → SSE frame string
    ├── sessions.py        — Session dataclass + SessionManager (in-memory)
    ├── routes.py          — create_router(council, api_key, db_path, sessions) → APIRouter
    ├── app.py             — create_app(council, api_key, db_path, allow_origins) → FastAPI
    └── server.py          — main() uvicorn entrypoint (reads ANTHROPIC_API_KEY)

tests/api/
├── __init__.py            — empty package marker
├── conftest.py            — MockCouncil, client fixture, anthropic_patch fixture, VALID_SCHEDULE_JSON
├── test_schemas.py        — request/response model validation
├── test_sse.py            — SSE frame formatting incl. Schedule serialization
├── test_sessions.py       — SessionManager lifecycle
└── test_routes.py         — TestClient: health, start, stream, intervene, full HITL cycle
```

**Key design decisions locked in here:**
- **SSE must be a `GET`** (browsers' `EventSource` only does GET), and the inputs (task list) are too large for query params → so we split into `POST /debate` (stash inputs, return id) then `GET .../stream`.
- **Resume across HTTP requests** works because the checkpointer writes to a real SQLite *file* (`db_path`), keyed by `thread_id`. A fresh graph built on the second request finds the saved checkpoint.
- **Dependency injection, no globals:** `create_app(council=..., api_key=..., db_path=...)` so tests inject a `MockCouncil` and a temp DB file. The convergence-check and validate nodes call the real Anthropic SDK, so tests patch `weekforge.debate.nodes.Anthropic`.
- **`run_debate` gains `resume_value`** and stops emitting a misleading `done` event when the graph pauses for human input.

---

## Task 1: Make the runner HITL-complete (resume + correct interrupt termination)

The API's intervene→resume flow needs two runner changes: (a) accept a `resume_value` that drives `Command(resume=...)`, and (b) NOT emit a `done` event when the run pauses at an interrupt (the debate isn't finished — it's waiting for the human).

**Files:**
- Modify: `src/weekforge/debate/runner.py`
- Test: `tests/debate/test_runner.py` (add two tests)

- [ ] **Step 1: Add the two failing tests**

Append these to `tests/debate/test_runner.py`:

```python
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
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `uv run pytest tests/debate/test_runner.py::test_run_debate_resume_passes_command tests/debate/test_runner.py::test_run_debate_suppresses_done_after_interrupt -v`
Expected: FAIL — `run_debate()` has no `resume_value` parameter (TypeError) and currently always yields a `done` event.

- [ ] **Step 3: Modify `run_debate`**

Replace the entire body of `src/weekforge/debate/runner.py` with:

```python
"""High-level streaming interface for the WeekForge debate engine."""

from __future__ import annotations

from typing import Any, Generator, TypedDict

from langgraph.types import Command

from weekforge.debate.debaters import Council
from weekforge.debate.graph import build_graph
from weekforge.debate.state import DebateState
from weekforge.models import Preferences, Schedule, Task, TimeBlock


class DebateResult(TypedDict):
    thread_id: str
    schedule: Schedule | None
    transcript: list[dict]


def run_debate(
    tasks: list[Task],
    busy_blocks: list[TimeBlock],
    preferences: Preferences,
    thread_id: str,
    api_key: str,
    council: Council,
    max_rounds: int = 3,
    db_path: str = "weekforge.db",
    resume_value: str | None = None,
) -> Generator[dict[str, Any], None, None]:
    """Stream debate events as the council deliberates.

    Yields dicts with a 'type' key:
      - {"type": "debate_event", "round": int, "speaker": str, "content": str, "event_type": str}
      - {"type": "interrupt", "interrupt_reason": str, "proposals": dict, "thread_id": str}
      - {"type": "done", "schedule": Schedule | None, "thread_id": str}

    A 'done' event is emitted only when the run completes. If the run pauses for
    human input, the final event is the 'interrupt' (no 'done').

    Args:
        resume_value: When provided, resume an interrupted run for this thread_id by
            handing the value to the paused human_interrupt node. The graph reloads its
            saved state from the checkpointer, so tasks/busy_blocks/preferences are ignored.
    """
    graph = build_graph(council=council, api_key=api_key, db_path=db_path)

    config = {"configurable": {"thread_id": thread_id}}

    if resume_value is not None:
        stream_input: Any = Command(resume=resume_value)
    else:
        stream_input = DebateState(
            tasks=tasks,
            busy_blocks=busy_blocks,
            preferences=preferences,
            max_rounds=max_rounds,
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

    final_schedule: Schedule | None = None
    interrupted = False

    for chunk in graph.stream(stream_input, config=config, stream_mode="updates"):
        # Handle LangGraph interrupt
        if "__interrupt__" in chunk:
            interrupts = chunk["__interrupt__"]
            if interrupts:
                interrupt_value = interrupts[0].value
                interrupted = True
                yield {
                    "type": "interrupt",
                    "interrupt_reason": interrupt_value.get("interrupt_reason", "Human input needed."),
                    "proposals": interrupt_value.get("proposals", {}),
                    "thread_id": thread_id,
                }
            continue

        # Stream transcript events from any node update
        for node_name, node_output in chunk.items():
            if not isinstance(node_output, dict):
                continue
            for event in node_output.get("transcript", []):
                yield {
                    "type": "debate_event",
                    "round": event["round"],
                    "speaker": event["speaker"],
                    "content": event["content"],
                    "event_type": event["event_type"],
                }
            if "schedule" in node_output and node_output["schedule"] is not None:
                final_schedule = node_output["schedule"]

    if not interrupted:
        yield {"type": "done", "schedule": final_schedule, "thread_id": thread_id}
```

- [ ] **Step 4: Run the runner tests**

Run: `uv run pytest tests/debate/test_runner.py -v`
Expected: PASS (6 tests: 4 original + 2 new).

- [ ] **Step 5: Run full suite (no regressions)**

Run: `uv run pytest -v`
Expected: 48 passed (was 46 + 2 new), 0 failed.

- [ ] **Step 6: Commit**

```bash
cd /Users/Najum/weekforge && git add src/weekforge/debate/runner.py tests/debate/test_runner.py && git commit -m "feat: add resume_value to run_debate and suppress done after interrupt"
```

---

## Task 2: Add API dependencies

**Files:**
- Modify: `pyproject.toml`

- [ ] **Step 1: Edit dependencies**

Replace the `[project]` and `[dependency-groups]` sections of `pyproject.toml` with:

```toml
[project]
name = "weekforge"
version = "0.1.0"
description = "WeekForge (Crucible) — a transparent multi-agent decision council."
requires-python = ">=3.12"
dependencies = [
    "pydantic>=2.7",
    "icalendar>=5.0",
    "langgraph>=0.2",
    "langgraph-checkpoint-sqlite>=2.0",
    "crewai>=0.80",
    "anthropic>=0.40",
    "fastapi>=0.110",
    "uvicorn[standard]>=0.27",
]

[dependency-groups]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24",
    "httpx>=0.27",
]
```

Leave `[build-system]`, `[tool.hatch.build.targets.wheel]`, and `[tool.pytest.ini_options]` unchanged.

- [ ] **Step 2: Install**

Run: `cd /Users/Najum/weekforge && uv sync`
Expected: resolves and installs fastapi, uvicorn, httpx.

- [ ] **Step 3: Verify imports**

Run: `cd /Users/Najum/weekforge && uv run python -c "import fastapi; from fastapi.testclient import TestClient; import uvicorn; print('OK')"`
Expected: prints `OK`

- [ ] **Step 4: Verify no regressions**

Run: `cd /Users/Najum/weekforge && uv run pytest -v`
Expected: 48 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
cd /Users/Najum/weekforge && git add pyproject.toml uv.lock && git commit -m "chore: add fastapi, uvicorn, httpx for the API layer"
```

---

## Task 3: Request/response schemas + SSE formatting

**Files:**
- Create: `src/weekforge/api/__init__.py`
- Create: `src/weekforge/api/schemas.py`
- Create: `src/weekforge/api/sse.py`
- Create: `tests/api/__init__.py`
- Test: `tests/api/test_schemas.py`, `tests/api/test_sse.py`

- [ ] **Step 1: Write failing tests**

Create `tests/api/__init__.py` (empty).

Create `tests/api/test_schemas.py`:

```python
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
```

Create `tests/api/test_sse.py`:

```python
import json

from weekforge.api.sse import format_sse
from weekforge.models import Schedule, TimeBlock
from datetime import datetime, timezone


def _utc(y, m, d, h):
    return datetime(y, m, d, h, tzinfo=timezone.utc)


def test_format_sse_includes_event_and_data_lines():
    frame = format_sse({"type": "debate_event", "speaker": "DeadlineHawk", "content": "Pack it!"})
    assert frame.startswith("event: debate_event\n")
    assert "\ndata: " in frame
    assert frame.endswith("\n\n")


def test_format_sse_data_is_valid_json():
    frame = format_sse({"type": "debate_event", "round": 1, "speaker": "A", "content": "hi"})
    data_line = [l for l in frame.splitlines() if l.startswith("data:")][0]
    payload = json.loads(data_line[len("data:"):].strip())
    assert payload["round"] == 1
    assert payload["speaker"] == "A"


def test_format_sse_serializes_schedule_pydantic_model():
    block = TimeBlock(start=_utc(2026, 6, 15, 9), end=_utc(2026, 6, 15, 10), label="Write report", task_id="t1")
    schedule = Schedule(blocks=[block])
    frame = format_sse({"type": "done", "schedule": schedule, "thread_id": "x"})
    data_line = [l for l in frame.splitlines() if l.startswith("data:")][0]
    payload = json.loads(data_line[len("data:"):].strip())
    assert payload["schedule"]["blocks"][0]["label"] == "Write report"
    assert payload["schedule"]["blocks"][0]["task_id"] == "t1"


def test_format_sse_handles_none_schedule():
    frame = format_sse({"type": "done", "schedule": None, "thread_id": "x"})
    data_line = [l for l in frame.splitlines() if l.startswith("data:")][0]
    payload = json.loads(data_line[len("data:"):].strip())
    assert payload["schedule"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/api/test_schemas.py tests/api/test_sse.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'weekforge.api'`

- [ ] **Step 3: Create the api package marker**

Create `src/weekforge/api/__init__.py`:

```python
"""WeekForge HTTP API — FastAPI app exposing the debate engine over SSE."""
```

- [ ] **Step 4: Create `schemas.py`**

Create `src/weekforge/api/schemas.py`:

```python
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
```

- [ ] **Step 5: Create `sse.py`**

Create `src/weekforge/api/sse.py`:

```python
"""Server-Sent Events frame formatting.

An SSE frame looks like:

    event: debate_event
    data: {"type": "debate_event", ...}
    <blank line>

The frontend's EventSource can subscribe per event type (debate_event, interrupt,
done, error) via addEventListener.
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel


def _default(obj: Any) -> Any:
    if isinstance(obj, BaseModel):
        return obj.model_dump(mode="json")
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def format_sse(event: dict[str, Any]) -> str:
    """Render an event dict as a single SSE frame string."""
    event_type = event.get("type", "message")
    payload = json.dumps(event, default=_default)
    return f"event: {event_type}\ndata: {payload}\n\n"
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/api/test_schemas.py tests/api/test_sse.py -v`
Expected: PASS (5 schema + 4 sse = 9 passed).

- [ ] **Step 7: Run full suite**

Run: `uv run pytest -v`
Expected: 57 passed (48 + 9), 0 failed.

- [ ] **Step 8: Commit**

```bash
cd /Users/Najum/weekforge && git add src/weekforge/api/__init__.py src/weekforge/api/schemas.py src/weekforge/api/sse.py tests/api/__init__.py tests/api/test_schemas.py tests/api/test_sse.py && git commit -m "feat: add API schemas and SSE frame formatting"
```

---

## Task 4: SessionManager

Holds per-`thread_id` inputs and any pending human intervention. In-memory is fine for a single-user demo; the debate *state* itself lives in the SQLite checkpointer, not here.

**Files:**
- Create: `src/weekforge/api/sessions.py`
- Test: `tests/api/test_sessions.py`

- [ ] **Step 1: Write failing tests**

Create `tests/api/test_sessions.py`:

```python
from weekforge.api.schemas import StartDebateRequest
from weekforge.api.sessions import SessionManager


def _req() -> StartDebateRequest:
    return StartDebateRequest(tasks=[{"id": "t1", "title": "X", "estimated_minutes": 30}])


def test_create_returns_unique_thread_ids():
    mgr = SessionManager()
    a = mgr.create(_req())
    b = mgr.create(_req())
    assert a != b
    assert isinstance(a, str) and len(a) > 0


def test_get_returns_session_with_request():
    mgr = SessionManager()
    req = _req()
    tid = mgr.create(req)
    session = mgr.get(tid)
    assert session is not None
    assert session.request is req
    assert session.intervention is None


def test_get_unknown_thread_returns_none():
    mgr = SessionManager()
    assert mgr.get("does-not-exist") is None


def test_set_and_pop_intervention():
    mgr = SessionManager()
    tid = mgr.create(_req())
    mgr.set_intervention(tid, "Prioritise the report")
    assert mgr.pop_intervention(tid) == "Prioritise the report"
    # Second pop is None — interventions are consumed once.
    assert mgr.pop_intervention(tid) is None


def test_pop_intervention_unknown_thread_returns_none():
    mgr = SessionManager()
    assert mgr.pop_intervention("nope") is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/api/test_sessions.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'weekforge.api.sessions'`

- [ ] **Step 3: Implement `sessions.py`**

Create `src/weekforge/api/sessions.py`:

```python
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
    intervention: str | None = None


class SessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def create(self, request: StartDebateRequest) -> str:
        thread_id = uuid4().hex
        self._sessions[thread_id] = Session(request=request)
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/api/test_sessions.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Run full suite**

Run: `uv run pytest -v`
Expected: 62 passed (57 + 5), 0 failed.

- [ ] **Step 6: Commit**

```bash
cd /Users/Najum/weekforge && git add src/weekforge/api/sessions.py tests/api/test_sessions.py && git commit -m "feat: add SessionManager for debate threads and interventions"
```

---

## Task 5: Routes + app factory (the SSE endpoints and HITL cycle)

**Files:**
- Create: `src/weekforge/api/routes.py`
- Create: `src/weekforge/api/app.py`
- Modify: `src/weekforge/api/__init__.py` (re-export `create_app`)
- Create: `tests/api/conftest.py`
- Test: `tests/api/test_routes.py`

- [ ] **Step 1: Create the test fixtures**

Create `tests/api/conftest.py`:

```python
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
```

Create `tests/api/test_routes.py`:

```python
import json

import pytest

SAMPLE_BODY = {
    "tasks": [{"id": "t1", "title": "Write report", "estimated_minutes": 120, "priority": 1}],
    "busy_blocks": [
        {"start": "2026-06-15T10:00:00+00:00", "end": "2026-06-15T11:00:00+00:00", "label": "Standup"}
    ],
    "preferences": {"workday_start_hour": 9, "workday_end_hour": 18, "max_focus_minutes_per_day": 360},
    "max_rounds": 3,
}


def _parse_sse(text: str) -> list[dict]:
    events = []
    for block in text.strip().split("\n\n"):
        if not block.strip():
            continue
        data_lines = [l for l in block.splitlines() if l.startswith("data:")]
        if not data_lines:
            continue
        events.append(json.loads(data_lines[0][len("data:"):].strip()))
    return events


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_start_returns_thread_id(client):
    resp = client.post("/debate", json=SAMPLE_BODY)
    assert resp.status_code == 200
    assert "thread_id" in resp.json()
    assert len(resp.json()["thread_id"]) > 0


def test_start_rejects_missing_tasks(client):
    resp = client.post("/debate", json={})
    assert resp.status_code == 422


def test_stream_unknown_thread_returns_404(client):
    resp = client.get("/debate/does-not-exist/stream")
    assert resp.status_code == 404


def test_stream_emits_debate_events_and_done(client, anthropic_patch):
    thread_id = client.post("/debate", json=SAMPLE_BODY).json()["thread_id"]
    with anthropic_patch(converge=True):
        resp = client.get(f"/debate/{thread_id}/stream")
        events = _parse_sse(resp.text)

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")

    debate_events = [e for e in events if e["type"] == "debate_event"]
    assert len(debate_events) >= 3  # at least one proposal per debater

    done = [e for e in events if e["type"] == "done"]
    assert len(done) == 1
    assert done[0]["schedule"]["blocks"][0]["label"] == "Write report"


def test_intervene_unknown_thread_returns_404(client):
    resp = client.post("/debate/nope/intervene", json={"input": "x"})
    assert resp.status_code == 404


def test_intervene_accepts_input(client):
    thread_id = client.post("/debate", json=SAMPLE_BODY).json()["thread_id"]
    resp = client.post(f"/debate/{thread_id}/intervene", json={"input": "Prioritise the report"})
    assert resp.status_code == 200
    assert resp.json() == {"status": "accepted"}


def test_full_hitl_cycle(client, anthropic_patch):
    """Stall the council → it interrupts → human intervenes → resume → done."""
    thread_id = client.post("/debate", json=SAMPLE_BODY).json()["thread_id"]

    # Phase 1: council never converges → graph pauses at human_interrupt.
    with anthropic_patch(converge=False):
        resp1 = client.get(f"/debate/{thread_id}/stream")
        events1 = _parse_sse(resp1.text)

    assert any(e["type"] == "interrupt" for e in events1)
    assert not any(e["type"] == "done" for e in events1)

    # Human arbitrates.
    intervene = client.post(f"/debate/{thread_id}/intervene", json={"input": "Prioritise the report"})
    assert intervene.status_code == 200

    # Phase 2: resume; this time it converges → finishes.
    with anthropic_patch(converge=True):
        resp2 = client.get(f"/debate/{thread_id}/stream")
        events2 = _parse_sse(resp2.text)

    assert any(e["type"] == "done" for e in events2)
    done = [e for e in events2 if e["type"] == "done"][0]
    assert done["schedule"] is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/api/test_routes.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'weekforge.api.app'` (collection error).

- [ ] **Step 3: Implement `routes.py`**

Create `src/weekforge/api/routes.py`:

```python
"""HTTP routes for the WeekForge API.

Routes are built by `create_router`, which closes over the injected council, API key,
SQLite db_path, and SessionManager — no module-level globals, so tests can inject a
MockCouncil and a temp DB.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from weekforge.api.schemas import (
    InterventionRequest,
    StartDebateRequest,
    StartDebateResponse,
)
from weekforge.api.sessions import SessionManager
from weekforge.api.sse import format_sse
from weekforge.debate.debaters import Council
from weekforge.debate.runner import run_debate


def create_router(council: Council, api_key: str, db_path: str, sessions: SessionManager) -> APIRouter:
    router = APIRouter()

    @router.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    @router.post("/debate", response_model=StartDebateResponse)
    def start_debate(request: StartDebateRequest) -> StartDebateResponse:
        thread_id = sessions.create(request)
        return StartDebateResponse(thread_id=thread_id)

    @router.get("/debate/{thread_id}/stream")
    def stream_debate(thread_id: str) -> StreamingResponse:
        session = sessions.get(thread_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Unknown thread_id")

        resume_value = sessions.pop_intervention(thread_id)

        def event_stream():
            try:
                for event in run_debate(
                    tasks=session.request.tasks,
                    busy_blocks=session.request.busy_blocks,
                    preferences=session.request.preferences,
                    thread_id=thread_id,
                    api_key=api_key,
                    council=council,
                    max_rounds=session.request.max_rounds,
                    db_path=db_path,
                    resume_value=resume_value,
                ):
                    yield format_sse(event)
            except Exception as exc:  # surface engine errors to the client as an SSE frame
                yield format_sse({"type": "error", "message": str(exc)})

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    @router.post("/debate/{thread_id}/intervene")
    def intervene(thread_id: str, request: InterventionRequest) -> dict:
        if sessions.get(thread_id) is None:
            raise HTTPException(status_code=404, detail="Unknown thread_id")
        sessions.set_intervention(thread_id, request.input)
        return {"status": "accepted"}

    return router
```

- [ ] **Step 4: Implement `app.py`**

Create `src/weekforge/api/app.py`:

```python
"""FastAPI application factory for the WeekForge API."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from weekforge.api.routes import create_router
from weekforge.api.sessions import SessionManager
from weekforge.debate.debaters import Council


def create_app(
    council: Council,
    api_key: str,
    db_path: str = "weekforge_api.db",
    allow_origins: list[str] | None = None,
) -> FastAPI:
    """Build the WeekForge FastAPI app.

    Args:
        council: CrewAI Council (or a mock in tests).
        api_key: Anthropic API key passed to the convergence-check and validate nodes.
        db_path: SQLite file backing the LangGraph checkpointer. Must be a real file
            (not ":memory:") so resume-across-requests works.
        allow_origins: CORS origins for the frontend. Defaults to the Next.js dev server.
    """
    app = FastAPI(title="WeekForge API", description="A transparent multi-agent decision council.")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins or ["http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    sessions = SessionManager()
    app.state.sessions = sessions
    app.include_router(create_router(council=council, api_key=api_key, db_path=db_path, sessions=sessions))

    return app
```

- [ ] **Step 5: Update `__init__.py` to re-export `create_app`**

Replace `src/weekforge/api/__init__.py` with:

```python
"""WeekForge HTTP API — FastAPI app exposing the debate engine over SSE."""

from weekforge.api.app import create_app

__all__ = ["create_app"]
```

- [ ] **Step 6: Run the route tests**

Run: `uv run pytest tests/api/test_routes.py -v`
Expected: PASS (8 passed), including `test_full_hitl_cycle`.

- [ ] **Step 7: Run full suite**

Run: `uv run pytest -v`
Expected: 70 passed (62 + 8), 0 failed.

- [ ] **Step 8: Commit**

```bash
cd /Users/Najum/weekforge && git add src/weekforge/api/routes.py src/weekforge/api/app.py src/weekforge/api/__init__.py tests/api/conftest.py tests/api/test_routes.py && git commit -m "feat: add FastAPI routes, app factory, and SSE debate streaming with HITL"
```

### Troubleshooting (Task 5)

- **`test_full_hitl_cycle` doesn't interrupt:** Confirm `make_check_convergence_node` sets `interrupt_reason` when `round_number >= max_rounds` and not converged. With `converge=False` and `max_rounds=3`, the flow is round1→2→3 then interrupt. If it loops forever, the round cap check is wrong — re-read `nodes.py`.
- **Resume finds no checkpoint:** The `db_path` must be the *same file* across both stream calls (it is — `create_app` fixes one path) and must NOT be `":memory:"`. The `tmp_path` fixture gives a stable file.
- **`Command` import error:** In the installed langgraph, `from langgraph.types import Command`. If that path changed, check `uv run python -c "import langgraph.types as t; print([n for n in dir(t) if 'omm' in n or 'nterrupt' in n])"`.
- **Patch not visible in the stream:** The generator runs in a threadpool, but `unittest.mock.patch` swaps a module attribute process-wide, so it IS visible. Keep the `with anthropic_patch(...)` wrapping the entire `client.get(...)` call and the `.text` access (TestClient reads the full body during `.get`).

---

## Task 6: Server entrypoint + manual smoke test

**Files:**
- Create: `src/weekforge/api/server.py`
- Modify: `pyproject.toml` (add `[project.scripts]`)
- Test: `tests/api/test_server.py`

- [ ] **Step 1: Write the failing test**

Create `tests/api/test_server.py`:

```python
import importlib

from fastapi import FastAPI


def test_server_module_exposes_main():
    server = importlib.import_module("weekforge.api.server")
    assert hasattr(server, "main")
    assert callable(server.main)


def test_build_app_helper_returns_fastapi(monkeypatch):
    # build_app() must construct a FastAPI without starting uvicorn.
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-key-for-build-only")

    server = importlib.import_module("weekforge.api.server")

    # build_council should not be called eagerly with a real network; patch it out.
    import weekforge.api.server as srv

    class _FakeCouncil:  # stand-in; build_app only needs an object to pass through
        pass

    monkeypatch.setattr(srv, "build_council", lambda api_key: _FakeCouncil())
    app = srv.build_app()
    assert isinstance(app, FastAPI)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/api/test_server.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'weekforge.api.server'`

- [ ] **Step 3: Implement `server.py`**

Create `src/weekforge/api/server.py`:

```python
"""Uvicorn entrypoint for the WeekForge API.

Run with the real Claude-backed council:

    ANTHROPIC_API_KEY=sk-... uv run weekforge-api
"""

from __future__ import annotations

import os

from fastapi import FastAPI

from weekforge.api.app import create_app
from weekforge.debate.debaters import build_council


def build_app() -> FastAPI:
    """Construct the production app from environment configuration."""
    api_key = os.environ["ANTHROPIC_API_KEY"]
    db_path = os.environ.get("WEEKFORGE_DB_PATH", "weekforge_api.db")
    council = build_council(api_key)
    return create_app(council=council, api_key=api_key, db_path=db_path)


def main() -> None:
    import uvicorn

    host = os.environ.get("WEEKFORGE_HOST", "127.0.0.1")
    port = int(os.environ.get("WEEKFORGE_PORT", "8000"))
    uvicorn.run(build_app(), host=host, port=port)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Add the script entry to `pyproject.toml`**

Add this block to `pyproject.toml` (after `[project]`'s `dependencies`, before `[dependency-groups]` is fine, or anywhere top-level):

```toml
[project.scripts]
weekforge-api = "weekforge.api.server:main"
```

- [ ] **Step 5: Re-sync so the script is installed**

Run: `cd /Users/Najum/weekforge && uv sync`
Expected: re-installs the package (editable); `weekforge-api` script becomes available.

- [ ] **Step 6: Run the server tests**

Run: `uv run pytest tests/api/test_server.py -v`
Expected: PASS (2 passed).

- [ ] **Step 7: Run the full suite**

Run: `uv run pytest -v`
Expected: 72 passed (70 + 2), 0 failed.

- [ ] **Step 8: Manual smoke test (real LLM — optional but recommended)**

This step needs a real `ANTHROPIC_API_KEY` and makes real API calls. Skip if you only want the test-verified path.

Terminal 1 — start the server:
```bash
cd /Users/Najum/weekforge && ANTHROPIC_API_KEY=sk-... uv run weekforge-api
```

Terminal 2 — exercise it:
```bash
# Health
curl -s http://127.0.0.1:8000/health
# Expected: {"status":"ok"}

# Start a debate, capture the thread_id
TID=$(curl -s -X POST http://127.0.0.1:8000/debate \
  -H 'content-type: application/json' \
  -d '{"tasks":[{"id":"t1","title":"Write report","estimated_minutes":120,"priority":1,"deadline":"2026-06-17T17:00:00+00:00"}],"max_rounds":2}' \
  | python -c "import sys,json; print(json.load(sys.stdin)['thread_id'])")
echo "thread: $TID"

# Stream the debate (SSE frames print live)
curl -N http://127.0.0.1:8000/debate/$TID/stream
```
Expected: a stream of `event: debate_event` frames (proposals then critiques), ending in either `event: done` (with a schedule) or `event: interrupt`. If `interrupt`, intervene then re-stream:
```bash
curl -s -X POST http://127.0.0.1:8000/debate/$TID/intervene \
  -H 'content-type: application/json' -d '{"input":"Prioritise the report."}'
curl -N http://127.0.0.1:8000/debate/$TID/stream
```

- [ ] **Step 9: Commit**

```bash
cd /Users/Najum/weekforge && git add src/weekforge/api/server.py pyproject.toml uv.lock tests/api/test_server.py && git commit -m "feat: add uvicorn server entrypoint and weekforge-api script"
```

---

## Done criteria

- `uv run pytest -v` → 72 passed, 0 failed.
- `from weekforge.api import create_app` works.
- `run_debate(..., resume_value=...)` resumes an interrupted thread; an interrupted run emits no `done` event.
- `POST /debate` → `{thread_id}`; `GET /debate/{thread_id}/stream` → `text/event-stream` of `debate_event` frames ending in `done` or `interrupt`; `POST /debate/{thread_id}/intervene` → records the human input consumed by the next stream call.
- `test_full_hitl_cycle` proves the end-to-end stall → interrupt → intervene → resume → done loop through the real graph + file-backed SQLite checkpointer.
- `ANTHROPIC_API_KEY=... uv run weekforge-api` serves the app on `127.0.0.1:8000`.
- CORS allows `http://localhost:3000` so the Plan 4 Next.js frontend can connect.

## Notes for the next plan (Plan 4: Next.js frontend)

- The frontend's `EventSource` connects to `GET /debate/{thread_id}/stream` and listens per event type: `debate_event`, `interrupt`, `done`, `error`.
- `EventSource` cannot send a request body, so the start handshake stays as `POST /debate` (fetch) → then open the SSE stream with the returned `thread_id`.
- On an `interrupt` frame, render the intervention UI; `POST .../intervene`, then re-open the SSE stream to resume.
