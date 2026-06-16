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
    result = node(state)
    assert result["arbiter_output"] is not None


def test_arbitrate_context_injects_prefs_busy_and_hard_constraints(base_state):
    captured = {}

    class RecordingCouncil:
        def arbitrate(self, context: str) -> str:
            captured["context"] = context
            return "[]"

    state = {
        **base_state,
        "proposals": {n: "p" for n in DEBATER_NAMES},
        "critiques": {n: "c" for n in DEBATER_NAMES},
        "round_number": 1,
        "preferences": Preferences(
            workday_start_hour=9, workday_end_hour=17, timezone="Australia/Sydney"
        ),
        "busy_blocks": [
            TimeBlock(start=_utc(2026, 6, 15, 10), end=_utc(2026, 6, 15, 11), label="Standup")
        ],
    }

    node = make_arbitrate_node(RecordingCouncil())
    node(state)
    ctx = captured["context"]

    # Real preference values injected (from _fmt_prefs)
    assert "Work hours 9:00–17:00" in ctx
    assert "max focus" in ctx
    # Fixed commitments injected (from _fmt_busy)
    assert "Standup" in ctx
    # Hard constraints present
    assert "HARD SCHEDULING CONSTRAINTS" in ctx
    assert "same local date" in ctx
    assert "23:59" in ctx


class _CaptureCouncil:
    """Council stub that records the context passed to arbitrate()."""

    def __init__(self):
        self.last_context = None

    def arbitrate(self, context: str) -> str:
        self.last_context = context
        return "[]"


class _ScriptedCouncil:
    """Returns a broken schedule until it sees SCOPED REPAIR, then a fixed one."""

    def __init__(self, broken: str, fixed: str):
        self.broken = broken
        self.fixed = fixed

    def arbitrate(self, context: str) -> str:
        return self.fixed if "SCOPED REPAIR" in context else self.broken


def _echo_anthropic():
    """Patch target that echoes the Arbiter output back out of the validate extraction call."""

    def _create(**kwargs):
        content = kwargs["messages"][0]["content"]
        raw = content.split("Arbiter output:\n", 1)[1].split("\n\nExtract", 1)[0].strip()
        resp = MagicMock()
        resp.content[0].text = raw
        return resp

    client = MagicMock()
    client.messages.create.side_effect = _create
    return client


def test_arbitrate_injects_frozen_blocks_and_budget(base_state):
    council = _CaptureCouncil()
    frozen = [
        TimeBlock(
            start=_utc(2026, 6, 15, 9),
            end=_utc(2026, 6, 15, 11),
            label="Write report",
            task_id="t1",
        )
    ]
    state = {
        **base_state,
        "frozen_blocks": frozen,
        "validation_error": "BROKEN (re-place these only):\n  - Review PRs: before work window 09:00",
        "round_number": 1,
        "preferences": Preferences(
            workday_start_hour=9,
            workday_end_hour=18,
            max_focus_minutes_per_day=360,
            timezone=None,
        ),
    }

    make_arbitrate_node(council)(state)
    ctx = council.last_context

    assert "SCOPED REPAIR" in ctx
    assert "Write report" in ctx
    assert "Do NOT move" in ctx
    assert "240min left" in ctx
    assert "broken" in ctx.lower()


def test_arbitrate_first_pass_has_no_scoped_section(base_state):
    council = _CaptureCouncil()
    state = {**base_state, "round_number": 0}
    make_arbitrate_node(council)(state)
    assert "SCOPED REPAIR" not in council.last_context


def test_arbitrate_non_retry_with_frozen_blocks_has_no_scoped_section(base_state):
    council = _CaptureCouncil()
    state = {
        **base_state,
        "round_number": 1,
        "frozen_blocks": [
            TimeBlock(
                start=_utc(2026, 6, 15, 9),
                end=_utc(2026, 6, 15, 11),
                label="Write report",
                task_id="t1",
            )
        ],
    }
    make_arbitrate_node(council)(state)
    assert "SCOPED REPAIR" not in council.last_context


# ── validate ────────────────────────────────────────────────────────────────


