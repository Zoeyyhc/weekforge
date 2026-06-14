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
    require_human_on_stall: bool = True,
    week_start: str | None = None,
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
        require_human_on_stall: Forwarded to build_graph. When True (default), a stalled
            council pauses for human input; when False, it auto-arbitrates unattended.
    """
    graph = build_graph(
        council=council,
        api_key=api_key,
        db_path=db_path,
        require_human_on_stall=require_human_on_stall,
    )

    config = {"configurable": {"thread_id": thread_id}}

    if resume_value is not None:
        stream_input: Any = Command(resume=resume_value)
    else:
        stream_input = DebateState(
            tasks=tasks,
            busy_blocks=busy_blocks,
            preferences=preferences,
            max_rounds=max_rounds,
            week_start=week_start,
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

    try:
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
    finally:
        # build_graph opens a per-call SQLite connection for the checkpointer;
        # close it so repeated HTTP stream requests don't leak file descriptors.
        conn = getattr(getattr(graph, "checkpointer", None), "conn", None)
        if conn is not None:
            conn.close()
