# Plan A — Engine Correctness: DST Offset, Frozen Enforcement, Now-Aware Week Window

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three production bugs in the debate engine, all caused by trusting the LLM with mechanical correctness: (RC1) the Arbiter emits wrong UTC offsets in DST-affected zones, silently shifting every block by an hour and making validation unsatisfiable; (RC2) scoped-repair trusts the model to reproduce FROZEN blocks verbatim, which it doesn't, so the frozen set oscillates; (RC3) the schedulable week is undefined relative to "now", so tasks land on past days.

**Architecture:** Move offset math, frozen-block preservation, and week-boundary checks out of the LLM and into deterministic code. (RC1) The model now emits *local wall-clock* times with no offset; `validate` parses them naive and attaches the correct `ZoneInfo` offset for that date (DST-correct), stripping any stray offset the model emits. (RC2) On a scoped retry the model outputs *only the broken tasks*; `validate` merges the authoritative `frozen_blocks` from state back in by code. (RC3) A pure `compute_week_window` derives `[window_start, window_end]` from the picked week's Monday + the current time + timezone; a new `classify_blocks` rule rejects anything outside it. The LangGraph structure is unchanged.

**Tech Stack:** Python 3.12+ (uv), LangGraph, CrewAI, Anthropic SDK, pytest, `zoneinfo`.

---

## Background (root causes — verified against code + the failing transcript)

- **RC1 (DST):** `_fmt_prefs` (`nodes.py:59`) tells the model to "Output datetimes in UTC with the appropriate offset". For a June Australia/Sydney week the model wrote `+11:00` (summer offset); the real winter offset is `+10:00`. `classify_blocks` does `astimezone(ZoneInfo(tz))`, so `09:00+11:00` → `08:00` local → "before work window 09:00" — forever. The model perceives no error (it wrote 09:00) and the retry loop thrashes to exhaustion.
- **RC2 (frozen instability):** scoped-repair tells the model "reproduce frozen blocks unchanged"; in the transcript the model *moved* the frozen Standup between rounds. The "problem only shrinks" invariant was hoped-for, not enforced.
- **RC3 (week window):** `week_start` is the chosen week's Monday with no relation to "now"; nothing rejects past days. Today=Tue, blocks landed on Mon (yesterday).

## Schedulable-window definition (RC3)

For the picked week (its Monday `picked_monday`, `picked_sunday = picked_monday + 6`):

```
now_local    = now in tz
today_usable = now_local time-of-day < workday_end_hour      # Sunday evening → False
earliest_day = today if today_usable else today + 1 day
window_start = max(picked_monday, earliest_day) @ workday_start_hour   (tz-aware)
window_end   = picked_sunday @ (workday_end_hour, or 23:59 if 24)      (tz-aware)
```

- Future week → `earliest_day < picked_monday` → whole week schedulable.
- Current week → clamps to today.
- Empty week (`window_start > window_end`, e.g. Sunday past work hours) → Rule 5 rejects all blocks (degraded). The frontend week-picker (Plan B) prevents users selecting such a week; this plan only needs the window to be computed correctly.

> **Out of scope (Plan B):** the frontend week-picker UI and disabling past/empty weeks. This plan keeps `week_start` meaning "the chosen week's Monday" and makes the *engine* now-aware.

---

## File Structure

- **Modify** `src/weekforge/debate/validation.py` — add `compute_week_window()`; add `_localize()`; add window Rule 5 to `classify_blocks` (new `window` param).
- **Modify** `src/weekforge/debate/state.py` — add `window_start` / `window_end`.
- **Modify** `src/weekforge/debate/runner.py` — compute the window when building initial state.
- **Modify** `src/weekforge/debate/nodes.py` — RC1 prompt + parsing (wall-clock); RC2 scoped prompt ("only broken") + frozen merge in validate; pass window to `classify_blocks`; window wording in prompts.
- **Modify** `tests/debate/test_validation.py`, `tests/debate/test_nodes.py`, `tests/debate/test_runner.py` — coverage.

---

## Task 1: `compute_week_window` + window in state

Pure, now-injectable window calculation, stored in state at graph entry.

**Files:**
- Modify: `src/weekforge/debate/validation.py`
- Modify: `src/weekforge/debate/state.py`
- Modify: `src/weekforge/debate/runner.py`
- Test: `tests/debate/test_validation.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/debate/test_validation.py`:

