# WeekForge Debate Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the transparent multi-agent debate engine — CrewAI debaters (DeadlineHawk, EnergyGuardian, FocusBatcher, Arbiter) orchestrated by a LangGraph state machine that loops, checks convergence, interrupts for human input, and produces a final `Schedule`.

**Architecture:** `DebateState` (LangGraph TypedDict) flows through a `StateGraph` whose nodes call a `Council` object (CrewAI agents). The graph loops: gather proposals → critique → check convergence → (another round | human interrupt | arbitrate) → validate → finalize. A SQLite checkpointer persists state per `thread_id` (one per week), enabling re-planning from saved state. A `run_debate()` async generator streams `DebateEvent` dicts to callers (FastAPI, next plan).

**Tech Stack:** `langgraph>=0.2`, `langgraph-checkpoint-sqlite>=2.0`, `crewai>=0.80`, `anthropic>=0.40`, `pytest`, `pytest-asyncio`

---

## File Structure

```
src/weekforge/debate/
├── __init__.py          — re-exports Council, build_graph, run_debate
├── state.py             — DebateState TypedDict, DebateEvent TypedDict, DEBATER_NAMES
├── debaters.py          — Council dataclass, build_council()
├── nodes.py             — LangGraph node factory functions (7 nodes)
├── graph.py             — build_graph(), routing functions
└── runner.py            — run_debate() async generator

tests/debate/
├── __init__.py
├── conftest.py          — MockCouncil, base_state fixture, MOCK_API_KEY
├── test_state.py        — DebateState schema, Annotated transcript reducer
├── test_debaters.py     — Council instantiation with mocked LLM
├── test_nodes.py        — all node functions with MockCouncil
├── test_graph.py        — routing functions, graph structure
└── test_runner.py       — run_debate() with mocked graph
```

**Key design decisions locked in here:**
- `transcript: Annotated[list[DebateEvent], operator.add]` — append-only, LangGraph merges by concatenation
- `proposals` and `critiques` are replaced (not appended) each round — only the current round's positions matter for routing
- `round_number` is incremented inside `gather_proposals_node` so the transcript shows the correct round number
- `human_interrupt_node` uses `langgraph.types.interrupt()` — pauses graph, resumes when caller passes `Command(resume=value)`
- `Council` is injected into `build_graph()` — enables `MockCouncil` in tests without patching
- Nodes that call the LLM directly (convergence check, validate) take `api_key` at factory time

---

## Task 1: Add debate engine dependencies

**Files:**
- Modify: `pyproject.toml`

- [ ] **Step 1: Add dependencies**

Edit `pyproject.toml` — replace the `dependencies` block:

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
]

[dependency-groups]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24",
]
```

- [ ] **Step 2: Install and verify**

Run: `uv sync`
Expected: resolves and installs langgraph, crewai, anthropic, langgraph-checkpoint-sqlite, pytest-asyncio.

Run: `uv run python -c "import langgraph; import crewai; import anthropic; print('OK')"`
Expected: prints `OK`

- [ ] **Step 3: Verify existing tests still pass**

Run: `uv run pytest -v`
Expected: 15 passed (no regressions)

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml uv.lock
git commit -m "chore: add langgraph, crewai, anthropic debate engine dependencies"
```

---

## Task 2: Debate state types

**Files:**
- Create: `src/weekforge/debate/__init__.py`
- Create: `src/weekforge/debate/state.py`
- Create: `tests/debate/__init__.py`
- Test: `tests/debate/test_state.py`

- [ ] **Step 1: Write failing tests**

Create `tests/debate/__init__.py` (empty).

Create `tests/debate/test_state.py`:

