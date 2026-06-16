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
    # Stalled but no human required (require_human_on_stall=False): the Arbiter
    # decides now. Without this the debate would loop gather→critique→gather
    # forever, since round_number stays >= max_rounds and never converges.
    if state["round_number"] >= state["max_rounds"]:
        return "arbitrate"
    return "gather_proposals"


def _route_after_validate(state: DebateState) -> str:
    if state.get("schedule") is not None:
        return "finalize"
    # Bound the arbitrate↔validate loop: after the cap, hand off the best-effort
    # schedule to finalize instead of retrying into recursion_limit.
    if state.get("validation_attempts", 0) >= state.get("max_validation_attempts", 3):
        return "finalize"
    return "arbitrate"


def build_graph(council: Council, api_key: str, db_path: str = "weekforge.db", require_human_on_stall: bool = True):
    """Build and compile the debate StateGraph with a SQLite checkpointer.

    Args:
        council: CrewAI Council (or MockCouncil for tests).
        api_key: Anthropic API key for convergence-check and validate nodes.
        db_path: SQLite database path. Use ":memory:" in tests.
        require_human_on_stall: When True (default), a council that fails to converge
            within max_rounds pauses for human input. When False, it auto-arbitrates
            and the run finishes unattended.

    Returns:
        A compiled LangGraph graph ready for .invoke() / .stream().
    """
    gather_proposals = make_gather_proposals_node(council)
    critique = make_critique_node(council)
    check_convergence = make_check_convergence_node(api_key, require_human_on_stall)
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
    # After a human intervenes, the Arbiter decides immediately — no more
    # debate rounds. This guarantees an exit: a stalled council pauses once
    # for human input, then the human's guidance drives a final arbitration.
    builder.add_edge("human_interrupt", "arbitrate")
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