```python
from datetime import datetime, timezone
from weekforge.debate.validation import compute_week_window


def _now(y, m, d, h, mn=0, tz="Australia/Sydney"):
    from zoneinfo import ZoneInfo
    return datetime(y, m, d, h, mn, tzinfo=ZoneInfo(tz))


def test_window_future_week_is_whole_week():
    # Picked week Mon 2026-06-22; now is the previous Wednesday → whole week schedulable.
    prefs = Preferences(workday_start_hour=9, workday_end_hour=18, timezone="Australia/Sydney")
    ws, we = compute_week_window("2026-06-22", prefs, now=_now(2026, 6, 17, 10))
    assert (ws.year, ws.month, ws.day, ws.hour) == (2026, 6, 22, 9)     # Monday 09:00
    assert (we.month, we.day, we.hour) == (6, 28, 18)                   # Sunday 18:00
    assert ws.utcoffset().total_seconds() == 10 * 3600                  # +10 (DST-correct, winter)


def test_window_current_week_clamps_to_today():
    # Picked week Mon 2026-06-15; today is Tue 2026-06-16 10:00 → starts today, not Monday.
    prefs = Preferences(workday_start_hour=9, workday_end_hour=18, timezone="Australia/Sydney")
    ws, we = compute_week_window("2026-06-15", prefs, now=_now(2026, 6, 16, 10))
    assert (ws.month, ws.day, ws.hour) == (6, 16, 9)                    # today 09:00
    assert (we.month, we.day) == (6, 21)                               # Sunday


def test_window_sunday_after_work_hours_is_empty():
    # Today is Sunday 2026-06-21 20:00 (past 18:00); picked week is that same week.
    prefs = Preferences(workday_start_hour=9, workday_end_hour=18, timezone="Australia/Sydney")
    ws, we = compute_week_window("2026-06-15", prefs, now=_now(2026, 6, 21, 20))
    assert ws > we                                                      # empty window


def test_window_end_24_uses_2359():
    prefs = Preferences(workday_start_hour=8, workday_end_hour=24, timezone="Australia/Sydney")
    ws, we = compute_week_window("2026-06-22", prefs, now=_now(2026, 6, 17, 10))
    assert (we.hour, we.minute) == (23, 59)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/debate/test_validation.py -q -k window`
Expected: FAIL — `ImportError: cannot import name 'compute_week_window'`.

- [ ] **Step 3: Implement `compute_week_window`**

In `src/weekforge/debate/validation.py`, add the imports at the top (extend the existing datetime import):

```python
from datetime import date, datetime, time, timedelta, timezone
```

and add:

```python
def compute_week_window(
    week_start: str | None,
    preferences: Preferences,
    now: datetime,
) -> tuple[datetime, datetime]:
    """Return (window_start, window_end) tz-aware datetimes for the schedulable window.

    The picked week is [Monday, Sunday]; the lower bound is clamped so we never
    schedule in the past. `now` is injected for testability.
    """
    tz = _tz(preferences)
    now_local = now.astimezone(tz)
    today = now_local.date()
    today_usable = now_local.hour + now_local.minute / 60 < preferences.workday_end_hour
    earliest_day = today if today_usable else today + timedelta(days=1)

    if week_start:
        picked_monday = date.fromisoformat(week_start)
    else:
        picked_monday = today - timedelta(days=today.weekday())  # Monday of current week
    picked_sunday = picked_monday + timedelta(days=6)

    window_start_day = max(picked_monday, earliest_day)
    start_t = time(hour=preferences.workday_start_hour)
    end_t = time(hour=23, minute=59) if preferences.workday_end_hour >= 24 else time(hour=preferences.workday_end_hour)

    window_start = datetime.combine(window_start_day, start_t, tzinfo=tz)
    window_end = datetime.combine(picked_sunday, end_t, tzinfo=tz)
    return window_start, window_end
```

- [ ] **Step 4: Add state fields**

In `src/weekforge/debate/state.py`, add (near `week_start`, and make sure `datetime` is imported — add `from datetime import datetime` if absent):

```python
    window_start: NotRequired[datetime]   # tz-aware lower bound of the schedulable window
    window_end: NotRequired[datetime]     # tz-aware upper bound (Sunday workday end)
```

- [ ] **Step 5: Compute the window at graph entry**