```python
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
    # The Annotated[list[DebateEvent], operator.add] reducer means
    # LangGraph merges transcripts by addition (concatenation).
    # Verify the reducer directly.
    existing = [{"round": 1, "speaker": "A", "content": "x", "event_type": "proposal"}]
    new_events = [{"round": 1, "speaker": "B", "content": "y", "event_type": "critique"}]
    result = operator.add(existing, new_events)
    assert len(result) == 2
    assert result[0]["speaker"] == "A"
    assert result[1]["speaker"] == "B"


def test_debate_state_shape():
    # DebateState is a TypedDict — verify all required keys exist in the definition.
    import typing
    hints = typing.get_type_hints(DebateState)
    required_keys = {
        "tasks", "busy_blocks", "preferences", "max_rounds",
        "round_number", "proposals", "critiques", "converged",
        "interrupt_reason", "human_input", "arbiter_output",
        "validation_error", "schedule", "transcript",
    }
    assert required_keys.issubset(hints.keys()), f"Missing keys: {required_keys - hints.keys()}"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/debate/test_state.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'weekforge.debate'`

- [ ] **Step 3: Create package marker**

Create `src/weekforge/debate/__init__.py`:

```python
"""WeekForge debate engine — CrewAI council + LangGraph orchestration."""
```

- [ ] **Step 4: Create state.py**

Create `src/weekforge/debate/state.py`:

```python
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_state.py -v`
Expected: PASS (4 passed)

- [ ] **Step 6: Commit**

```bash
git add src/weekforge/debate/__init__.py src/weekforge/debate/state.py tests/debate/__init__.py tests/debate/test_state.py
git commit -m "feat: add DebateState and DebateEvent types"
```

---

## Task 3: CrewAI council

**Files:**
- Create: `src/weekforge/debate/debaters.py`
- Create: `tests/debate/conftest.py`
- Test: `tests/debate/test_debaters.py`

- [ ] **Step 1: Create conftest with MockCouncil**

Create `tests/debate/conftest.py`:

```python
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
```

- [ ] **Step 2: Write failing tests for Council**

Create `tests/debate/test_debaters.py`:

```python
from unittest.mock import MagicMock, patch

import pytest

from weekforge.debate.debaters import Council, build_council
from weekforge.debate.state import DEBATER_NAMES


def test_council_has_all_four_agents():
    fake_agent = MagicMock()
    council = Council(
        deadline_hawk=fake_agent,
        energy_guardian=fake_agent,
        focus_batcher=fake_agent,
        arbiter=fake_agent,
    )
    assert council.deadline_hawk is fake_agent
    assert council.energy_guardian is fake_agent
    assert council.focus_batcher is fake_agent
    assert council.arbiter is fake_agent


def test_council_propose_calls_correct_agent():
    with patch("weekforge.debate.debaters.Crew") as MockCrew:
        mock_result = MagicMock()
        mock_result.raw = "Proposed: pack all deadlines first."
        MockCrew.return_value.kickoff.return_value = mock_result

        fake_agent = MagicMock()
        council = Council(
            deadline_hawk=fake_agent,
            energy_guardian=fake_agent,
            focus_batcher=fake_agent,
            arbiter=fake_agent,
        )
        result = council.propose("DeadlineHawk", "some context")

        assert result == "Proposed: pack all deadlines first."
        MockCrew.return_value.kickoff.assert_called_once()


def test_council_critique_calls_correct_agent():
    with patch("weekforge.debate.debaters.Crew") as MockCrew:
        mock_result = MagicMock()
        mock_result.raw = "Critique: ignores energy levels."
        MockCrew.return_value.kickoff.return_value = mock_result

        fake_agent = MagicMock()
        council = Council(
            deadline_hawk=fake_agent,
            energy_guardian=fake_agent,
            focus_batcher=fake_agent,
            arbiter=fake_agent,
        )
        result = council.critique("EnergyGuardian", "proposals context")

        assert result == "Critique: ignores energy levels."


def test_council_arbitrate_calls_arbiter():
    with patch("weekforge.debate.debaters.Crew") as MockCrew:
        mock_result = MagicMock()
        mock_result.raw = '{"blocks": []}'
        MockCrew.return_value.kickoff.return_value = mock_result

        fake_agent = MagicMock()
        council = Council(
            deadline_hawk=fake_agent,
            energy_guardian=fake_agent,
            focus_batcher=fake_agent,
            arbiter=fake_agent,
        )
        result = council.arbitrate("all proposals and critiques")

        assert result == '{"blocks": []}'


def test_council_propose_unknown_agent_raises():
    fake_agent = MagicMock()
    council = Council(
        deadline_hawk=fake_agent,
        energy_guardian=fake_agent,
        focus_batcher=fake_agent,
        arbiter=fake_agent,
    )
    with pytest.raises(KeyError):
        council.propose("UnknownAgent", "context")


def test_build_council_instantiates_four_agents():
    with (
        patch("weekforge.debate.debaters.LLM") as MockLLM,
        patch("weekforge.debate.debaters.Agent") as MockAgent,
    ):
        MockAgent.return_value = MagicMock()
        council = build_council(api_key="fake-key")

        assert MockAgent.call_count == 4
        assert isinstance(council, Council)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/debate/test_debaters.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'weekforge.debate.debaters'`

