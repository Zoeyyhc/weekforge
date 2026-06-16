# Arbiter Sonnet + Scoped-Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the `arbitrate↔validate` retry loop from oscillating ("fix block A, break block B") by freezing already-valid blocks and asking the Arbiter to re-place only the broken ones, and give the Arbiter its own (Sonnet) model line.

**Architecture:** Keep the LangGraph structure unchanged. (1) Extract the semantic guardrail into a new `validation.py` that returns a *per-block* report (which blocks are valid vs broken, plus day-level focus-cap errors). (2) The `validate` node turns that report into scoped-repair feedback and stashes the valid blocks in new state `frozen_blocks`. (3) The `arbitrate` node, on a retry, injects those frozen blocks as fixed/occupied time plus a per-day remaining focus budget and instructs the model to only re-schedule the broken tasks. (4) `build_council` gains a separate `arbiter_model`. (5) `finalize` logs the retry count. The `max_validation_attempts` cap and `degraded` best-effort fallback are untouched.

**Tech Stack:** Python 3.12+ (uv), LangGraph, CrewAI, Anthropic SDK, pytest. Pure-data models via Pydantic (`weekforge.models`).

---

## File Structure

- **Create** `src/weekforge/debate/validation.py` — pure semantic validation: `BlockReport`, `ValidationReport`, `classify_blocks()`, `remaining_focus_budget()`, and a thin `validate_blocks()` wrapper (moved out of `nodes.py`). No I/O.
- **Modify** `src/weekforge/debate/nodes.py` — import the validation helpers (re-export `validate_blocks` so `from weekforge.debate.nodes import validate_blocks` still works); delete the inline `validate_blocks`; rework `make_validate_node` (emit `frozen_blocks` + scoped feedback) and `make_arbitrate_node` (inject frozen blocks + budget + only-fix); add a log line to `finalize_node`.
- **Modify** `src/weekforge/debate/state.py` — add `frozen_blocks` field.
- **Modify** `src/weekforge/debate/debaters.py` — `build_council(..., arbiter_model=None)`.
- **Modify** `src/weekforge/api/server.py` — read `WEEKFORGE_ARBITER_MODEL`, pass to `build_council`.
- **Modify** `CLAUDE.md` — document `WEEKFORGE_ARBITER_MODEL`.
- **Create** `tests/debate/test_validation.py` — `classify_blocks` / `remaining_focus_budget` unit tests.
- **Modify** `tests/debate/test_nodes.py` — validate + arbitrate + finalize behavior.
- **Modify** `tests/debate/test_debaters.py` — separate arbiter model.
- **Create** `tests/api/test_server_model.py` — `build_app` passes `arbiter_model`.

> **Note on model ids:** never hardcode a Sonnet id in code. The id arrives via the `WEEKFORGE_ARBITER_MODEL` env var. In tests use placeholder strings like `"anthropic/claude-sonnet-x"`.

> **Error-string compatibility:** `classify_blocks` must reproduce the existing per-rule error strings **verbatim** (e.g. `"before work window"`, `"overlaps with busy"`, `"spans midnight"`, `"exceeds {N}min/day limit"`). The existing `tests/debate/test_validate_blocks.py` asserts on these substrings and must stay green.

---

## Task 1: Extract `classify_blocks` into `validation.py`

Moves the guardrail into a pure module that reports *per block*. `validate_blocks` becomes a thin wrapper so existing callers/tests are unaffected.

**Files:**
- Create: `src/weekforge/debate/validation.py`
- Modify: `src/weekforge/debate/nodes.py` (remove inline `validate_blocks`, add import)
- Create: `tests/debate/test_validation.py`

- [ ] **Step 1: Write the failing test**

Create `tests/debate/test_validation.py`:

```python
"""Tests for the per-block semantic classifier."""

from __future__ import annotations

from datetime import datetime, timezone

from weekforge.debate.validation import classify_blocks, remaining_focus_budget
from weekforge.models import Preferences, Task, TimeBlock


def _utc(h, m=0, *, day=15):
    return datetime(2026, 6, day, h, m, tzinfo=timezone.utc)


def _block(label, start_h, end_h, *, task_id=None):
    return TimeBlock(start=_utc(start_h), end=_utc(end_h), label=label, task_id=task_id)


def _prefs(**kw):
    base = dict(workday_start_hour=9, workday_end_hour=18, max_focus_minutes_per_day=360)
    base.update(kw)
    return Preferences(**base)


def test_all_valid_report_is_ok_and_all_frozen():
    blocks = [_block("Deep work", 9, 11, task_id="t1")]
    report = classify_blocks(blocks, [Task(id="t1", title="X", estimated_minutes=120)], [], _prefs())
    assert report.ok is True
    assert report.frozen == blocks
    assert report.to_fix == []


def test_one_broken_block_others_frozen():
    good = _block("Good", 9, 11, task_id="t1")
    bad = _block("Early", 7, 8, task_id="t1")  # before work window
    report = classify_blocks([good, bad], [Task(id="t1", title="X", estimated_minutes=60)], [], _prefs())
    assert report.ok is False
    assert report.frozen == [good]
    assert [r.block for r in report.to_fix] == [bad]
    assert "before work window" in report.to_fix[0].errors[0]


def test_over_cap_day_marks_all_that_days_blocks_to_fix():
    # 4×120 = 480 > 360 cap, all within window → day-level violation
    blocks = [
        _block("A", 9, 11, task_id="t1"),
        _block("B", 11, 13, task_id="t1"),
        _block("C", 13, 15, task_id="t1"),
        _block("D", 15, 17, task_id="t1"),
    ]
    report = classify_blocks(blocks, [Task(id="t1", title="X", estimated_minutes=120)], [], _prefs(workday_end_hour=20))
    assert report.ok is False
    assert report.frozen == []          # whole over-cap day is movable
    assert len(report.to_fix) == 4
    assert any("focus cap" in r.day_reasons[0] for r in report.to_fix)


def test_remaining_focus_budget_subtracts_frozen_minutes():
    frozen = [_block("A", 9, 11, task_id="t1")]  # 120 min on Jun 15
    budget = remaining_focus_budget(frozen, _prefs(max_focus_minutes_per_day=360))
    assert budget[datetime(2026, 6, 15).date()] == 240
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/debate/test_validation.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'weekforge.debate.validation'`

- [ ] **Step 3: Create `validation.py`**

Create `src/weekforge/debate/validation.py`:

```python
"""Pure semantic validation for scheduled time blocks. No I/O, no LLM."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timezone
from zoneinfo import ZoneInfo

from weekforge.models import Preferences, Task, TimeBlock


@dataclass
class BlockReport:
    """Per-block validation result."""

    block: TimeBlock
    errors: list[str] = field(default_factory=list)       # rule 1/2/3 own violations
    day_reasons: list[str] = field(default_factory=list)  # rule 4 (inherited from over-cap day)

    @property
    def frozen(self) -> bool:
        """A block is freezable only if it has no own violations and is not on an over-cap day."""
        return not self.errors and not self.day_reasons


@dataclass
class ValidationReport:
    reports: list[BlockReport]   # one per input block, input order preserved
    day_errors: list[str]        # rule 4 day-level violations

    @property
    def ok(self) -> bool:
        return not self.day_errors and all(r.frozen for r in self.reports)

    @property
    def frozen(self) -> list[TimeBlock]:
        return [r.block for r in self.reports if r.frozen]

    @property
    def to_fix(self) -> list[BlockReport]:
        return [r for r in self.reports if not r.frozen]


def _tz(preferences: Preferences):
    return ZoneInfo(preferences.timezone) if preferences.timezone else timezone.utc


def classify_blocks(
    blocks: list[TimeBlock],
    tasks: list[Task],
    busy_blocks: list[TimeBlock],
    preferences: Preferences,
) -> ValidationReport:
    """Classify each block as valid (freezable) or broken, with reasons."""
    tz = _tz(preferences)
    known_ids = {t.id for t in tasks}
    reports = [BlockReport(block=b) for b in blocks]
    minutes_per_day: dict[date, int] = {}
    block_local_day: list[date] = []

    for rep in reports:
        block = rep.block
        local_start = block.start.astimezone(tz)
        local_end = block.end.astimezone(tz)

        # Rule 1: task_id must be known or None
        if block.task_id is not None and block.task_id not in known_ids:
            rep.errors.append(f"Block '{block.label}': unknown task_id '{block.task_id}'")

        # Rule 2: one local day + inside the work window
        cross_day = local_start.date() != local_end.date()
        if cross_day:
            rep.errors.append(
                f"Block '{block.label}': spans midnight "
                f"(starts {local_start.strftime('%a %d %b')}, "
                f"ends {local_end.strftime('%a %d %b')}); "
                f"focus blocks must stay within one day"
            )
        else:
            if local_start.hour + local_start.minute / 60 < preferences.workday_start_hour:
                rep.errors.append(
                    f"Block '{block.label}': starts {local_start.strftime('%H:%M')} local, "
                    f"before work window {preferences.workday_start_hour:02d}:00"
                )
            if preferences.workday_end_hour < 24:
                if local_end.hour + local_end.minute / 60 > preferences.workday_end_hour:
                    rep.errors.append(
                        f"Block '{block.label}': ends {local_end.strftime('%H:%M')} local, "
                        f"after work window {preferences.workday_end_hour:02d}:00"
                    )

        # Rule 3: no overlap with busy blocks
        for busy in busy_blocks:
            if block.start < busy.end and block.end > busy.start:
                busy_local = busy.start.astimezone(tz)
                busy_local_end = busy.end.astimezone(tz)
                rep.errors.append(
                    f"Block '{block.label}': overlaps with busy '{busy.label}' "
                    f"({busy_local.strftime('%H:%M')}–{busy_local_end.strftime('%H:%M')} local)"
                )

        day = local_start.date()
        block_local_day.append(day)
        minutes_per_day[day] = minutes_per_day.get(day, 0) + block.duration_minutes

    # Rule 4: daily focus cap (day-level)
    day_errors: list[str] = []
    over_cap_days: set[date] = set()
    for day, total in minutes_per_day.items():
        if total > preferences.max_focus_minutes_per_day:
            over_cap_days.add(day)
            day_errors.append(
                f"{day.strftime('%a %d %b')}: {total}min scheduled, "
                f"exceeds {preferences.max_focus_minutes_per_day}min/day limit"
            )

    for rep, day in zip(reports, block_local_day):
        if day in over_cap_days:
            rep.day_reasons.append(
                f"{day.strftime('%a %d %b')} is over the "
                f"{preferences.max_focus_minutes_per_day}min focus cap"
            )

    return ValidationReport(reports=reports, day_errors=day_errors)


def validate_blocks(
    blocks: list[TimeBlock],
    tasks: list[Task],
    busy_blocks: list[TimeBlock],
    preferences: Preferences,
) -> list[str]:
    """Flat list of every semantic error (back-compat wrapper over classify_blocks)."""
    report = classify_blocks(blocks, tasks, busy_blocks, preferences)
    errors: list[str] = []
    for rep in report.reports:
        errors.extend(rep.errors)
    errors.extend(report.day_errors)
    return errors


def remaining_focus_budget(
    frozen_blocks: list[TimeBlock],
    preferences: Preferences,
) -> dict[date, int]:
    """Per local day: focus-cap minus minutes already consumed by the frozen blocks."""
    tz = _tz(preferences)
    used: dict[date, int] = {}
    for b in frozen_blocks:
        day = b.start.astimezone(tz).date()
        used[day] = used.get(day, 0) + b.duration_minutes
    return {day: preferences.max_focus_minutes_per_day - mins for day, mins in used.items()}
```

- [ ] **Step 4: Re-point `nodes.py` at the new module**

In `src/weekforge/debate/nodes.py`, **delete** the entire inline `def validate_blocks(...)` function (currently around lines 70–136), and add the import alongside the existing model import (after the `from weekforge.models import ...` line):

```python
from weekforge.debate.validation import (
    ValidationReport,
    classify_blocks,
    remaining_focus_budget,
    validate_blocks,  # re-exported for back-compat: tests import it from here
)
```