In `src/weekforge/debate/runner.py`, add the import:

```python
from datetime import datetime, timezone
from weekforge.debate.validation import compute_week_window
```

In the `else` branch that builds the initial `DebateState` (around line 69), compute and pass the window:

```python
        window_start, window_end = compute_week_window(
            week_start, preferences, now=datetime.now(timezone.utc)
        )
        stream_input = DebateState(
            tasks=tasks,
            busy_blocks=busy_blocks,
            preferences=preferences,
            max_rounds=max_rounds,
            validation_attempts=0,
            max_validation_attempts=max_validation_attempts,
            best_effort_schedule=None,
            week_start=week_start,
            window_start=window_start,
            window_end=window_end,
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_validation.py tests/debate/test_runner.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/weekforge/debate/validation.py src/weekforge/debate/state.py src/weekforge/debate/runner.py tests/debate/test_validation.py
git commit -m "feat: compute now-aware schedulable week window at graph entry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `classify_blocks` Rule 5 — block must fall inside the window

**Files:**
- Modify: `src/weekforge/debate/validation.py` (`classify_blocks` gains `window`)
- Modify: `src/weekforge/debate/nodes.py` (validate passes window from state)
- Test: `tests/debate/test_validation.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/debate/test_validation.py`:

```python
def test_block_before_window_start_is_broken():
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("Australia/Sydney")
    prefs = Preferences(workday_start_hour=9, workday_end_hour=18, timezone="Australia/Sydney")
    window = (
        datetime(2026, 6, 16, 9, tzinfo=tz),   # Tue 09:00
        datetime(2026, 6, 21, 18, tzinfo=tz),  # Sun 18:00
    )
    # Block on Monday 2026-06-15 (before window) → must be flagged.
    block = TimeBlock(start=datetime(2026, 6, 15, 9, tzinfo=tz),
                      end=datetime(2026, 6, 15, 11, tzinfo=tz), label="Past", task_id="t1")
    report = classify_blocks([block], [Task(id="t1", title="X", estimated_minutes=120)], [], prefs, window=window)
    assert report.ok is False
    assert "outside the schedulable week" in report.to_fix[0].errors[0]


def test_block_inside_window_is_ok():
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("Australia/Sydney")
    prefs = Preferences(workday_start_hour=9, workday_end_hour=18, timezone="Australia/Sydney")
    window = (datetime(2026, 6, 16, 9, tzinfo=tz), datetime(2026, 6, 21, 18, tzinfo=tz))
    block = TimeBlock(start=datetime(2026, 6, 16, 9, tzinfo=tz),
                      end=datetime(2026, 6, 16, 11, tzinfo=tz), label="OK", task_id="t1")
    report = classify_blocks([block], [Task(id="t1", title="X", estimated_minutes=120)], [], prefs, window=window)
    assert report.ok is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/debate/test_validation.py -q -k window_start_is_broken`
Expected: FAIL — `classify_blocks() got an unexpected keyword argument 'window'`.

- [ ] **Step 3: Add the `window` param + Rule 5**

In `src/weekforge/debate/validation.py`, change the `classify_blocks` signature:

```python
def classify_blocks(
    blocks: list[TimeBlock],
    tasks: list[Task],
    busy_blocks: list[TimeBlock],
    preferences: Preferences,
    window: tuple[datetime, datetime] | None = None,
) -> ValidationReport:
```

Inside the per-block loop, after the Rule 3 busy-overlap block and before the `day = local_start.date()` line, add:

```python
        # Rule 5: block must fall inside the schedulable week window
        if window is not None:
            window_start, window_end = window
            if block.start < window_start or block.end > window_end:
                ws = window_start.astimezone(tz)
                we = window_end.astimezone(tz)
                rep.errors.append(
                    f"Block '{block.label}': outside the schedulable week "
                    f"({ws.strftime('%a %d %b %H:%M')}–{we.strftime('%a %d %b %H:%M')} local)"
                )