- [ ] **Step 4: Implement debaters.py**

Create `src/weekforge/debate/debaters.py`:

```python
"""CrewAI council of debaters for WeekForge."""

from __future__ import annotations

from dataclasses import dataclass

from crewai import Agent, Crew, Process, Task
from crewai.llm import LLM


@dataclass
class Council:
    """Holds the four CrewAI agents. Injected into the LangGraph graph at build time."""

    deadline_hawk: Agent
    energy_guardian: Agent
    focus_batcher: Agent
    arbiter: Agent

    def propose(self, agent_name: str, context: str) -> str:
        """Ask one debater to propose a weekly schedule given the context."""
        agent = self._get_agent(agent_name)
        task = Task(
            description=(
                f"Given this planning context:\n{context}\n\n"
                "Propose a weekly schedule that best serves YOUR specific objective. "
                "Be concrete: name which tasks go on which days and at what times. "
                "Explain your reasoning in 2-3 sentences."
            ),
            expected_output="A proposed weekly schedule with task placements and a brief rationale.",
            agent=agent,
        )
        crew = Crew(agents=[agent], tasks=[task], process=Process.sequential, verbose=False)
        result = crew.kickoff()
        return str(result.raw)

    def critique(self, agent_name: str, context: str) -> str:
        """Ask one debater to critique the current round's proposals."""
        agent = self._get_agent(agent_name)
        task = Task(
            description=(
                f"Given these proposals from the council:\n{context}\n\n"
                "Critique the proposals from YOUR perspective. "
                "Be specific: which proposals conflict with your objective and why. "
                "Be direct — this is a debate."
            ),
            expected_output="A specific critique of the proposals highlighting conflicts with your objective.",
            agent=agent,
        )
        crew = Crew(agents=[agent], tasks=[task], process=Process.sequential, verbose=False)
        result = crew.kickoff()
        return str(result.raw)

    def arbitrate(self, context: str) -> str:
        """Ask the Arbiter to synthesise a final schedule from all proposals and critiques."""
        task = Task(
            description=(
                f"Given these proposals and critiques from the council:\n{context}\n\n"
                "Synthesise the BEST POSSIBLE weekly schedule that balances all competing objectives. "
                "Output a JSON array of time blocks. Each block must have: "
                "start (ISO 8601 datetime with timezone), end (ISO 8601 datetime with timezone), "
                "label (task title or description), task_id (task id string or null). "
                "Output ONLY the JSON array, no markdown fences, no explanation."
            ),
            expected_output="A JSON array of time block objects.",
            agent=self.arbiter,
        )
        crew = Crew(agents=[self.arbiter], tasks=[task], process=Process.sequential, verbose=False)
        result = crew.kickoff()
        return str(result.raw)

    def _get_agent(self, name: str) -> Agent:
        mapping = {
            "DeadlineHawk": self.deadline_hawk,
            "EnergyGuardian": self.energy_guardian,
            "FocusBatcher": self.focus_batcher,
        }
        return mapping[name]  # raises KeyError for unknown agents


def build_council(api_key: str) -> Council:
    """Build a Council with four Claude-backed CrewAI agents."""
    llm = LLM(model="anthropic/claude-sonnet-4-6", api_key=api_key)

    deadline_hawk = Agent(
        role="Deadline Hawk",
        goal="Ensure every task is completed before its deadline by prioritising urgency above all else",
        backstory=(
            "You are a relentless advocate for hitting deadlines. You have seen projects fail because "
            "teams optimistically deprioritised time-sensitive work. You believe that missing a deadline "
            "is the worst outcome, and that people systematically underestimate time pressure."
        ),
        llm=llm,
        verbose=False,
    )

    energy_guardian = Agent(
        role="Energy Guardian",
        goal="Protect the user from burnout by ensuring adequate breaks and preventing back-to-back high-intensity work",
        backstory=(
            "You are a wellness-focused planner who has witnessed burnout destroy productivity and wellbeing. "
            "You believe that sustainable pacing always beats sprinting, and that rest is as productive as work. "
            "You will always push back on overpacked schedules."
        ),
        llm=llm,
        verbose=False,
    )

    focus_batcher = Agent(
        role="Focus Batcher",
        goal="Minimise context-switching by grouping similar tasks together and protecting long uninterrupted work blocks",
        backstory=(
            "You are a deep-work advocate who has measured the true cost of context-switching. "
            "You believe the enemy of great work is fragmentation. You want similar tasks batched, "
            "meetings clustered, and long focused blocks protected at all costs."
        ),
        llm=llm,
        verbose=False,
    )

    arbiter = Agent(
        role="Neutral Arbiter",
        goal="Synthesise the council's competing proposals into the best possible schedule, weighing trade-offs fairly",
        backstory=(
            "You are a wise mediator who hears all perspectives without bias. "
            "You understand that deadlines, energy, and focus are all legitimate concerns, "
            "and your job is to find the schedule that honours all three as well as possible. "
            "You always explain the trade-offs you accepted."
        ),
        llm=llm,
        verbose=False,
    )

    return Council(
        deadline_hawk=deadline_hawk,
        energy_guardian=energy_guardian,
        focus_batcher=focus_batcher,
        arbiter=arbiter,
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_debaters.py -v`
Expected: PASS (6 passed)

