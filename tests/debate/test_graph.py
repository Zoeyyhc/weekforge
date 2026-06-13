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
