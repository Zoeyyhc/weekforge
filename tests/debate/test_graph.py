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
    state = {"converged": False, "interrupt_reason": None, "round_number": 1, "max_rounds": 3}
    assert _route_after_convergence_check(state) == "gather_proposals"


def test_route_stalled_goes_to_herald_before_the_interrupt():
    # The Herald summarises the divided council before the vote pauses, so its
    # distillation is in state when human_interrupt fires.
    state = {"converged": False, "interrupt_reason": "Council stalled after 3 rounds."}
    assert _route_after_convergence_check(state) == "herald"


def test_route_stalled_without_human_goes_to_arbitrate():
    """require_human_on_stall=False: check_convergence leaves interrupt_reason unset
    even at max_rounds, so the router sends the stalled debate to the Arbiter rather
    than looping back to gather_proposals forever."""
    state = {"converged": False, "interrupt_reason": None, "round_number": 3, "max_rounds": 3}
    assert _route_after_convergence_check(state) == "arbitrate"


def test_route_valid_schedule_goes_to_finalize():
    from weekforge.models import Schedule
    state = {"schedule": Schedule(), "validation_error": None}
    assert _route_after_validate(state) == "finalize"


def test_route_invalid_schedule_goes_to_arbitrate():
    state = {"schedule": None, "validation_error": "JSONDecodeError: unexpected token"}
    assert _route_after_validate(state) == "arbitrate"


def test_route_retries_arbitrate_when_under_cap():
    state = {"schedule": None, "validation_attempts": 1, "max_validation_attempts": 3}
    assert _route_after_validate(state) == "arbitrate"


def test_route_finalizes_when_attempts_reach_cap():
    state = {"schedule": None, "validation_attempts": 3, "max_validation_attempts": 3}
    assert _route_after_validate(state) == "finalize"


# ── Graph structure tests ───────────────────────────────────────────────────

def test_build_graph_returns_compiled_graph(mock_council, mock_api_key):
    from langgraph.graph.state import CompiledStateGraph
    graph = build_graph(council=mock_council, api_key=mock_api_key, db_path=":memory:")
    assert isinstance(graph, CompiledStateGraph)


def test_build_graph_has_expected_nodes(mock_council, mock_api_key):
    graph = build_graph(council=mock_council, api_key=mock_api_key, db_path=":memory:")
    node_names = set(graph.nodes.keys())
    expected = {
        "gather_proposals", "critique", "check_convergence", "herald",
        "human_interrupt", "arbitrate", "validate", "finalize",
    }
    assert expected.issubset(node_names)


def test_herald_routes_to_human_interrupt(mock_council, mock_api_key):
    """The Herald summarises, then hands off to the vote — it never decides itself."""
    graph = build_graph(council=mock_council, api_key=mock_api_key, db_path=":memory:")
    targets = {
        edge.target
        for edge in graph.get_graph().edges
        if edge.source == "herald"
    }
    assert targets == {"human_interrupt"}


def test_human_interrupt_routes_straight_to_arbitrate(mock_council, mock_api_key):
    """After a human intervenes the Arbiter decides at once — no extra rounds.

    This guarantees the debate terminates: a stall pauses once for human
    input, then arbitrates. It must NOT loop back to gather_proposals.
    """
    graph = build_graph(council=mock_council, api_key=mock_api_key, db_path=":memory:")
    targets = {
        edge.target
        for edge in graph.get_graph().edges
        if edge.source == "human_interrupt"
    }
    assert targets == {"arbitrate"}