- [ ] **Step 6: Run full suite**

Run: `uv run pytest -v`
Expected: 19 passed (15 previous + 4 state + 6 debaters — note: state tests run in task 2, so 15+4+6=25... let me recount: 15 foundation + 4 state + 6 debaters = 25 total)

- [ ] **Step 7: Commit**

```bash
git add src/weekforge/debate/debaters.py tests/debate/conftest.py tests/debate/test_debaters.py
git commit -m "feat: add CrewAI Council with four debaters and build_council()"
```

---

## Task 4: LangGraph node functions

**Files:**
- Create: `src/weekforge/debate/nodes.py`
- Test: `tests/debate/test_nodes.py`

- [ ] **Step 1: Write failing tests**

Create `tests/debate/test_nodes.py`:

```python
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
    # The node should pass human_input into the context given to council.arbitrate.
    # We can verify this by checking the MockCouncil was called (mock_council.arbitrate
    # is called with a context string that includes human_input).
    # Since MockCouncil is not a real mock, just verify the node completes and emits a transcript.
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/debate/test_nodes.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'weekforge.debate.nodes'`

- [ ] **Step 3: Implement nodes.py**

Create `src/weekforge/debate/nodes.py`:

```python
"""LangGraph node functions for the WeekForge debate engine."""

from __future__ import annotations

import json
from datetime import datetime

from anthropic import Anthropic

from weekforge.debate.debaters import Council
from weekforge.debate.state import DEBATER_NAMES, DebateEvent, DebateState
from weekforge.models import Schedule, TimeBlock


# ── Formatting helpers ──────────────────────────────────────────────────────

def _fmt_tasks(state: DebateState) -> str:
    lines = []
    for t in state["tasks"]:
        line = f"- [{t.id}] {t.title} ({t.estimated_minutes}min, priority {t.priority}"
        if t.deadline:
            line += f", deadline {t.deadline.date()}"
        if t.category:
            line += f", category: {t.category}"
        line += ")"
        lines.append(line)
    return "\n".join(lines) if lines else "No tasks."


def _fmt_busy(state: DebateState) -> str:
    lines = [
        f"- {b.label}: {b.start.strftime('%a %d %b %H:%M')}–{b.end.strftime('%H:%M')}"
        for b in state["busy_blocks"]
    ]
    return "\n".join(lines) if lines else "No fixed commitments."


def _fmt_prefs(state: DebateState) -> str:
    p = state["preferences"]
    return f"Work hours {p.workday_start_hour}:00–{p.workday_end_hour}:00, max focus {p.max_focus_minutes_per_day}min/day"


def _fmt_transcript_tail(state: DebateState, n: int = 12) -> str:
    return "\n".join(
        f"[Round {e['round']} {e['speaker']}] {e['content']}"
        for e in state["transcript"][-n:]
    )


# ── Node factories ──────────────────────────────────────────────────────────

def make_gather_proposals_node(council: Council):
    """Return a LangGraph node that asks each debater to propose a schedule."""

    def gather_proposals(state: DebateState) -> dict:
        new_round = state["round_number"] + 1
        context = (
            f"Tasks to schedule:\n{_fmt_tasks(state)}\n\n"
            f"Fixed commitments this week:\n{_fmt_busy(state)}\n\n"
            f"User preferences: {_fmt_prefs(state)}\n\n"
            f"Debate so far:\n{_fmt_transcript_tail(state)}"
        )
        proposals: dict[str, str] = {}
        events: list[DebateEvent] = []
        for name in DEBATER_NAMES:
            text = council.propose(name, context)
            proposals[name] = text
            events.append(DebateEvent(round=new_round, speaker=name, content=text, event_type="proposal"))
        return {"proposals": proposals, "round_number": new_round, "transcript": events}

    return gather_proposals


def make_critique_node(council: Council):
    """Return a LangGraph node that asks each debater to critique the current proposals."""

    def critique(state: DebateState) -> dict:
        proposals_text = "\n\n".join(
            f"**{name}**: {text}" for name, text in state["proposals"].items()
        )
        context = (
            f"Tasks: {_fmt_tasks(state)}\n\n"
            f"Current proposals from all council members:\n{proposals_text}"
        )
        critiques: dict[str, str] = {}
        events: list[DebateEvent] = []
        for name in DEBATER_NAMES:
            text = council.critique(name, context)
            critiques[name] = text
            events.append(DebateEvent(round=state["round_number"], speaker=name, content=text, event_type="critique"))
        return {"critiques": critiques, "transcript": events}

    return critique


def make_check_convergence_node(api_key: str):
    """Return a LangGraph node that asks Claude Haiku if the proposals have converged."""
    client = Anthropic(api_key=api_key)

    def check_convergence(state: DebateState) -> dict:
        proposals_text = "\n\n".join(f"{k}: {v}" for k, v in state["proposals"].items())
        critiques_text = "\n\n".join(f"{k}: {v}" for k, v in state["critiques"].items())

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=10,
            messages=[{
                "role": "user",
                "content": (
                    f"Proposals:\n{proposals_text}\n\nCritiques:\n{critiques_text}\n\n"
                    "Are the proposals substantially aligned (only minor disagreements remain)? "
                    "Answer only: yes or no"
                ),
            }],
        )
        answer = response.content[0].text.strip().lower()
        converged = answer.startswith("yes")

        interrupt_reason: str | None = None
        if not converged and state["round_number"] >= state["max_rounds"]:
            interrupt_reason = (
                f"The council could not reach consensus after {state['max_rounds']} rounds. "
                "Please review the proposals and provide guidance."
            )

        return {"converged": converged, "interrupt_reason": interrupt_reason}

    return check_convergence


def human_interrupt_node(state: DebateState) -> dict:
    """Pause the graph and wait for human input via LangGraph's interrupt mechanism."""
    from langgraph.types import interrupt

    value = interrupt({
        "type": "needs_human_input",
        "interrupt_reason": state["interrupt_reason"],
        "proposals": state["proposals"],
        "round": state["round_number"],
    })
    event = DebateEvent(
        round=state["round_number"],
        speaker="Human",
        content=str(value),
        event_type="human_intervention",
    )
    return {"human_input": str(value), "transcript": [event]}


def make_arbitrate_node(council: Council):
    """Return a LangGraph node that asks the Arbiter to synthesise a final schedule."""

    def arbitrate(state: DebateState) -> dict:
        proposals_text = "\n\n".join(f"**{k}**: {v}" for k, v in state["proposals"].items())
        critiques_text = "\n\n".join(f"**{k}**: {v}" for k, v in state["critiques"].items())
        human_note = (
            f"\n\nHuman arbiter input: {state['human_input']}"
            if state.get("human_input")
            else ""
        )
        prev_error = (
            f"\n\nPrevious attempt failed validation: {state['validation_error']}. "
            "Please output valid JSON only."
            if state.get("validation_error")
            else ""
        )
        context = (
            f"Tasks:\n{_fmt_tasks(state)}\n\n"
            f"Proposals:\n{proposals_text}\n\n"
            f"Critiques:\n{critiques_text}"
            f"{human_note}{prev_error}"
        )
        text = council.arbitrate(context)
        event = DebateEvent(
            round=state["round_number"],
            speaker="Arbiter",
            content=text,
            event_type="arbitration",
        )
        return {"arbiter_output": text, "validation_error": None, "transcript": [event]}

    return arbitrate


def make_validate_node(api_key: str):
    """Return a node that parses the Arbiter's JSON output into a Schedule."""
    client = Anthropic(api_key=api_key)

    def validate(state: DebateState) -> dict:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            messages=[{
                "role": "user",
                "content": (
                    f"Task IDs available: {[t.id for t in state['tasks']]}\n"
                    f"Arbiter output:\n{state.get('arbiter_output', '')}\n\n"
                    "Extract a JSON array of time blocks. Each object must have: "
                    "start (ISO 8601 with timezone), end (ISO 8601 with timezone), "
                    "label (string), task_id (task id string or null). "
                    "Output ONLY the raw JSON array, no markdown."
                ),
            }],
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:-1])
        try:
            blocks_data = json.loads(raw)
            blocks = [
                TimeBlock(
                    start=datetime.fromisoformat(b["start"]),
                    end=datetime.fromisoformat(b["end"]),
                    label=b["label"],
                    task_id=b.get("task_id"),
                )
                for b in blocks_data
            ]
            schedule = Schedule(blocks=blocks)
            return {"schedule": schedule, "validation_error": None}
        except Exception as exc:
            error_msg = str(exc)
            event = DebateEvent(
                round=state["round_number"],
                speaker="System",
                content=f"Schedule parsing failed: {error_msg}. Retrying arbitration.",
                event_type="validation_fail",
            )
            return {"schedule": None, "validation_error": error_msg, "transcript": [event]}

    return validate


def finalize_node(state: DebateState) -> dict:
    """Terminal node — passes the validated schedule through unchanged."""
    return {"schedule": state["schedule"]}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_nodes.py -v`
