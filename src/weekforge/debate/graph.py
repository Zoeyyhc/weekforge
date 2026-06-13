"""LangGraph StateGraph assembly for the WeekForge debate engine."""

from __future__ import annotations

import sqlite3

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

    conn = sqlite3.connect(db_path, check_same_thread=False)
    checkpointer = SqliteSaver(conn)
    return builder.compile(checkpointer=checkpointer)
