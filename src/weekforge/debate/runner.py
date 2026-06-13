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