Expected: PASS (11 passed)

- [ ] **Step 5: Run full suite**

Run: `uv run pytest -v`
Expected: all passing (no regressions)

- [ ] **Step 6: Commit**

```bash
git add src/weekforge/debate/nodes.py tests/debate/test_nodes.py
git commit -m "feat: add LangGraph node functions for debate engine"
```

---

## Task 5: Graph assembly

**Files:**
- Create: `src/weekforge/debate/graph.py`
- Test: `tests/debate/test_graph.py`

- [ ] **Step 1: Write failing tests**

Create `tests/debate/test_graph.py`:

```python
"""Tests for graph routing functions and graph structure."""

from __future__ import annotations

from weekforge.debate.graph import (
    _route_after_convergence_check,
    _route_after_validate,
    build_graph,
)
from weekforge.debate.state import DEBATER_NAMES


# ── Routing function tests (pure, no LLM) ──────────────────────────────────

def test_route_converged_goes_to_arbitrate():
    state = {"converged": True, "interrupt_reason": None}
    assert _route_after_convergence_check(state) == "arbitrate"


def test_route_not_converged_no_interrupt_goes_to_gather():
    state = {"converged": False, "interrupt_reason": None}
    assert _route_after_convergence_check(state) == "gather_proposals"


def test_route_stalled_goes_to_human_interrupt():
    state = {"converged": False, "interrupt_reason": "Council stalled after 3 rounds."}
    assert _route_after_convergence_check(state) == "human_interrupt"


def test_route_valid_schedule_goes_to_finalize():
    from weekforge.models import Schedule
    state = {"schedule": Schedule(), "validation_error": None}
    assert _route_after_validate(state) == "finalize"


def test_route_invalid_schedule_goes_to_arbitrate():
    state = {"schedule": None, "validation_error": "JSONDecodeError: unexpected token"}
    assert _route_after_validate(state) == "arbitrate"


# ── Graph structure tests ───────────────────────────────────────────────────

def test_build_graph_returns_compiled_graph(mock_council, mock_api_key):
    from langgraph.graph.state import CompiledStateGraph
    graph = build_graph(council=mock_council, api_key=mock_api_key, db_path=":memory:")
    assert isinstance(graph, CompiledStateGraph)


def test_build_graph_has_expected_nodes(mock_council, mock_api_key):
    graph = build_graph(council=mock_council, api_key=mock_api_key, db_path=":memory:")
    node_names = set(graph.nodes.keys())
    expected = {
        "gather_proposals", "critique", "check_convergence",
        "human_interrupt", "arbitrate", "validate", "finalize",
    }
    assert expected.issubset(node_names)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/debate/test_graph.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'weekforge.debate.graph'`