def test_scoped_repair_converges_in_one_retry(base_state, mock_api_key):
    # t1 valid both times (09:00–11:00); t2 broken first (07:00–08:00), fixed on retry (11:00–12:00).
    broken = (
        '[{"start": "2026-06-15T09:00:00+00:00", "end": "2026-06-15T11:00:00+00:00",'
        ' "label": "Write report", "task_id": "t1"},'
        ' {"start": "2026-06-15T07:00:00+00:00", "end": "2026-06-15T08:00:00+00:00",'
        ' "label": "Review PRs", "task_id": "t2"}]'
    )
    fixed = (
        '[{"start": "2026-06-15T11:00:00+00:00", "end": "2026-06-15T12:00:00+00:00",'
        ' "label": "Review PRs", "task_id": "t2"}]'
    )
    council = _ScriptedCouncil(broken, fixed)
    state = {
        **base_state,
        "tasks": [
            Task(id="t1", title="Write report", estimated_minutes=120, priority=1),
            Task(id="t2", title="Review PRs", estimated_minutes=60, priority=2),
        ],
        "busy_blocks": [],
        "preferences": Preferences(
            workday_start_hour=9, workday_end_hour=18, max_focus_minutes_per_day=600, timezone=None
        ),
        "round_number": 1,
        "validation_attempts": 0,
        "proposals": {},
        "critiques": {},
    }

    arbitrate = make_arbitrate_node(council)
    with patch("weekforge.debate.nodes.Anthropic", return_value=_echo_anthropic()):
        validate = make_validate_node(mock_api_key)

        # Round 1: broken -> validation fails, t1 frozen, t2 flagged.
        state = {**state, **arbitrate(state)}
        r1 = validate(state)
        assert r1["schedule"] is None
        assert [b.label for b in r1["frozen_blocks"]] == ["Write report"]
        state = {**state, **r1}

        # Round 2: arbiter sees SCOPED REPAIR -> fixes only t2 -> validation passes.
        state = {**state, **arbitrate(state)}
        r2 = validate(state)

    assert r2["schedule"] is not None
    labels = {b.label for b in r2["schedule"].blocks}
    assert labels == {"Write report", "Review PRs"}
    # t1 was left exactly where it was (no oscillation)
    t1 = next(b for b in r2["schedule"].blocks if b.label == "Write report")
    assert t1.start.hour == 9 and t1.end.hour == 11

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