```

- [ ] **Step 4: Pass the window from the validate node**

In `src/weekforge/debate/nodes.py`, in `make_validate_node`, update the `classify_blocks(...)` call to pass the window from state:

```python
            report = classify_blocks(
                blocks,
                state["tasks"],
                state["busy_blocks"],
                state["preferences"],
                window=(
                    (state["window_start"], state["window_end"])
                    if state.get("window_start") and state.get("window_end")
                    else None
                ),
            )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_validation.py tests/debate/test_nodes.py -q`
Expected: PASS (new window rule + all prior validation/node tests; the `window=None` default keeps existing tests valid).

- [ ] **Step 6: Commit**

```bash
git add src/weekforge/debate/validation.py src/weekforge/debate/nodes.py tests/debate/test_validation.py
git commit -m "feat: reject blocks outside the schedulable week window (Rule 5)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: RC1 — local wall-clock contract (kill DST offset errors)

The model emits naive local wall-clock; `validate` strips any offset and attaches the DST-correct `ZoneInfo`.

**Files:**
- Modify: `src/weekforge/debate/validation.py` (`_localize` helper)
- Modify: `src/weekforge/debate/nodes.py` (prompts + parsing)
- Test: `tests/debate/test_nodes.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/debate/test_nodes.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/debate/test_nodes.py::test_validate_relocalizes_wrong_offset_to_correct_local -q`
Expected: FAIL — current parsing keeps `+11:00`, so `astimezone` gives `08:00` → "before work window" → `schedule is None`.

- [ ] **Step 3a: Add `_localize` to validation.py**

In `src/weekforge/debate/validation.py`, add:

```python
def _localize(value: str, preferences: Preferences) -> datetime:
    """Parse a wall-clock ISO string and attach the DST-correct local offset.

    Any offset the model emitted is discarded — the wall-clock components are
    authoritative and `ZoneInfo` supplies the right offset for that date.
    """
    dt = datetime.fromisoformat(value)
    return dt.replace(tzinfo=None).replace(tzinfo=_tz(preferences))
```

- [ ] **Step 3b: Use `_localize` when parsing in the validate node**

In `src/weekforge/debate/nodes.py`, add `_localize` to the validation import block, then change the `TimeBlock(...)` construction in `make_validate_node` from `datetime.fromisoformat(b["start"])` / `["end"]` to:

```python
            blocks = [
                TimeBlock(
                    start=_localize(b["start"], state["preferences"]),
                    end=_localize(b["end"], state["preferences"]),
                    label=b["label"],
                    task_id=b.get("task_id"),
                )
                for b in blocks_data
            ]
```

- [ ] **Step 3c: Change the prompts to demand wall-clock (no offset)**

In `src/weekforge/debate/nodes.py`:

1. `_fmt_prefs` — replace the last line:

```python
        f"Output datetimes as LOCAL wall-clock time in {p.timezone or 'UTC'} "
        f"(e.g. 2026-06-16T09:00:00) with NO timezone offset and NO trailing 'Z'."
```

2. In `make_arbitrate_node`'s context, replace the line `f"All datetimes in the JSON output MUST fall within this week and MUST include a UTC offset.\n\n"` with:

```python
            f"All datetimes MUST be LOCAL wall-clock in {state['preferences'].timezone or 'UTC'} "
            f"with NO offset and NO 'Z' (e.g. 2026-06-16T09:00:00).\n\n"
```

3. In `make_validate_node`'s extraction prompt, change `"start (ISO 8601 with timezone), end (ISO 8601 with timezone), "` to:

```python
                    "start (local wall-clock ISO 8601, e.g. 2026-06-16T09:00:00, NO timezone/offset), "
                    "end (local wall-clock ISO 8601, NO timezone/offset), "
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_nodes.py -q`
Expected: PASS — the new re-localization test passes; existing validate tests still pass because `_localize` of an already-local/naive value is identity-ish (the prior tests use UTC strings with `timezone=None`, which localize to UTC unchanged).

> If any existing node test fed a `+00:00` string with `timezone=None`, it still localizes to UTC (`_tz` returns `timezone.utc`) → same instant. Verify these stay green; if one asserted on a specific offset object, relax it to compare the local hour.

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/validation.py src/weekforge/debate/nodes.py tests/debate/test_nodes.py
git commit -m "fix: model emits local wall-clock; validate attaches DST-correct offset

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: RC2 — enforce FROZEN blocks in code (no oscillation)

On a scoped retry the model is asked for *only the broken tasks*; `validate` merges the authoritative `frozen_blocks` back in.