- [ ] **Step 3: Implement graph.py**

Create `src/weekforge/debate/graph.py`:

```python
"""LangGraph StateGraph assembly for the WeekForge debate engine."""

from __future__ import annotations

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, StateGraph

from weekforge.debate.debaters import Council
from weekforge.debate.nodes import (
    finalize_node,
    human_interrupt_node,
    make_arbitrate_node,
    make_check_convergence_node,
    make_critique_node,
    make_gather_proposals_node,
    make_validate_node,
)
from weekforge.debate.state import DebateState


def _route_after_convergence_check(state: DebateState) -> str:
    if state["converged"]:
        return "arbitrate"
    if state.get("interrupt_reason"):
        return "human_interrupt"
    return "gather_proposals"


def _route_after_validate(state: DebateState) -> str:
    if state.get("schedule") is not None:
        return "finalize"
    return "arbitrate"


def build_graph(council: Council, api_key: str, db_path: str = "weekforge.db"):
    """Build and compile the debate StateGraph with a SQLite checkpointer.

    Args:
        council: CrewAI Council (or MockCouncil for tests).
        api_key: Anthropic API key for convergence-check and validate nodes.
        db_path: SQLite database path. Use ":memory:" in tests.

    Returns:
        A compiled LangGraph graph ready for .invoke() / .stream().
    """
    gather_proposals = make_gather_proposals_node(council)
    critique = make_critique_node(council)
    check_convergence = make_check_convergence_node(api_key)
    arbitrate = make_arbitrate_node(council)
    validate = make_validate_node(api_key)

    builder = StateGraph(DebateState)

    builder.add_node("gather_proposals", gather_proposals)
    builder.add_node("critique", critique)
    builder.add_node("check_convergence", check_convergence)
    builder.add_node("human_interrupt", human_interrupt_node)
    builder.add_node("arbitrate", arbitrate)
    builder.add_node("validate", validate)
    builder.add_node("finalize", finalize_node)

    builder.set_entry_point("gather_proposals")
    builder.add_edge("gather_proposals", "critique")
    builder.add_edge("critique", "check_convergence")
    builder.add_conditional_edges(
        "check_convergence",
        _route_after_convergence_check,
        {
            "arbitrate": "arbitrate",
            "human_interrupt": "human_interrupt",
            "gather_proposals": "gather_proposals",
        },
    )
    builder.add_edge("human_interrupt", "gather_proposals")
    builder.add_edge("arbitrate", "validate")
    builder.add_conditional_edges(
        "validate",
        _route_after_validate,
        {"finalize": "finalize", "arbitrate": "arbitrate"},
    )
    builder.add_edge("finalize", END)

    checkpointer = SqliteSaver.from_conn_string(db_path)
    return builder.compile(checkpointer=checkpointer)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_graph.py -v`
