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
    with (
        patch("weekforge.debate.debaters.CrewTask") as MockTask,
        patch("weekforge.debate.debaters.Crew") as MockCrew,
    ):
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
        # task was constructed with the correct agent
        assert MockTask.call_args.kwargs["agent"] is fake_agent


def test_council_critique_calls_correct_agent():
    with (
        patch("weekforge.debate.debaters.CrewTask") as MockTask,
        patch("weekforge.debate.debaters.Crew") as MockCrew,
    ):
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
        assert MockTask.call_args.kwargs["agent"] is fake_agent


def test_council_arbitrate_calls_arbiter():
    with (
        patch("weekforge.debate.debaters.CrewTask") as MockTask,
        patch("weekforge.debate.debaters.Crew") as MockCrew,
    ):
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
        assert MockTask.call_args.kwargs["agent"] is fake_agent


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


def test_build_council_default_shares_one_model():
    with (
        patch("weekforge.debate.debaters.LLM") as MockLLM,
        patch("weekforge.debate.debaters.Agent", side_effect=lambda **kw: kw),
    ):
        build_council(api_key="k", model="anthropic/claude-haiku-x")
        assert MockLLM.call_count == 1


def test_build_council_separate_arbiter_model():
    base_llm = MagicMock(name="base")
    arb_llm = MagicMock(name="arb")

    def _llm(model, api_key):
        return arb_llm if "sonnet" in model else base_llm

    with (
        patch("weekforge.debate.debaters.LLM", side_effect=_llm),
        patch("weekforge.debate.debaters.Agent", side_effect=lambda **kw: kw),
    ):
        council = build_council(
            api_key="k",
            model="anthropic/claude-haiku-x",
            arbiter_model="anthropic/claude-sonnet-x",
        )
        assert council.arbiter["llm"] is arb_llm
        assert council.deadline_hawk["llm"] is base_llm
        assert council.energy_guardian["llm"] is base_llm
        assert council.focus_batcher["llm"] is base_llm