**Files:**
- Modify: `src/weekforge/debate/nodes.py` (arbitrate scoped prompt + validate merge)
- Test: `tests/debate/test_nodes.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/debate/test_nodes.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/debate/test_nodes.py::test_validate_merges_frozen_blocks_from_state -q`
Expected: FAIL — currently `validate` only uses the parsed model blocks; the frozen Write-report is missing (or, in the second test, the model's bad version wins).

- [ ] **Step 3a: Merge frozen blocks in the validate node**

In `src/weekforge/debate/nodes.py`, in `make_validate_node`, right after `blocks = [ ... ]` is built (the parsed model blocks) and before `report = classify_blocks(...)`, insert:

```python
            frozen_in = state.get("frozen_blocks") or []
            if frozen_in:
                frozen_labels = {b.label for b in frozen_in}
                # Frozen blocks are authoritative: drop any model re-emission of them.
                blocks = frozen_in + [b for b in blocks if b.label not in frozen_labels]
```

(`blocks` now feeds both `classify_blocks` and the resulting `Schedule(blocks=blocks)` on success and best-effort, so the merged set flows through unchanged.)

- [ ] **Step 3b: Tell the model to output only the broken tasks**

In `src/weekforge/debate/nodes.py`, in `make_arbitrate_node`'s scoped section (the `scoped = (...)` string added previously), replace the final instruction sentence so it asks for broken-only output:

```python
                "Output JSON for ONLY the tasks flagged as broken in the validation feedback above. "
                "Do NOT output the fixed blocks listed here — the system re-attaches them automatically. "
                "Do not place anything that overlaps them, and stay within the remaining daily budget."
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_nodes.py -q`
Expected: PASS — both merge tests pass; the earlier `test_scoped_repair_converges_in_one_retry` still passes (frozen block now merged by code rather than reproduced by the stub; update that test's fixed-output stub to emit only the broken `Review PRs` block if it currently emits both — see Task 5).

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/nodes.py tests/debate/test_nodes.py
git commit -m "fix: enforce frozen blocks in code on scoped retry (model outputs broken-only)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Prompt window wording + end-to-end regression of the failing transcript

Make the prompts state the concrete window, and prove the original failing scenario now converges.

**Files:**
- Modify: `src/weekforge/debate/nodes.py` (gather + arbitrate "Week to schedule" wording)
- Test: `tests/debate/test_nodes.py`

- [ ] **Step 1: State the concrete window in the prompts**

In `src/weekforge/debate/nodes.py`, add a small helper near the other `_fmt_*` helpers:

```python
def _fmt_window(state: DebateState) -> str:
    ws = state.get("window_start")
    we = state.get("window_end")
    if not ws or not we:
        return state.get("week_start") or "this week"
    tz = ZoneInfo(state["preferences"].timezone) if state["preferences"].timezone else timezone.utc
    return (
        f"{ws.astimezone(tz).strftime('%a %d %b %H:%M')} "
        f"to {we.astimezone(tz).strftime('%a %d %b %H:%M')} local"
    )
```

Then in BOTH `make_gather_proposals_node` and `make_arbitrate_node`, replace the `week_label = ...` line and the `f"Week to schedule: {week_label} (Monday) through the following Sunday.\n"` line with:

```python
        context = (
            f"Schedulable window: {_fmt_window(state)}. "
            f"Every block MUST start at/after the window start and end at/before the window end. "
            f"Do NOT schedule anything before the window start (those days/hours are in the past).\n"
            ...
```

(Keep the rest of each context string intact; only the first line changes.)

- [ ] **Step 2: Write the end-to-end regression test**

Append to `tests/debate/test_nodes.py` (this drives arbitrate→validate→arbitrate→validate with the exact DST + window conditions from the bug):

```python
def test_dst_window_scenario_converges(mock_api_key):
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("Australia/Sydney")

    # Round 1: model emits everything with the WRONG +11 offset (its natural mistake) and t2 too early.
    broken = (
        '[{"start": "2026-06-16T09:00:00", "end": "2026-06-16T11:00:00",'
        ' "label": "Write report", "task_id": "t1"},'
        ' {"start": "2026-06-15T09:00:00", "end": "2026-06-15T10:00:00",'   # Monday = before window
        ' "label": "Review PRs", "task_id": "t2"}]'
    )
    # Round 2 (scoped, broken-only): model re-places just t2 inside the window.
    fixed_broken_only = (
        '[{"start": "2026-06-16T11:00:00", "end": "2026-06-16T12:00:00",'
        ' "label": "Review PRs", "task_id": "t2"}]'
    )

    class _Council:
        def arbitrate(self, context):
            return fixed_broken_only if "SCOPED REPAIR" in context else broken

    state = {
        "tasks": [Task(id="t1", title="Write report", estimated_minutes=120, priority=1),
                  Task(id="t2", title="Review PRs", estimated_minutes=60, priority=2)],
        "busy_blocks": [],
        "preferences": Preferences(workday_start_hour=9, workday_end_hour=18, timezone="Australia/Sydney"),
        "window_start": datetime(2026, 6, 16, 9, tzinfo=tz),
        "window_end": datetime(2026, 6, 21, 18, tzinfo=tz),
        "round_number": 1, "validation_attempts": 0, "max_rounds": 3,
        "proposals": {}, "critiques": {}, "converged": False,
        "interrupt_reason": None, "human_input": None,
        "schedule": None, "validation_error": None, "transcript": [],
    }

    def _echo(**kwargs):
        content = kwargs["messages"][0]["content"]
        raw = content.split("Arbiter output:\n", 1)[1].split("\n\nExtract", 1)[0].strip()
        resp = MagicMock()
        resp.content[0].text = raw
        return resp

    arbitrate = make_arbitrate_node(_Council())
    with patch("weekforge.debate.nodes.Anthropic") as MockAnthropic:
        client = MagicMock()
        client.messages.create.side_effect = _echo
        MockAnthropic.return_value = client
        validate = make_validate_node(mock_api_key)

        state = {**state, **arbitrate(state)}        # round 1 broken
        r1 = validate(state)
        assert r1["schedule"] is None
        assert [b.label for b in r1["frozen_blocks"]] == ["Write report"]
        state = {**state, **r1}

        state = {**state, **arbitrate(state)}        # round 2 scoped → fixes t2
        r2 = validate(state)

    assert r2["schedule"] is not None
    labels = {b.label for b in r2["schedule"].blocks}
    assert labels == {"Write report", "Review PRs"}
    # Write report kept at correct 09:00 LOCAL (DST handled), nothing on the past Monday.
    t1 = next(b for b in r2["schedule"].blocks if b.label == "Write report")
    assert t1.start.astimezone(tz).day == 16 and t1.start.astimezone(tz).hour == 9
```

- [ ] **Step 3: Update the prior convergence stub if needed**

If `test_scoped_repair_converges_in_one_retry` (from the earlier branch) emits BOTH blocks in its `fixed` output, change that `fixed` to emit only the broken `Review PRs` block (broken-only contract); the frozen `Write report` is now merged by code. Re-run it.

- [ ] **Step 4: Run the full debate suite**

Run: `uv run pytest tests/debate -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/nodes.py tests/debate/test_nodes.py
git commit -m "test: end-to-end DST + window scenario converges; window stated in prompts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Whole suite: `uv run pytest -q`. Expected: all green.
- [ ] No offset trust left in prompts: `grep -n "UTC offset\|with timezone" src/weekforge/debate/nodes.py`. Expected: no matches (replaced by wall-clock wording).
- [ ] Window reaches validation: `grep -n "window=" src/weekforge/debate/nodes.py`. Expected: the `classify_blocks(... window=...)` call is present.

---

## Self-Review notes (author)

- **Coverage:** RC1 → Task 3 (+ Task 5 e2e); RC2 → Task 4 (+ Task 5 e2e); RC3 → Task 1 (window calc) + Task 2 (Rule 5) + Task 5 (prompt wording). The empty-week case (Sunday past hours) is computed correctly in Task 1 and rejected by Rule 5; graceful UX is Plan B.
- **Type consistency:** `compute_week_window(week_start, preferences, now) -> tuple[datetime, datetime]`; `classify_blocks(..., window=(start,end))`; `_localize(value, preferences) -> datetime`; state keys `window_start`/`window_end`/`frozen_blocks`. Used identically across Tasks 1–5.
- **Safety net untouched:** no change to `max_validation_attempts`, routing, or the `finalize` degraded path.
- **Decisions baked in:** lower bound = today's `workday_start` (clamped now-aware, with the Sunday-past edge rolling to next day); offset approach = wall-clock + code re-localization (with defense against stray model offsets).