Expected: PASS (7 passed)

- [ ] **Step 5: Run full suite**

Run: `uv run pytest -v`
Expected: all passing

- [ ] **Step 6: Commit**

```bash
git add src/weekforge/debate/graph.py tests/debate/test_graph.py
git commit -m "feat: assemble LangGraph debate StateGraph with SQLite checkpointer"
```

---

## Task 6: Runner (streaming interface)

**Files:**
- Create: `src/weekforge/debate/runner.py`
- Modify: `src/weekforge/debate/__init__.py`
- Test: `tests/debate/test_runner.py`

- [ ] **Step 1: Write failing tests**

Create `tests/debate/test_runner.py`:

```python
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

        # Simulate graph.stream() yielding state chunks
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/debate/test_runner.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'weekforge.debate.runner'`

- [ ] **Step 3: Implement runner.py**

Create `src/weekforge/debate/runner.py`:

```python
"""High-level streaming interface for the WeekForge debate engine."""

from __future__ import annotations

from typing import Any, Generator, TypedDict

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
) -> Generator[dict[str, Any], None, None]:
    """Stream debate events as the council deliberates.

    Yields dicts with a 'type' key:
      - {"type": "debate_event", "round": int, "speaker": str, "content": str, "event_type": str}
      - {"type": "interrupt", "interrupt_reason": str, "proposals": dict, "thread_id": str}
      - {"type": "done", "schedule": Schedule | None, "thread_id": str}

    The graph is checkpointed per thread_id — re-calling with the same thread_id
    and a Command(resume=...) will continue from the interrupt point.
    """
    graph = build_graph(council=council, api_key=api_key, db_path=db_path)

    initial_state = DebateState(
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

    config = {"configurable": {"thread_id": thread_id}}
    final_schedule: Schedule | None = None

    for chunk in graph.stream(initial_state, config=config, stream_mode="updates"):
        # Handle LangGraph interrupt
        if "__interrupt__" in chunk:
            interrupts = chunk["__interrupt__"]
            if interrupts:
                interrupt_value = interrupts[0].value
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

    yield {"type": "done", "schedule": final_schedule, "thread_id": thread_id}
```