def test_validate_success_clears_stale_best_effort_metadata(base_state, mock_api_key):
    valid_json_output = (
        '[{"start": "2026-06-15T09:00:00+00:00", "end": "2026-06-15T10:00:00+00:00",'
        ' "label": "Write report", "task_id": "t1"}]'
    )
    stale_best_effort = Schedule(
        blocks=[TimeBlock(start=_utc(2026, 6, 15, 11), end=_utc(2026, 6, 15, 12), label="stale")]
    )
    state = {
        **base_state,
        "arbiter_output": valid_json_output,
        "round_number": 2,
        "best_effort_schedule": stale_best_effort,
        "validation_warnings": "Schedule failed semantic validation:\n  - stale warning",
        "degraded": True,
    }

    with patch("weekforge.debate.nodes.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_response = MagicMock()
        mock_response.content[0].text = valid_json_output
        mock_client.messages.create.return_value = mock_response

        node = make_validate_node(mock_api_key)
        result = node(state)

    assert isinstance(result["schedule"], Schedule)
    assert result["validation_error"] is None
    assert result["degraded"] is False
    assert result["validation_warnings"] is None
    assert result["best_effort_schedule"] is None


def test_validate_sets_error_on_semantic_violation(base_state, mock_api_key):
    # Block at 02:00 UTC with timezone=None (UTC fallback), workday_start=9 → violation
    out_of_hours_json = (
        '[{"start": "2026-06-15T02:00:00+00:00", "end": "2026-06-15T03:00:00+00:00",'
        ' "label": "Night work", "task_id": "t1"}]'
    )
    state = {
        **base_state,
        "arbiter_output": out_of_hours_json,
        "round_number": 1,
        "preferences": Preferences(workday_start_hour=9, timezone=None),
    }

    with patch("weekforge.debate.nodes.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_response = MagicMock()
        mock_response.content[0].text = out_of_hours_json
        mock_client.messages.create.return_value = mock_response

        node = make_validate_node(mock_api_key)
        result = node(state)

    assert result["schedule"] is None
    assert result["validation_error"] is not None
    assert "semantic validation" in result["validation_error"]
    assert len(result["transcript"]) == 1
    assert result["transcript"][0]["event_type"] == "validation_fail"
    # The visible transcript must surface WHICH rule failed, not just a generic line.
    assert "before work window" in result["transcript"][0]["content"]
    assert "Night work" in result["transcript"][0]["content"]


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


def test_validate_semantic_fail_returns_best_effort_and_increments_attempts(base_state, mock_api_key):
    out_of_hours_json = (
        '[{"start": "2026-06-15T02:00:00+00:00", "end": "2026-06-15T03:00:00+00:00",'
        ' "label": "Night work", "task_id": "t1"}]'
    )
    state = {
        **base_state,
        "arbiter_output": out_of_hours_json,
        "round_number": 1,
        "preferences": Preferences(workday_start_hour=9, timezone=None),
        "validation_attempts": 0,
    }

    with patch("weekforge.debate.nodes.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_response = MagicMock()
        mock_response.content[0].text = out_of_hours_json
        mock_client.messages.create.return_value = mock_response

        node = make_validate_node(mock_api_key)
        result = node(state)

    assert result["schedule"] is None
    assert isinstance(result["best_effort_schedule"], Schedule)
    assert len(result["best_effort_schedule"].blocks) == 1
    assert result["validation_attempts"] == 1
    assert result["validation_warnings"] == result["validation_error"]


def test_validate_freezes_valid_blocks_and_scopes_feedback(base_state, mock_api_key):
    # t1 valid (09:00–11:00), t2 broken (07:00–08:00 before work window).
    two_blocks_json = (
        '[{"start": "2026-06-15T09:00:00+00:00", "end": "2026-06-15T11:00:00+00:00",'
        ' "label": "Write report", "task_id": "t1"},'
        ' {"start": "2026-06-15T07:00:00+00:00", "end": "2026-06-15T08:00:00+00:00",'
        ' "label": "Review PRs", "task_id": "t2"}]'
    )
    state = {
        **base_state,
        "tasks": [
            Task(id="t1", title="Write report", estimated_minutes=120, priority=1),
            Task(id="t2", title="Review PRs", estimated_minutes=60, priority=2),
        ],
        "busy_blocks": [],
        "preferences": Preferences(workday_start_hour=9, workday_end_hour=18, timezone=None),
        "arbiter_output": two_blocks_json,
        "round_number": 1,
        "validation_attempts": 0,
    }

    with patch("weekforge.debate.nodes.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_response = MagicMock()
        mock_response.content[0].text = two_blocks_json
        mock_client.messages.create.return_value = mock_response

        node = make_validate_node(mock_api_key)
        result = node(state)

    assert result["schedule"] is None
    # the valid block is frozen, the broken one is not
    assert len(result["frozen_blocks"]) == 1
    assert result["frozen_blocks"][0].label == "Write report"
    # feedback names both buckets and the offending rule
    fb = result["validation_error"]
    assert "FROZEN" in fb and "BROKEN" in fb
    assert "Write report" in fb and "Review PRs" in fb
    assert "before work window" in fb
    assert "focus budget" in fb.lower()
    assert result["validation_attempts"] == 1


def test_validate_success_clears_frozen_blocks(base_state, mock_api_key):
    valid_json = (
        '[{"start": "2026-06-15T09:00:00+00:00", "end": "2026-06-15T10:00:00+00:00",'
        ' "label": "Task t1", "task_id": "t1"}]'
    )
    state = {**base_state, "arbiter_output": valid_json, "round_number": 1,
             "preferences": Preferences(workday_start_hour=9, workday_end_hour=18, timezone=None)}

    with patch("weekforge.debate.nodes.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_response = MagicMock()
        mock_response.content[0].text = valid_json
        mock_client.messages.create.return_value = mock_response

        node = make_validate_node(mock_api_key)
        result = node(state)

    assert result["schedule"] is not None
    assert result["frozen_blocks"] == []


def test_validate_parse_fail_increments_attempts_without_best_effort(base_state, mock_api_key):
    state = {**base_state, "arbiter_output": "garbage", "round_number": 1, "validation_attempts": 2}

    with patch("weekforge.debate.nodes.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_response = MagicMock()
        mock_response.content[0].text = "this is not valid json {"
        mock_client.messages.create.return_value = mock_response

        node = make_validate_node(mock_api_key)
        result = node(state)

    assert result["schedule"] is None
    assert result["validation_attempts"] == 3
    # Parse failure must NOT overwrite a previously-captured best-effort schedule.
    assert "best_effort_schedule" not in result


# ── finalize ────────────────────────────────────────────────────────────────

def test_finalize_returns_schedule_unchanged(base_state):
    block = TimeBlock(start=_utc(2026, 6, 15, 9), end=_utc(2026, 6, 15, 10), label="Work")
    schedule = Schedule(blocks=[block])
    state = {**base_state, "schedule": schedule}
    result = finalize_node(state)
    assert result["schedule"] is schedule


def test_finalize_clean_schedule_clears_stale_best_effort_metadata(base_state):
    block = TimeBlock(start=_utc(2026, 6, 15, 9), end=_utc(2026, 6, 15, 10), label="Work")
    schedule = Schedule(blocks=[block])
    stale_best_effort = Schedule(
        blocks=[TimeBlock(start=_utc(2026, 6, 15, 11), end=_utc(2026, 6, 15, 12), label="stale")]
    )
    state = {
        **base_state,
        "schedule": schedule,
        "degraded": True,
        "validation_warnings": "Schedule failed semantic validation:\n  - stale warning",
        "best_effort_schedule": stale_best_effort,
    }

    result = finalize_node(state)

    assert result["schedule"] is schedule
    assert result["degraded"] is False
    assert result["validation_warnings"] is None
    assert result["best_effort_schedule"] is None


def test_finalize_delivers_best_effort_when_no_valid_schedule(base_state):
    best = Schedule(blocks=[TimeBlock(start=_utc(2026, 6, 15, 9), end=_utc(2026, 6, 15, 10), label="x")])
    state = {
        **base_state,
        "schedule": None,
        "best_effort_schedule": best,
        "validation_error": "Schedule failed semantic validation:\n  - Block 'x': ...",
        "max_validation_attempts": 3,
        "round_number": 2,
    }
    result = finalize_node(state)
    assert result["schedule"] is best
    assert result["degraded"] is True
    assert result["validation_warnings"]  # non-empty string
    assert result["transcript"] == [
        {
            "round": 2,
            "speaker": "System",
            "content": (
                "Exceeded 3 validation retries; returning best-effort schedule "
                "(may contain semantic issues)."
            ),
            "event_type": "system",
        }
    ]


def test_finalize_logs_validation_attempts(base_state, caplog):
    import logging

    state = {**base_state, "schedule": Schedule(blocks=[]), "validation_attempts": 2}
    with caplog.at_level(logging.INFO):
        finalize_node(state)
    assert "validation_attempts=2" in caplog.text


def test_finalize_uses_semantic_warnings_for_best_effort_after_later_parse_error(base_state):
    best = Schedule(blocks=[TimeBlock(start=_utc(2026, 6, 15, 9), end=_utc(2026, 6, 15, 10), label="x")])
    semantic_warning = "Schedule failed semantic validation:\n  - Block 'x': outside work window"
    parse_error = "Expecting value: line 1 column 1 (char 0)"
    state = {
        **base_state,
        "schedule": None,
        "best_effort_schedule": best,
        "validation_warnings": semantic_warning,
        "validation_error": parse_error,
        "max_validation_attempts": 3,
        "round_number": 3,
    }
    result = finalize_node(state)
    assert result["schedule"] is best
    assert result["validation_warnings"] == semantic_warning
    assert result["validation_warnings"] != parse_error
    assert result["transcript"][0]["round"] == 3
    assert result["transcript"][0]["speaker"] == "System"
    assert result["transcript"][0]["event_type"] == "system"


def test_finalize_returns_none_when_no_schedule_and_no_best_effort(base_state):
    state = {**base_state, "schedule": None, "best_effort_schedule": None}
    result = finalize_node(state)
    assert result["schedule"] is None
    assert result.get("degraded") in (None, False)


def test_fmt_tasks_includes_preferred_days_and_deadline(base_state):
    from weekforge.debate.nodes import _fmt_tasks

    state = {
        **base_state,
        "tasks": [
            Task(
                id="t1",
                title="Review PRs",
                estimated_minutes=90,
                priority=2,
                deadline=datetime(2026, 6, 18, 23, 59, tzinfo=timezone.utc),
                preferred_days=["Wed", "Fri"],
            )
        ],
    }
    result = _fmt_tasks(state)
    assert "deadline" in result
    assert "Thu" in result        # Jun 18 2026 is a Thursday
    assert "prefer" in result
    assert "Wed" in result
    assert "Fri" in result


def test_fmt_tasks_includes_remark_when_present(base_state):
    from weekforge.debate.nodes import _fmt_tasks

    state = {
        **base_state,
        "tasks": [
            Task(
                id="t1",
                title="Write report",
                estimated_minutes=120,
                priority=1,
                remark="Do this first thing in the morning, before emails",
            )
        ],
    }
    result = _fmt_tasks(state)
    assert "Do this first thing in the morning" in result
    assert "note:" in result


def test_fmt_tasks_omits_note_segment_when_remark_is_none(base_state):
    from weekforge.debate.nodes import _fmt_tasks

    state = {**base_state, "tasks": [Task(id="t1", title="Write report", estimated_minutes=60, priority=2)]}
    result = _fmt_tasks(state)
    assert "note:" not in result


def test_fmt_tasks_escapes_quotes_in_remark(base_state):
    from weekforge.debate.nodes import _fmt_tasks

    state = {
        **base_state,
        "tasks": [
            Task(id="t1", title="Write report", estimated_minutes=60, priority=1,
                 remark='Do "urgent" work first')
        ],
    }
    result = _fmt_tasks(state)
    assert 'note: "Do \\"urgent\\" work first"' in result


def test_fmt_tasks_escapes_backslashes_in_remark(base_state):
    from weekforge.debate.nodes import _fmt_tasks

    state = {
        **base_state,
        "tasks": [
            Task(id="t1", title="Write report", estimated_minutes=60, priority=1,
                 remark=r"path\to\file")
        ],
    }
    result = _fmt_tasks(state)
    assert r'note: "path\\to\\file"' in result


def test_fmt_busy_converts_utc_to_local_timezone(base_state):
    from weekforge.debate.nodes import _fmt_busy

    state = {
        **base_state,
        "preferences": Preferences(timezone="Australia/Sydney"),
        "busy_blocks": [
            TimeBlock(
                start=datetime(2026, 6, 15, 12, 0, tzinfo=timezone.utc),
                end=datetime(2026, 6, 15, 13, 0, tzinfo=timezone.utc),
                label="Meeting",
            )
        ],
    }
    result = _fmt_busy(state)
    # Jun 2026 → AEST (UTC+10), so 12:00 UTC = 22:00 local
    assert "22:00" in result
    assert "local" in result


def test_validate_merges_frozen_blocks_from_state(mock_api_key):
    # State already froze a valid Write-report block. The model (mis)behaves and outputs
    # ONLY a freshly-placed Review block. validate must re-attach the frozen block by code.
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("Australia/Sydney")
    frozen = TimeBlock(start=datetime(2026, 6, 16, 9, tzinfo=tz),
                       end=datetime(2026, 6, 16, 11, tzinfo=tz), label="Write report", task_id="t1")
    model_only_broken = (
        '[{"start": "2026-06-16T11:00:00", "end": "2026-06-16T12:00:00",'
        ' "label": "Review PRs", "task_id": "t2"}]'
    )
    state = {
        "tasks": [
            Task(id="t1", title="Write report", estimated_minutes=120, priority=1),
            Task(id="t2", title="Review PRs", estimated_minutes=60, priority=2),
        ],
        "busy_blocks": [],
        "preferences": Preferences(workday_start_hour=9, workday_end_hour=18, timezone="Australia/Sydney"),
        "window_start": datetime(2026, 6, 16, 9, tzinfo=tz),
        "window_end": datetime(2026, 6, 21, 18, tzinfo=tz),
        "frozen_blocks": [frozen],
        "arbiter_output": model_only_broken,
        "round_number": 2,
        "validation_attempts": 1,
        "max_rounds": 3,
        "proposals": {}, "critiques": {}, "converged": False,
        "interrupt_reason": None, "human_input": None,
        "schedule": None, "validation_error": "prev", "transcript": [],
    }

    with patch("weekforge.debate.nodes.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_response = MagicMock()
        mock_response.content[0].text = model_only_broken
        mock_client.messages.create.return_value = mock_response

        result = make_validate_node(mock_api_key)(state)

    assert result["schedule"] is not None
    labels = {b.label for b in result["schedule"].blocks}
    assert labels == {"Write report", "Review PRs"}   # frozen merged back by code


def test_validate_drops_model_reemission_of_frozen(mock_api_key):
    # Model disobeys and re-emits the frozen task with a CHANGED (bad) time. Code must keep
    # the frozen version, not the model's.
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("Australia/Sydney")
    frozen = TimeBlock(start=datetime(2026, 6, 16, 9, tzinfo=tz),
                       end=datetime(2026, 6, 16, 11, tzinfo=tz), label="Write report", task_id="t1")
    model = (
        '[{"start": "2026-06-16T07:00:00", "end": "2026-06-16T09:00:00",'   # moved frozen (bad)
        ' "label": "Write report", "task_id": "t1"},'
        ' {"start": "2026-06-16T11:00:00", "end": "2026-06-16T12:00:00",'
        ' "label": "Review PRs", "task_id": "t2"}]'
    )
    state = {
        "tasks": [Task(id="t1", title="W", estimated_minutes=120),
                  Task(id="t2", title="R", estimated_minutes=60)],
        "busy_blocks": [],
        "preferences": Preferences(workday_start_hour=9, workday_end_hour=18, timezone="Australia/Sydney"),
        "window_start": datetime(2026, 6, 16, 9, tzinfo=tz),
        "window_end": datetime(2026, 6, 21, 18, tzinfo=tz),
        "frozen_blocks": [frozen],
        "arbiter_output": model, "round_number": 2, "validation_attempts": 1, "max_rounds": 3,
        "proposals": {}, "critiques": {}, "converged": False,
        "interrupt_reason": None, "human_input": None,
        "schedule": None, "validation_error": "prev", "transcript": [],
    }
    with patch("weekforge.debate.nodes.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_response = MagicMock()
        mock_response.content[0].text = model
        mock_client.messages.create.return_value = mock_response
        result = make_validate_node(mock_api_key)(state)

    assert result["schedule"] is not None
    write = next(b for b in result["schedule"].blocks if b.label == "Write report")
    assert write.start.astimezone(tz).hour == 9   # frozen version kept, model's 07:00 dropped


def test_validate_relocalizes_wrong_offset_to_correct_local(mock_api_key):
    # Model emits 09:00+11:00 (summer offset) for a JUNE Sydney week (real offset +10).
    # After re-localization it must read as 09:00 local, NOT 08:00 → valid, no false "before work window".
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("Australia/Sydney")
    wrong_offset_json = (
        '[{"start": "2026-06-16T09:00:00+11:00", "end": "2026-06-16T11:00:00+11:00",'
        ' "label": "Write report", "task_id": "t1"}]'
    )
    state = {
        "tasks": [Task(id="t1", title="Write report", estimated_minutes=120, priority=1)],
        "busy_blocks": [],
        "preferences": Preferences(workday_start_hour=9, workday_end_hour=18, timezone="Australia/Sydney"),
        "window_start": datetime(2026, 6, 16, 9, tzinfo=tz),
        "window_end": datetime(2026, 6, 21, 18, tzinfo=tz),
        "arbiter_output": wrong_offset_json,
        "round_number": 1,
        "validation_attempts": 0,
        "max_rounds": 3,
        "proposals": {},
        "critiques": {},
        "converged": False,
        "interrupt_reason": None,
        "human_input": None,
        "schedule": None,
        "validation_error": None,
        "transcript": [],
    }

    with patch("weekforge.debate.nodes.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_response = MagicMock()
        mock_response.content[0].text = wrong_offset_json
        mock_client.messages.create.return_value = mock_response

        result = make_validate_node(mock_api_key)(state)

    assert result["schedule"] is not None        # passes: re-localized to 09:00 local, in window
    block = result["schedule"].blocks[0]
    assert block.start.astimezone(tz).hour == 9   # 09:00 local, not 08:00
