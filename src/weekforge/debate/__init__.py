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