(`validate_blocks` is now imported, not defined, in `nodes.py`. Keep the `date`/`timezone`/`ZoneInfo` imports — they're still used by the formatting helpers and the new node code.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_validation.py tests/debate/test_validate_blocks.py -q`
Expected: PASS (new classifier tests + the untouched `validate_blocks` guardrail tests).

- [ ] **Step 6: Commit**

```bash
git add src/weekforge/debate/validation.py src/weekforge/debate/nodes.py tests/debate/test_validation.py
git commit -m "refactor: extract per-block classify_blocks into validation.py

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `validate` node emits `frozen_blocks` + scoped-repair feedback

The validate node now classifies per block, freezes the valid ones, and writes a structured FROZEN/BROKEN + budget message.

**Files:**
- Modify: `src/weekforge/debate/state.py` (add `frozen_blocks`)
- Modify: `src/weekforge/debate/nodes.py` (`make_validate_node` + new `_scoped_repair_feedback` helper)
- Test: `tests/debate/test_nodes.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/debate/test_nodes.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/debate/test_nodes.py::test_validate_freezes_valid_blocks_and_scopes_feedback -q`
Expected: FAIL — `KeyError: 'frozen_blocks'` (node doesn't return it yet).

- [ ] **Step 3a: Add the state field**

In `src/weekforge/debate/state.py`, inside `DebateState`, add under the "Retry bound + best-effort fallback" section (next to `best_effort_schedule`):

```python
    frozen_blocks: NotRequired[list[TimeBlock]]   # validate writes valid blocks; arbitrate reads them on retry
```

(`NotRequired` and `TimeBlock` are already imported in `state.py`.)

- [ ] **Step 3b: Add the feedback helper + rework the validate node**

In `src/weekforge/debate/nodes.py`, add this helper just above `make_validate_node`:

```python
def _scoped_repair_feedback(report: ValidationReport, preferences: Preferences) -> str:
    """Human-readable FROZEN/BROKEN + per-day budget message for a failed validation."""
    tz = ZoneInfo(preferences.timezone) if preferences.timezone else timezone.utc
    lines = [
        "Schedule failed semantic validation. "
        "Keep the FROZEN blocks exactly as-is; only re-place the BROKEN ones.",
        "",
    ]
    frozen = report.frozen
    if frozen:
        lines.append("FROZEN (do not move, already valid):")
        for b in frozen:
            ls = b.start.astimezone(tz)
            le = b.end.astimezone(tz)
            lines.append(f"  - {b.label}: {ls.strftime('%a %H:%M')}–{le.strftime('%H:%M')} local")
    if report.to_fix:
        lines.append("BROKEN (re-place these only):")
        for rep in report.to_fix:
            reasons = rep.errors + rep.day_reasons
            lines.append(f"  - {rep.block.label}: {'; '.join(reasons)}")
    budget = remaining_focus_budget(frozen, preferences)
    if budget:
        lines.append("Daily focus budget remaining after FROZEN blocks:")
        for day in sorted(budget):
            lines.append(
                f"  - {day.strftime('%a %d %b')}: {budget[day]}min left "
                f"(cap {preferences.max_focus_minutes_per_day})"
            )
    return "\n".join(lines)
```

Then in `make_validate_node`, replace the semantic-validation branch. The current code calls `validate_blocks(...)` and builds `error_msg` from `errors`; replace that block (from `errors = validate_blocks(...)` through the `if errors:` return, and the success `return`) with:

```python
            report = classify_blocks(
                blocks,
                state["tasks"],
                state["busy_blocks"],
                state["preferences"],
            )
            if not report.ok:
                feedback = _scoped_repair_feedback(report, state["preferences"])
                event = {
                    "round": state["round_number"],
                    "speaker": "System",
                    "content": f"{feedback}\nRetrying arbitration.",
                    "event_type": "validation_fail",
                }
                return {
                    "schedule": None,
                    "validation_error": feedback,
                    "validation_warnings": feedback,
                    "frozen_blocks": report.frozen,
                    "best_effort_schedule": Schedule(blocks=blocks),
                    "validation_attempts": state.get("validation_attempts", 0) + 1,
                    "transcript": [event],
                }
            return {
                "schedule": Schedule(blocks=blocks),
                "validation_error": None,
                "degraded": False,
                "validation_warnings": None,
                "best_effort_schedule": None,
                "frozen_blocks": [],
            }
```

(The `except Exception` JSON-parse branch is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_nodes.py -q`
Expected: PASS — the two new tests plus the existing validate tests (`test_validate_sets_error_on_semantic_violation`, `..._returns_best_effort_and_increments_attempts`, etc.) all green. The existing tests still find `"semantic validation"`, `"before work window"`, the block label, `best_effort_schedule`, and `validation_warnings == validation_error`.

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/state.py src/weekforge/debate/nodes.py tests/debate/test_nodes.py
git commit -m "feat: validate node freezes valid blocks and emits scoped-repair feedback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `arbitrate` node injects frozen blocks + budget + only-fix instruction

On a retry (when `frozen_blocks` is present), the arbiter prompt now pins the frozen blocks as final/occupied and gives the per-day remaining focus budget.

**Files:**
- Modify: `src/weekforge/debate/nodes.py` (`make_arbitrate_node`)
- Test: `tests/debate/test_nodes.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/debate/test_nodes.py`:

```python
class _CaptureCouncil:
    """Council stub that records the context passed to arbitrate()."""

    def __init__(self):
        self.last_context = None

    def arbitrate(self, context: str) -> str:
        self.last_context = context
        return "[]"


def test_arbitrate_injects_frozen_blocks_and_budget(base_state):
    council = _CaptureCouncil()
    frozen = [TimeBlock(start=_utc(2026, 6, 15, 9), end=_utc(2026, 6, 15, 11),
                        label="Write report", task_id="t1")]
    state = {
        **base_state,
        "frozen_blocks": frozen,
        "validation_error": "BROKEN (re-place these only):\n  - Review PRs: before work window 09:00",
        "round_number": 1,
        "preferences": Preferences(workday_start_hour=9, workday_end_hour=18,
                                   max_focus_minutes_per_day=360, timezone=None),
    }

    make_arbitrate_node(council)(state)
    ctx = council.last_context

    assert "SCOPED REPAIR" in ctx
    assert "Write report" in ctx            # the frozen block is listed
    assert "Do NOT move" in ctx
    assert "240min left" in ctx             # 360 cap − 120 frozen on Jun 15
    assert "broken" in ctx.lower()          # only-fix instruction


def test_arbitrate_first_pass_has_no_scoped_section(base_state):
    council = _CaptureCouncil()
    state = {**base_state, "round_number": 0}   # no frozen_blocks
    make_arbitrate_node(council)(state)
    assert "SCOPED REPAIR" not in council.last_context
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/debate/test_nodes.py::test_arbitrate_injects_frozen_blocks_and_budget -q`
Expected: FAIL — `AssertionError` (no "SCOPED REPAIR" in context).

- [ ] **Step 3: Inject the scoped section in `make_arbitrate_node`**

In `src/weekforge/debate/nodes.py`, inside `make_arbitrate_node`'s `arbitrate` function, after `prev_error` is computed and before `context = (...)` is assembled, add:

```python
        frozen = state.get("frozen_blocks") or []
        scoped = ""
        if frozen:
            tz = ZoneInfo(state["preferences"].timezone) if state["preferences"].timezone else timezone.utc
            occupied = "\n".join(
                f"- {b.label}: {b.start.astimezone(tz).strftime('%a %H:%M')}–"
                f"{b.end.astimezone(tz).strftime('%H:%M')} local"
                for b in frozen
            )
            budget = remaining_focus_budget(frozen, state["preferences"])
            budget_lines = "\n".join(
                f"- {day.strftime('%a %d %b')}: {mins}min left"
                for day, mins in sorted(budget.items())
            )
            scoped = (
                "\n\nSCOPED REPAIR — the previous schedule was mostly valid. "
                "The blocks below are ALREADY FINAL. Do NOT move, resize, or drop them; "
                "reproduce them unchanged in your output and place nothing that overlaps them:\n"
                f"{occupied}\n"
                "Remaining daily focus budget AFTER these fixed blocks (do not exceed):\n"
                f"{budget_lines}\n"
                "Only (re-)schedule the tasks flagged as broken in the validation feedback above; "
                "leave every fixed block exactly as listed."
            )
```

Then append `scoped` to the end of the `context` f-string (after `{human_note}{prev_error}`):

```python
            f"{human_note}{prev_error}{scoped}"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_nodes.py -q`
Expected: PASS (both new arbitrate tests + all existing node tests).

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/nodes.py tests/debate/test_nodes.py
git commit -m "feat: arbitrate node pins frozen blocks and remaining budget on retry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Separate Arbiter model line

`build_council` gains `arbiter_model`; when set, only the Arbiter agent gets its own `LLM`.

**Files:**
- Modify: `src/weekforge/debate/debaters.py` (`build_council`)
- Modify: `src/weekforge/api/server.py` (read env, pass through)
- Modify: `CLAUDE.md` (env var table)
- Test: `tests/debate/test_debaters.py`, `tests/api/test_server_model.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/debate/test_debaters.py`:

```python
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
```

Create `tests/api/test_server_model.py`:

```python
"""build_app wires WEEKFORGE_ARBITER_MODEL into the council."""

from __future__ import annotations

from unittest.mock import patch


def test_build_app_passes_arbiter_model(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    monkeypatch.setenv("WEEKFORGE_ARBITER_MODEL", "anthropic/claude-sonnet-x")

    with (
        patch("weekforge.api.server.build_council") as mock_bc,
        patch("weekforge.api.server._build_google_integration"),
        patch("weekforge.api.server.create_app"),
    ):
        from weekforge.api.server import build_app
        build_app()

    assert mock_bc.call_args.kwargs.get("arbiter_model") == "anthropic/claude-sonnet-x"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/debate/test_debaters.py::test_build_council_separate_arbiter_model tests/api/test_server_model.py -q`
Expected: FAIL — `TypeError: build_council() got an unexpected keyword argument 'arbiter_model'`.

- [ ] **Step 3a: Add `arbiter_model` to `build_council`**

In `src/weekforge/debate/debaters.py`, change the signature and the LLM construction:

```python
def build_council(
    api_key: str,
    model: str = DEFAULT_MODEL,
    arbiter_model: str | None = None,
) -> Council:
    """Build a Council with four Claude-backed CrewAI agents.

    When arbiter_model is set, only the Arbiter uses it; the three debaters use `model`.
    """
    llm = LLM(model=model, api_key=api_key)
    arbiter_llm = LLM(model=arbiter_model, api_key=api_key) if arbiter_model else llm
```

Then in the `arbiter = Agent(...)` construction, change `llm=llm` to `llm=arbiter_llm`. (The three debaters keep `llm=llm`.)

- [ ] **Step 3b: Wire the env var in `server.py`**

In `src/weekforge/api/server.py`, inside `build_app`, after the `model = os.environ.get("WEEKFORGE_MODEL", DEFAULT_MODEL)` line, change the council construction to:

```python
    arbiter_model = os.environ.get("WEEKFORGE_ARBITER_MODEL")
    council = build_council(api_key, model=model, arbiter_model=arbiter_model)
```

(`arbiter_model` defaults to `None` when unset → falls back to `model`, zero behavior change.)

- [ ] **Step 3c: Document the env var in `CLAUDE.md`**

In `CLAUDE.md`, in the Environment variables table, add a row immediately after the `WEEKFORGE_MODEL` row:

```markdown
| `WEEKFORGE_ARBITER_MODEL` | Arbiter-only model; falls back to `WEEKFORGE_MODEL` when unset (recommend a stronger model, e.g. Sonnet, to reduce validation retries) |
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_debaters.py tests/api/test_server_model.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/debaters.py src/weekforge/api/server.py CLAUDE.md tests/debate/test_debaters.py tests/api/test_server_model.py
git commit -m "feat: give the Arbiter its own model line via WEEKFORGE_ARBITER_MODEL

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Log validation-attempt count at finalize

Emit a single structured log line so real-world oscillation rate is observable. No event-schema change.

**Files:**
- Modify: `src/weekforge/debate/nodes.py` (`finalize_node`)
- Test: `tests/debate/test_nodes.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/debate/test_nodes.py`:

```python
def test_finalize_logs_validation_attempts(base_state, caplog):
    import logging
    state = {**base_state, "schedule": Schedule(blocks=[]), "validation_attempts": 2}
    with caplog.at_level(logging.INFO):
        finalize_node(state)
    assert "validation_attempts=2" in caplog.text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/debate/test_nodes.py::test_finalize_logs_validation_attempts -q`
Expected: FAIL — `AssertionError` (no log emitted).

- [ ] **Step 3: Add the logger + log line**

In `src/weekforge/debate/nodes.py`, add at module top (after `import json`):

```python
import logging
```

and after the imports add:

```python
logger = logging.getLogger(__name__)
```

Then at the very start of `finalize_node`'s body (before reading `schedule`), add:

```python
    logger.info(
        "debate finalize: validation_attempts=%d degraded=%s",
        state.get("validation_attempts", 0),
        state.get("schedule") is None and state.get("best_effort_schedule") is not None,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/debate/test_nodes.py::test_finalize_logs_validation_attempts -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/nodes.py tests/debate/test_nodes.py
git commit -m "feat: log validation_attempts at finalize for oscillation observability

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: End-to-end convergence regression

Drive `arbitrate → validate → arbitrate → validate` with a scripted council that only fixes the *broken* block once it sees the SCOPED REPAIR section. Proves the loop converges in one retry instead of oscillating, and that the existing 3-strikes degrade path still holds.

**Files:**
- Test: `tests/debate/test_nodes.py`

- [ ] **Step 1: Write the failing/▶ regression test**

Append to `tests/debate/test_nodes.py`:

```python
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


def test_scoped_repair_converges_in_one_retry(base_state, mock_api_key):
    # t1 valid both times (09:00–11:00); t2 broken first (07:00–08:00), fixed on retry (11:00–12:00).
    broken = (
        '[{"start": "2026-06-15T09:00:00+00:00", "end": "2026-06-15T11:00:00+00:00",'
        ' "label": "Write report", "task_id": "t1"},'
        ' {"start": "2026-06-15T07:00:00+00:00", "end": "2026-06-15T08:00:00+00:00",'
        ' "label": "Review PRs", "task_id": "t2"}]'
    )
    fixed = (
        '[{"start": "2026-06-15T09:00:00+00:00", "end": "2026-06-15T11:00:00+00:00",'
        ' "label": "Write report", "task_id": "t1"},'
        ' {"start": "2026-06-15T11:00:00+00:00", "end": "2026-06-15T12:00:00+00:00",'
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
        "preferences": Preferences(workday_start_hour=9, workday_end_hour=18,
                                   max_focus_minutes_per_day=600, timezone=None),
        "round_number": 1,
        "validation_attempts": 0,
        "proposals": {},
        "critiques": {},
    }

    arbitrate = make_arbitrate_node(council)
    with patch("weekforge.debate.nodes.Anthropic", return_value=_echo_anthropic()):
        validate = make_validate_node(mock_api_key)

        # Round 1: broken → validation fails, t1 frozen, t2 flagged.
        state = {**state, **arbitrate(state)}
        r1 = validate(state)
        assert r1["schedule"] is None
        assert [b.label for b in r1["frozen_blocks"]] == ["Write report"]
        state = {**state, **r1}

        # Round 2: arbiter sees SCOPED REPAIR → fixes only t2 → validation passes.
        state = {**state, **arbitrate(state)}
        r2 = validate(state)

    assert r2["schedule"] is not None
    labels = {b.label for b in r2["schedule"].blocks}
    assert labels == {"Write report", "Review PRs"}
    # t1 was left exactly where it was (no oscillation)
    t1 = next(b for b in r2["schedule"].blocks if b.label == "Write report")
    assert t1.start.hour == 9 and t1.end.hour == 11
```

- [ ] **Step 2: Run test to verify it passes**

Run: `uv run pytest tests/debate/test_nodes.py::test_scoped_repair_converges_in_one_retry -q`
Expected: PASS. (This is a regression/characterization test over Tasks 2–3; it should pass once those are in.)

- [ ] **Step 3: Verify the degrade path still terminates**

Run the existing best-effort / cap tests to confirm the safety net is intact:

Run: `uv run pytest tests/debate -q -k "best_effort or finalize or attempts or degraded"`
Expected: PASS.

- [ ] **Step 4: Full debate suite green**

Run: `uv run pytest tests/debate tests/api/test_server_model.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/debate/test_nodes.py
git commit -m "test: scoped-repair converges in one retry without oscillating

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run the whole suite: `uv run pytest -q`. Expected: all green.
- [ ] Confirm no hardcoded Sonnet id: `grep -rn "claude-sonnet" src/`. Expected: no matches (the id only ever arrives via `WEEKFORGE_ARBITER_MODEL`).
- [ ] Confirm `validate_blocks` is still importable from its old home: `grep -n "validate_blocks" src/weekforge/debate/nodes.py`. Expected: it appears in the import block.

---

## Self-Review notes (author)

- **Spec coverage:** §1 → Task 4; §2 → Task 1; §3 → Task 2; §4 → Task 3; §5 → Tasks 5 (logging) + 6 (cap/degrade regression) + untouched `finalize`/cap. All spec sections map to a task.
- **Type consistency:** `classify_blocks` → `ValidationReport` (`.ok`, `.frozen`, `.to_fix`); `BlockReport` (`.block`, `.errors`, `.day_reasons`, `.frozen`); `remaining_focus_budget(frozen_blocks, preferences) -> dict[date,int]`. These names are used identically in Tasks 2, 3, 6. State field `frozen_blocks` written in Task 2, read in Tasks 3 & 6.
- **Safety net:** `max_validation_attempts` cap and `finalize` best-effort/`degraded` path are not modified by any task; Task 6 Step 3 re-runs their tests.