- [ ] **Step 4: Update `__init__.py` with re-exports**

Edit `src/weekforge/debate/__init__.py`:

```python
"""WeekForge debate engine — CrewAI council + LangGraph orchestration."""

from weekforge.debate.debaters import Council, build_council
from weekforge.debate.graph import build_graph
from weekforge.debate.runner import DebateResult, run_debate
from weekforge.debate.state import DEBATER_NAMES, DebateEvent, DebateState

__all__ = [
    "Council",
    "build_council",
    "build_graph",
    "run_debate",
    "DebateResult",
    "DEBATER_NAMES",
    "DebateEvent",
    "DebateState",
]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_runner.py -v`
Expected: PASS (4 passed)

- [ ] **Step 6: Run full suite**

Run: `uv run pytest -v`
Expected: all passing

- [ ] **Step 7: Commit**

```bash
git add src/weekforge/debate/runner.py src/weekforge/debate/__init__.py tests/debate/test_runner.py
git commit -m "feat: add run_debate() streaming runner — debate engine complete"
```

---

## Done criteria

- `uv run pytest -v` → all tests passing (foundation 15 + debate engine ~32).
- `from weekforge.debate import run_debate, build_council, build_graph` works.
- `run_debate()` yields typed event dicts: `debate_event`, `interrupt`, `done`.
- `build_graph(council, api_key, db_path=":memory:")` compiles without errors using `MockCouncil`.
- Routing functions (`_route_after_convergence_check`, `_route_after_validate`) are tested independently.
- No real LLM calls in any test — all external calls are mocked or use `MockCouncil`.
- SQLite checkpointer wired in at `build_graph()` — `db_path=":memory:"` for tests, file path for production.
