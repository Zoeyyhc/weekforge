# Task-only guardrails & code-owned split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the deterministic guardrail from policing fixed-commitment/buffer blocks, and move task split count + per-block durations into code so the Arbiter can never drift into `(5/4)`/`(8/4)` labels across retries.

**Architecture:** `classify_blocks` gains a `task_id is not None` guard on every per-block rule (Phase 1) and a new code-owned per-task conformance rule built on a pure `block_plan` helper (Phase 2). The validate node's frozen-merge is re-keyed by `task_id`, and the Arbiter's context gains the authoritative split plan, a per-task placement ledger, the full constraint set, and the round transcript.

**Tech Stack:** Python 3.12 / pytest (backend only — no frontend, API, or persistence change).

## Global Constraints

- Per-block guardrails (work window, busy overlap, daily-cap counting, week window, per-block cap) apply **only** to blocks with `task_id is not None`. Fixed commitments passed as `busy_blocks` still constrain task blocks.
- Code owns the split: `N = ceil(estimated / max_focus_minutes_per_block)` and a duration list, each `<= cap`, summing to `estimated`, as even as possible. The council chooses only start times.
- Task identity is preserved — the plan is derived from `estimated_minutes` + cap; no new `Task`/`Preferences`/request/storage field.
- Conformance is **sub-multiset**: over-placement / wrong durations = drift → broken; under-placement = shortfall → still conforms, surfaced by the existing non-blocking `underscheduled_tasks` warning (never forces a retry — termination red line).
- A task freezes **all-or-nothing**: if any of its blocks is individually broken or it drifts, all its blocks re-place together.
- Arbiter still emits local wall-clock with NO offset; `validate` still merges authoritative frozen blocks in code (now keyed by `task_id`). Do not touch the `X-WEEKFORGE:1` marker or any ICS path.
- TDD: write the failing test before implementation. Mock Anthropic in node tests (`patch` on `weekforge.debate.nodes.Anthropic`); never call the real API.

---

### Task 1: Phase 1 — task-only per-block guardrails

**Files:**
- Modify: `src/weekforge/debate/validation.py:72-151` (the per-block loop + Rule 4 in `classify_blocks`)
- Test: `tests/debate/test_validate_blocks.py`, `tests/debate/test_validation.py`

**Interfaces:**
- Produces: `classify_blocks` treats any `block.task_id is None` block as exempt from rules 2, 3, 5, 6 and from daily-cap (Rule 4) counting. Signature unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `tests/debate/test_validate_blocks.py` (it already imports `classify_blocks`, `datetime`, `timezone`, `Preferences`, `Task`, `TimeBlock`):

```python
# ── Phase 1: task-only guardrails (task_id=None blocks are exempt) ───────────

def test_null_task_block_outside_window_and_over_cap_is_clean():
    # A fixed commitment: 20:30–22:30 (120min), workday ends 18:00, cap 45.
    prefs = Preferences(workday_start_hour=9, workday_end_hour=18, max_focus_minutes_per_block=45)
    block = _block("Badminton", 20, 22, end_m=30, task_id=None)  # 20:00–22:30
    report = classify_blocks([block], [], [], prefs)
    assert report.reports[0].frozen
    assert report.reports[0].errors == []


def test_null_task_block_does_not_count_toward_daily_cap():
    # One 60min task block + a huge null buffer; only the task minute counts.
    prefs = Preferences(workday_start_hour=8, workday_end_hour=24, max_focus_minutes_per_day=360, max_focus_minutes_per_block=60)
    task_block = _block("Focus", 9, 10, task_id="t1")          # 60min, task
    buffer = _block("Recovery buffer", 10, 22, task_id=None)   # 720min, null
    report = classify_blocks([task_block, buffer], [_task("t1")], [], prefs)
    assert report.day_errors == []                 # buffer minutes ignored
    assert report.reports[0].frozen and report.reports[1].frozen


def test_null_task_blocks_may_overlap_each_other():
    prefs = Preferences(workday_start_hour=8, workday_end_hour=24, max_focus_minutes_per_block=600)
    a = _block("Dinner", 19, 21, task_id=None)
    b = _block("Call mum", 20, 22, task_id=None)
    report = classify_blocks([a, b], [], [], prefs)
    assert all(r.frozen for r in report.reports)


def test_null_task_block_clean_even_on_over_cap_day():
    # Task blocks push the day over the focus cap; a null buffer on the same day
    # must NOT inherit the day's over-cap reason.
    prefs = Preferences(workday_start_hour=8, workday_end_hour=22, max_focus_minutes_per_day=120, max_focus_minutes_per_block=120)
    t_a = _block("Focus A", 9, 11, task_id="t1")     # 120min
    t_b = _block("Focus B", 12, 14, task_id="t1")    # 120min -> day total 240 > 120 cap
    buffer = _block("Stretch", 20, 21, task_id=None)
    report = classify_blocks([t_a, t_b, buffer], [_task("t1")], [], prefs)
    buffer_rep = report.reports[2]
    assert buffer_rep.frozen          # null block stays clean despite the over-cap day
    assert buffer_rep.day_reasons == []


def test_task_block_still_policed_for_window():
    # Regression: a task block before the window is still broken.
    prefs = Preferences(workday_start_hour=9, workday_end_hour=18, max_focus_minutes_per_block=120)
    block = _block("Early task", 7, 8, task_id="t1")
    report = classify_blocks([block], [_task("t1")], [], prefs)
    assert not report.reports[0].frozen
    assert any("before work window" in e for e in report.reports[0].errors)
```

Then migrate the EXISTING tests that used `task_id=None` blocks as a stand-in for a generic block and expect a guardrail to fire — they must now attach `task_id="t1"` and pass `[_task("t1")]` so they still exercise the task path. Change exactly these in `tests/debate/test_validate_blocks.py`:

```python
def test_block_before_work_start_is_reported():
    blocks = [_block("Early bird", 7, 8, task_id="t1")]
    errors = validate_blocks(blocks, [_task("t1")], [], Preferences(workday_start_hour=9))
    assert len(errors) == 1
    assert "before work window" in errors[0]
    assert "07:00" in errors[0]
    assert "09:00" in errors[0]
```

```python
def test_cross_midnight_block_is_reported():
    blocks = [_block("Night owl", 22, 0, start_day=15, end_day=16, end_m=30, task_id="t1")]
    prefs = Preferences(workday_start_hour=8, workday_end_hour=24, max_focus_minutes_per_block=180)
    errors = validate_blocks(blocks, [_task("t1")], [], prefs)
    assert len(errors) == 1
    assert "spans midnight" in errors[0]
    assert "Night owl" in errors[0]
```

```python
def test_cross_midnight_uses_local_dates_not_utc_dates():
    blocks = [
        TimeBlock(
            start=datetime(2026, 6, 15, 13, 30, tzinfo=timezone.utc),
            end=datetime(2026, 6, 15, 14, 30, tzinfo=timezone.utc),
            label="Sydney late session",
            task_id="t1",
        )
    ]
    prefs = Preferences(workday_start_hour=8, workday_end_hour=24, max_focus_minutes_per_block=120, timezone="Australia/Sydney")
    errors = validate_blocks(blocks, [_task("t1")], [], prefs)
    assert len(errors) == 1
    assert "spans midnight" in errors[0]
    assert "Sydney late session" in errors[0]
```

```python
def test_same_day_block_after_work_end_is_reported():
    blocks = [_block("Overtime", 9, 19, task_id="t1")]
    errors = validate_blocks(
        blocks,
        [_task("t1")],
        [],
        Preferences(workday_start_hour=9, workday_end_hour=18, max_focus_minutes_per_day=600, max_focus_minutes_per_block=600),
    )
    assert len(errors) == 1
    assert "after work window" in errors[0]
    assert "19:00" in errors[0]
```

```python
def test_block_overlapping_busy_is_reported():
    blocks = [_block("Work", 10, 12, task_id="t1")]
    busy = [_block("Meeting", 11, 13)]
    errors = validate_blocks(blocks, [_task("t1")], busy, Preferences(max_focus_minutes_per_block=120))
    assert len(errors) == 1
    assert "overlaps with busy" in errors[0]
    assert "Meeting" in errors[0]
```

```python
def test_fully_contained_in_busy_is_reported():
    blocks = [_block("Work", 10, 11, task_id="t1")]
    busy = [_block("Long meeting", 9, 12)]
    errors = validate_blocks(blocks, [_task("t1")], busy, Preferences(max_focus_minutes_per_block=120))
    assert len(errors) == 1
    assert "overlaps with busy" in errors[0]
```

```python
def test_exceeding_daily_max_is_reported():
    blocks = [
        _block("Block A", 9, 11, task_id="t1"),
        _block("Block B", 11, 13, task_id="t1"),
        _block("Block C", 13, 15, task_id="t1"),
        _block("Block D", 15, 17, task_id="t1"),
    ]
    prefs = Preferences(workday_start_hour=8, workday_end_hour=20, max_focus_minutes_per_day=360, max_focus_minutes_per_block=120)
    errors = validate_blocks(blocks, [_task("t1")], [], prefs)
    assert any("exceeds" in e and "360min/day" in e for e in errors)
```

```python
def test_timezone_none_fallback_utc_does_not_crash():
    blocks = [_block("Early", 7, 8, task_id="t1")]
    prefs = Preferences(workday_start_hour=9, timezone=None)
    errors = validate_blocks(blocks, [_task("t1")], [], prefs)
    assert any("before work window" in e for e in errors)
```

(`test_block_within_work_window_passes`, `test_workday_end_24_allows_late_blocks`, `test_local_timezone_applied_for_work_window`, `test_adjacent_block_not_overlap`, `test_meeting_daily_max_exactly_passes` assert a *pass* — they remain valid with `task_id=None` because exempt blocks also pass. Leave them as-is.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/debate/test_validate_blocks.py -k "null_task or task_block_still" -v`
Expected: FAIL (`test_null_task_block_*` — null blocks are wrongly policed today, including inheriting an over-cap day's reason).

- [ ] **Step 3: Implement the task-only guard**

In `src/weekforge/debate/validation.py`, inside the `for rep in reports:` loop of `classify_blocks`, wrap rules 2, 3, 5, 6 in a `task_id` guard and only count task blocks toward the daily total. Replace lines 81-133 (from `# Rule 2:` through the `minutes_per_day[day] = ...` line) with:

```python
        day = local_start.date()
        block_local_day.append(day)

        # Rules 2/3/5/6 and the daily-cap count police FOCUS blocks only. Fixed
        # commitments and soft buffers (task_id is None) may sit outside the work
        # window, exceed the per-block cap, and overlap each other.
        if block.task_id is None:
            continue

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

        # Rule 6: single block must not exceed the per-block focus cap
        if block.duration_minutes > preferences.max_focus_minutes_per_block:
            rep.errors.append(
                f"Block '{block.label}': {block.duration_minutes}min exceeds "
                f"{preferences.max_focus_minutes_per_block}min single-focus cap"
            )

        minutes_per_day[day] = minutes_per_day.get(day, 0) + block.duration_minutes
```

Note: Rule 1 (unknown `task_id`) stays where it is above this block (lines 77-79) — it already only fires for non-None `task_id`. The `day`/`block_local_day` bookkeeping moves to the top so the Rule 4 `zip(reports, block_local_day)` still lines up for every block.

Then guard the Rule 4 **day-reason** assignment so a `task_id is None` block sharing an over-cap day does not inherit the penalty. Change:

```python
    for rep, day in zip(reports, block_local_day):
        if day in over_cap_days:
            rep.day_reasons.append(
                f"{day.strftime('%a %d %b')} is over the "
                f"{preferences.max_focus_minutes_per_day}min focus cap"
            )
```

to:

```python
    for rep, day in zip(reports, block_local_day):
        if rep.block.task_id is not None and day in over_cap_days:
            rep.day_reasons.append(
                f"{day.strftime('%a %d %b')} is over the "
                f"{preferences.max_focus_minutes_per_day}min focus cap"
            )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_validate_blocks.py tests/debate/test_validation.py -v`
Expected: PASS (all, including the migrated existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/validation.py tests/debate/test_validate_blocks.py tests/debate/test_validation.py
git commit -m "fix: per-block guardrails police only task blocks, not busy/buffer"
```

---

### Task 2: `block_plan` pure helper

**Files:**
- Modify: `src/weekforge/debate/validation.py` (add helper near `underscheduled_tasks`)
- Test: `tests/debate/test_validation.py`

**Interfaces:**
- Produces: `block_plan(estimated_minutes: int, cap: int) -> list[int]` — durations summing to `estimated_minutes`, each `<= cap`, as even as possible; `[estimated_minutes]` when it already fits.

- [ ] **Step 1: Write the failing tests**

Add to `tests/debate/test_validation.py`:

```python
from weekforge.debate.validation import block_plan


def test_block_plan_single_when_within_cap():
    assert block_plan(90, 90) == [90]
    assert block_plan(45, 90) == [45]


def test_block_plan_even_split():
    assert block_plan(180, 90) == [90, 90]
    assert block_plan(180, 45) == [45, 45, 45, 45]


def test_block_plan_uneven_remainder_each_within_cap():
    plan = block_plan(170, 45)
    assert plan == [43, 43, 42, 42]
    assert sum(plan) == 170
    assert all(d <= 45 for d in plan)


def test_block_plan_sums_to_estimate_and_respects_cap():
    plan = block_plan(200, 90)
    assert sum(plan) == 200
    assert all(d <= 90 for d in plan)
    assert len(plan) == 3
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/debate/test_validation.py -k block_plan -v`
Expected: FAIL with ImportError / `block_plan` not defined.

- [ ] **Step 3: Implement the helper**

At the top of `src/weekforge/debate/validation.py`, add `import math` to the existing imports. Then add, just above `def underscheduled_tasks(`:

```python
def block_plan(estimated_minutes: int, cap: int) -> list[int]:
    """Per-task focus-block durations: each <= cap, summing to the estimate, as
    even as possible. Returns [estimated_minutes] when it already fits in one block.

    Code owns the split count and durations; the council only chooses start times.
    """
    if estimated_minutes <= cap:
        return [estimated_minutes]
    n = math.ceil(estimated_minutes / cap)
    base = estimated_minutes // n
    remainder = estimated_minutes % n
    return [base + 1 if i < remainder else base for i in range(n)]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_validation.py -k block_plan -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/validation.py tests/debate/test_validation.py
git commit -m "feat: add block_plan helper for code-owned task splitting"
```

---

### Task 3: Per-task conformance + all-or-nothing freezing (Rule 7)

**Files:**
- Modify: `src/weekforge/debate/validation.py` (end of `classify_blocks`, after Rule 4)
- Test: `tests/debate/test_validation.py`

**Interfaces:**
- Consumes: `block_plan` (Task 2).
- Produces: in `classify_blocks`, task blocks whose duration multiset is not a sub-multiset of their plan, or whose task has any individually-broken block, are all marked broken (non-`frozen`). Under-placement (sub-multiset, short) is left clean.

- [ ] **Step 1: Write the failing tests**

Add to `tests/debate/test_validation.py` (helpers `_block`, `_prefs` already exist; `_block(label, start_h, end_h, *, task_id=None)` uses UTC on Jun 15):

```python
def test_conforming_split_task_all_frozen():
    # 180min task, cap 90 -> plan [90,90]; two 90min blocks placed -> all freeze.
    prefs = _prefs(max_focus_minutes_per_block=90)
    blocks = [
        _block("Report (1/2)", 9, 10, task_id="t1"),   # 60min? NO — need 90min
    ]
```

Replace that sketch — `_block` takes whole hours, so use explicit `TimeBlock`s for 90-minute spans:

```python
def _tb(start_h, start_m, end_h, end_m, label, task_id):
    return TimeBlock(
        start=datetime(2026, 6, 16, start_h, start_m, tzinfo=timezone.utc),
        end=datetime(2026, 6, 16, end_h, end_m, tzinfo=timezone.utc),
        label=label, task_id=task_id,
    )


def test_conforming_split_task_all_frozen():
    prefs = _prefs(max_focus_minutes_per_block=90)              # plan [90,90]
    blocks = [
        _tb(9, 0, 10, 30, "Report (1/2)", "t1"),               # 90min
        _tb(11, 0, 12, 30, "Report (2/2)", "t1"),              # 90min
    ]
    report = classify_blocks(blocks, [Task(id="t1", title="Report", estimated_minutes=180)], [], prefs)
    assert all(r.frozen for r in report.reports)


def test_over_placement_marks_whole_task_broken():
    prefs = _prefs(max_focus_minutes_per_block=90)              # plan [90,90]
    blocks = [
        _tb(9, 0, 10, 30, "Report (1/3)", "t1"),
        _tb(11, 0, 12, 30, "Report (2/3)", "t1"),
        _tb(13, 0, 14, 30, "Report (3/3)", "t1"),              # 3rd block > plan
    ]
    report = classify_blocks(blocks, [Task(id="t1", title="Report", estimated_minutes=180)], [], prefs)
    assert all(not r.frozen for r in report.reports)
    assert any("re-placed as a unit" in e for r in report.reports for e in r.errors)


def test_under_placement_conforms_and_freezes():
    # Only one of the two planned blocks placed -> sub-multiset, still clean.
    prefs = _prefs(max_focus_minutes_per_block=90)              # plan [90,90]
    blocks = [_tb(9, 0, 10, 30, "Report (1/2)", "t1")]
    report = classify_blocks(blocks, [Task(id="t1", title="Report", estimated_minutes=180)], [], prefs)
    assert report.reports[0].frozen


def test_one_broken_block_marks_whole_task_broken():
    # 2 conforming-duration blocks but one is outside the work window -> all re-place.
    prefs = _prefs(max_focus_minutes_per_block=90)              # plan [90,90]
    blocks = [
        _tb(9, 0, 10, 30, "Report (1/2)", "t1"),               # valid
        _tb(7, 0, 8, 30, "Report (2/2)", "t1"),                # before 09:00 window
    ]
    report = classify_blocks(blocks, [Task(id="t1", title="Report", estimated_minutes=180)], [], prefs)
    assert all(not r.frozen for r in report.reports)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/debate/test_validation.py -k "placement or whole_task or conforming_split" -v`
Expected: FAIL (`test_over_placement_*` and `test_one_broken_block_*` — today a third block / a sibling's break does not un-freeze the rest).

- [ ] **Step 3: Implement Rule 7**

At the top of `src/weekforge/debate/validation.py`, add `from collections import Counter` to the imports. Then, in `classify_blocks`, immediately before `return ValidationReport(reports=reports, day_errors=day_errors)`, add:

```python
    # Rule 7: per-task conformance + all-or-nothing freezing.
    # A task's placed durations must be a SUB-multiset of its code-owned plan:
    # over-placement / wrong durations = drift (the (5/4)/(8/4) bug) -> reject.
    # Under-placement is allowed here (the non-blocking underscheduled warning
    # handles it, preserving termination). A task freezes only as a whole: if it
    # drifts OR any of its blocks is individually broken, every block re-places.
    tasks_by_id = {t.id: t for t in tasks}
    reports_by_task: dict[str, list[BlockReport]] = {}
    for rep in reports:
        tid = rep.block.task_id
        if tid is not None and tid in tasks_by_id:
            reports_by_task.setdefault(tid, []).append(rep)

    for tid, reps in reports_by_task.items():
        task = tasks_by_id[tid]
        plan = block_plan(task.estimated_minutes, preferences.max_focus_minutes_per_block)
        drift = Counter(r.block.duration_minutes for r in reps) - Counter(plan)
        any_broken = any(r.errors or r.day_reasons for r in reps)
        if drift or any_broken:
            plan_desc = sorted(plan, reverse=True)
            for r in reps:
                if not (r.errors or r.day_reasons):
                    r.errors.append(
                        f"Block '{r.block.label}': task '{tid}' must be re-placed as a unit "
                        f"(plan: {plan_desc} min blocks)"
                    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_validation.py tests/debate/test_validate_blocks.py -v`
Expected: PASS (all).

- [ ] **Step 5: Verify node-level callers still pass**

Run: `uv run pytest tests/debate/test_nodes.py -v`
Expected: PASS. (Sub-multiset conformance keeps single-block-for-overlong-task fixtures valid — they become clean-but-underscheduled, not broken. If any test fails because a fixture places MORE blocks than its task's plan or a duration absent from the plan, fix that fixture's task `estimated_minutes`/cap so its blocks are a sub-multiset, then re-run.)

- [ ] **Step 6: Commit**

```bash
git add src/weekforge/debate/validation.py tests/debate/test_validation.py
git commit -m "feat: per-task block-plan conformance with all-or-nothing freezing"
```

---

### Task 4: Freeze merge keyed by `task_id`

**Files:**
- Modify: `src/weekforge/debate/nodes.py:420-424` (the frozen merge in `make_validate_node`)
- Test: `tests/debate/test_nodes.py`

**Interfaces:**
- Consumes: all-or-nothing freezing (Task 3) — a frozen `task_id` means all of that task's blocks are final.
- Produces: the validate node drops any model re-emission carrying a frozen `task_id`; `task_id is None` frozen blocks still dedupe by `label`.

- [ ] **Step 1: Write the failing test**

Add to `tests/debate/test_nodes.py` (mirrors `test_validate_drops_model_reemission_of_frozen`'s scaffolding):

```python
def test_validate_drops_reemission_by_task_id_even_with_changed_label(mock_api_key):
    # Frozen Exam Prep block. Model re-emits the same task_id with a DRIFTED label
    # ((5/4)) and a new time. The task_id-keyed merge must drop it, not keep both.
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("Australia/Sydney")
    frozen = TimeBlock(start=datetime(2026, 6, 20, 9, tzinfo=tz),
                       end=datetime(2026, 6, 20, 9, 45, tzinfo=tz), label="Exam Prep (1/4)", task_id="t2")
    model = (
        '[{"start": "2026-06-20T11:00:00", "end": "2026-06-20T11:45:00",'
        ' "label": "Exam Prep (5/4)", "task_id": "t2"}]'
    )
    state = {
        "tasks": [Task(id="t2", title="Exam Prep", estimated_minutes=45)],
        "busy_blocks": [],
        "preferences": Preferences(workday_start_hour=9, workday_end_hour=18, max_focus_minutes_per_block=45, timezone="Australia/Sydney"),
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
    labels = [b.label for b in result["schedule"].blocks]
    assert labels == ["Exam Prep (1/4)"]   # frozen kept; drifted re-emission dropped
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/debate/test_nodes.py -k drops_reemission_by_task_id -v`
Expected: FAIL — today's label-keyed merge keeps both `(1/4)` and `(5/4)`.

- [ ] **Step 3: Re-key the merge**

In `src/weekforge/debate/nodes.py`, replace the frozen merge (currently):

```python
            frozen_in = state.get("frozen_blocks") or []
            if frozen_in:
                frozen_labels = {b.label for b in frozen_in}
                # Frozen blocks are authoritative: drop any model re-emission of them.
                blocks = frozen_in + [b for b in blocks if b.label not in frozen_labels]
```

with:

```python
            frozen_in = state.get("frozen_blocks") or []
            if frozen_in:
                # Frozen blocks are authoritative. A task freezes all-or-nothing
                # (validation Rule 7), so a frozen task_id means EVERY block of that
                # task is final — drop any model re-emission carrying it, regardless
                # of its (possibly drifted) label. Null-task blocks dedupe by label.
                frozen_task_ids = {b.task_id for b in frozen_in if b.task_id is not None}
                frozen_labels = {b.label for b in frozen_in if b.task_id is None}

                def _is_frozen_reemission(b: TimeBlock) -> bool:
                    if b.task_id is not None:
                        return b.task_id in frozen_task_ids
                    return b.label in frozen_labels

                blocks = frozen_in + [b for b in blocks if not _is_frozen_reemission(b)]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_nodes.py -v`
Expected: PASS (all, including the existing `test_validate_merges_frozen_blocks_from_state` and `test_validate_drops_model_reemission_of_frozen`).

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/nodes.py tests/debate/test_nodes.py
git commit -m "fix: key frozen-block merge by task_id so drifted re-emissions drop"
```

---

### Task 5: Arbiter prompt — per-task split plan

**Files:**
- Modify: `src/weekforge/debate/nodes.py` (imports; `make_arbitrate_node` context, ~line 358-368)
- Test: `tests/debate/test_nodes.py`

**Interfaces:**
- Consumes: `block_plan` (Task 2).
- Produces: a `_fmt_task_plans(state) -> str` helper and a "REQUIRED BLOCK PLAN" section in the arbitrate context naming each over-long task's exact block count and durations.

- [ ] **Step 1: Write the failing test**

Add to `tests/debate/test_nodes.py`:

```python
def test_arbitrate_context_states_code_owned_block_plan(base_state):
    captured = {}

    class RecordingCouncil:
        def arbitrate(self, context: str) -> str:
            captured["context"] = context
            return "[]"

    state = {
        **base_state,
        "tasks": [Task(id="t1", title="Exam Prep", estimated_minutes=180, priority=1)],
        "proposals": {n: "p" for n in DEBATER_NAMES},
        "critiques": {n: "c" for n in DEBATER_NAMES},
        "round_number": 1,
        "preferences": Preferences(workday_start_hour=9, workday_end_hour=18, max_focus_minutes_per_block=45),
    }
    make_arbitrate_node(RecordingCouncil())(state)
    ctx = captured["context"]

    # 180min @ cap 45 -> exactly 4 blocks of 45min, code-owned.
    assert "Exam Prep" in ctx
    assert "4 blocks" in ctx
    assert "45min" in ctx
    assert "start times" in ctx.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/debate/test_nodes.py -k states_code_owned_block_plan -v`
Expected: FAIL (strings absent).

- [ ] **Step 3: Add the helper and inject it**

In `src/weekforge/debate/nodes.py`, add `block_plan` to the existing `from weekforge.debate.validation import (...)` group:

```python
from weekforge.debate.validation import (
    ValidationReport,
    _localize,
    block_plan,
    classify_blocks,
    remaining_focus_budget,
    underscheduled_tasks,
    validate_blocks,
)
```

Add this helper next to the other `_fmt_*` helpers (after `_fmt_prefs`):

```python
def _fmt_task_plans(state: DebateState) -> str:
    """Code-owned split plan per task: exact block count + durations + labels.

    The council chooses only each block's start time; it must not change how many
    blocks a task has or their durations.
    """
    cap = state["preferences"].max_focus_minutes_per_block
    lines = []
    for t in state["tasks"]:
        plan = block_plan(t.estimated_minutes, cap)
        if len(plan) == 1:
            lines.append(f"- {t.title} (task_id {t.id}): one block of {plan[0]}min.")
        else:
            n = len(plan)
            durs = ", ".join(f"{d}min" for d in plan)
            lines.append(
                f"- {t.title} (task_id {t.id}): EXACTLY {n} blocks of [{durs}], "
                f"labelled '{t.title} (1/{n})' … '{t.title} ({n}/{n})'. "
                f"Choose only their start times — do not change the count or durations."
            )
    return "\n".join(lines) if lines else "No tasks."
```

In the arbitrate `context`, replace the per-block-cap bullet (the lines starting `f"- No single block may exceed ...`) with a reference to the plan, and add the plan section after the HARD SCHEDULING CONSTRAINTS block. Concretely, change:

```python
            f"- When the workday window reaches midnight, end blocks at 23:59 local — never 00:00 of the next day.\n"
            f"- No single block may exceed {state['preferences'].max_focus_minutes_per_block} minutes. "
            f"Split a longer task into multiple blocks sharing the same task_id, each with a "
            f"distinct label (e.g. 'Report (1/2)', 'Report (2/2)').\n\n"
            f"Proposals:\n{proposals_text}\n\n"
```

to:

```python
            f"- When the workday window reaches midnight, end blocks at 23:59 local — never 00:00 of the next day.\n"
            f"- Each task is pre-split by the system into a fixed number of blocks with fixed durations "
            f"(see REQUIRED BLOCK PLAN). Reproduce that count and those durations exactly; choose only start times.\n\n"
            f"REQUIRED BLOCK PLAN (code-owned — do not change counts or durations):\n{_fmt_task_plans(state)}\n\n"
            f"Proposals:\n{proposals_text}\n\n"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_nodes.py -v`
Expected: PASS (all). The existing `test_arbitrate_context_includes_per_block_cap_and_split_rule` asserted `"task_id" in ctx and "distinct label" in ctx.lower()`; update it to match the new plan wording:

```python
def test_arbitrate_context_includes_per_block_cap_and_split_rule(base_state):
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
        "preferences": Preferences(),
    }
    make_arbitrate_node(RecordingCouncil())(state)
    ctx = captured["context"]
    assert "REQUIRED BLOCK PLAN" in ctx
    assert "task_id" in ctx
    assert "do not change the count or durations" in ctx.lower() or "choose only start times" in ctx.lower()
```

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/nodes.py tests/debate/test_nodes.py
git commit -m "feat: arbitrate context states code-owned per-task block plan"
```

---

### Task 6: Scoped-repair context — ledger, full constraints, transcript

**Files:**
- Modify: `src/weekforge/debate/nodes.py` (`make_arbitrate_node` scoped section, ~line 327-351)
- Test: `tests/debate/test_nodes.py`

**Interfaces:**
- Consumes: `block_plan` (Task 2), `_fmt_transcript_tail` (existing).
- Produces: a `_fmt_task_ledger(frozen_blocks, tasks, preferences) -> str` helper; the SCOPED REPAIR section now includes a per-task placement ledger, the full constraint set, and the round transcript tail.

- [ ] **Step 1: Write the failing test**

Add to `tests/debate/test_nodes.py`:

```python
def test_scoped_repair_includes_task_ledger_and_transcript(base_state):
    council = _CaptureCouncil()
    frozen = [
        TimeBlock(start=_utc(2026, 6, 20, 9), end=_utc(2026, 6, 20, 9, 45), label="Exam Prep (1/4)", task_id="t2"),
        TimeBlock(start=_utc(2026, 6, 20, 10), end=_utc(2026, 6, 20, 10, 45), label="Exam Prep (2/4)", task_id="t2"),
    ]
    state = {
        **base_state,
        "tasks": [
            Task(id="t1", title="Interview Prep", estimated_minutes=180, priority=1),
            Task(id="t2", title="Exam Prep", estimated_minutes=180, priority=2),
        ],
        "frozen_blocks": frozen,
        "validation_error": "BROKEN (re-place these only):\n  - Interview Prep: ...",
        "round_number": 2,
        "preferences": Preferences(workday_start_hour=9, workday_end_hour=18, max_focus_minutes_per_block=45, timezone=None),
        "transcript": [
            {"round": 1, "speaker": "DeadlineHawk", "content": "front-load the exam", "event_type": "proposal"},
        ],
    }
    make_arbitrate_node(council)(state)
    ctx = council.last_context

    assert "SCOPED REPAIR" in ctx
    # Per-task ledger: Exam Prep has 2 of 4 placed; Interview Prep 0 of 4.
    assert "Exam Prep" in ctx and "2 of 4" in ctx
    assert "Interview Prep" in ctx and "0 of 4" in ctx
    # Round transcript carried into scoped repair.
    assert "front-load the exam" in ctx
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/debate/test_nodes.py -k scoped_repair_includes_task_ledger -v`
Expected: FAIL (ledger + transcript absent from the scoped section).

- [ ] **Step 3: Add the ledger helper and enrich the scoped section**

In `src/weekforge/debate/nodes.py`, add the helper after `_fmt_task_plans` (Task 5):

```python
def _fmt_task_ledger(frozen_blocks, tasks, preferences) -> str:
    """Authoritative per-task accounting: blocks placed (frozen) vs the code-owned
    plan. Tells the Arbiter exactly how many more blocks each task still needs, so
    it never re-derives (and over-shoots) the split count across rounds.
    """
    cap = preferences.max_focus_minutes_per_block
    placed: dict[str, int] = {}
    for b in frozen_blocks:
        if b.task_id is not None:
            placed[b.task_id] = placed.get(b.task_id, 0) + 1
    lines = []
    for t in tasks:
        total = len(block_plan(t.estimated_minutes, cap))
        got = placed.get(t.id, 0)
        if got >= total:
            lines.append(f"- {t.title} (task_id {t.id}): {got} of {total} blocks placed → COMPLETE, add none.")
        else:
            lines.append(
                f"- {t.title} (task_id {t.id}): {got} of {total} blocks placed → place {total - got} more "
                f"(labelled up to ({total}/{total}))."
            )
    return "\n".join(lines)
```

Then, in the `scoped` string of `make_arbitrate_node`, extend it to carry the ledger, full constraints, and transcript. Replace the assignment of `scoped` (the block beginning `scoped = (` and ending at its closing `)`) with:

```python
            ledger = _fmt_task_ledger(frozen, state["tasks"], state["preferences"])
            p = state["preferences"]
            scoped = (
                "\n\nSCOPED REPAIR — the previous schedule was mostly valid. "
                "The blocks below are ALREADY FINAL. Do NOT move, resize, or drop them; "
                "place nothing that overlaps them:\n"
                f"{occupied}\n"
                "Remaining daily focus budget AFTER these fixed blocks (do not exceed):\n"
                f"{budget_lines}\n"
                "PER-TASK PLACEMENT LEDGER (authoritative — do not exceed the planned block count):\n"
                f"{ledger}\n"
                "ALL CONSTRAINTS STILL APPLY: "
                f"work window {p.workday_start_hour:02d}:00–{p.workday_end_hour:02d}:00 local, "
                f"max focus {p.max_focus_minutes_per_day}min/day, "
                f"max single block {p.max_focus_minutes_per_block}min, no crossing midnight.\n"
                "Debate so far (for context):\n"
                f"{_fmt_transcript_tail(state)}\n"
                "Output JSON for ONLY the tasks flagged as broken in the validation feedback above. "
                "Do NOT output the fixed blocks listed here — the system re-attaches them automatically. "
                "Do not place anything that overlaps them, and stay within the remaining daily budget."
            )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_nodes.py -v`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/nodes.py tests/debate/test_nodes.py
git commit -m "feat: enrich scoped repair with per-task ledger, constraints, transcript"
```

---

### Task 7: End-to-end regression + full-suite verification

**Files:**
- Test: `tests/debate/test_nodes.py`

**Interfaces:**
- Consumes: every prior task.

- [ ] **Step 1: Write the regression test**

Add to `tests/debate/test_nodes.py`, mirroring `test_dst_window_scenario_converges`'s `_echo` scaffolding. The Arbiter places Badminton (busy, outside window, over cap) plus two 180min tasks split into 4×45; the first attempt must converge without drift.

```python
def test_busy_block_and_split_tasks_converge_without_drift(mock_api_key):
    # Interview Prep + Exam Prep: 180min each, cap 45 -> 4×45 blocks each.
    # Badminton: a fixed commitment 20:30–22:30 (out of window, over cap, task_id=null).
    valid = (
        '['
        '{"start": "2026-06-19T09:00:00", "end": "2026-06-19T09:45:00", "label": "Interview Prep (1/4)", "task_id": "t1"},'
        '{"start": "2026-06-19T10:00:00", "end": "2026-06-19T10:45:00", "label": "Interview Prep (2/4)", "task_id": "t1"},'
        '{"start": "2026-06-19T11:00:00", "end": "2026-06-19T11:45:00", "label": "Interview Prep (3/4)", "task_id": "t1"},'
        '{"start": "2026-06-19T12:00:00", "end": "2026-06-19T12:45:00", "label": "Interview Prep (4/4)", "task_id": "t1"},'
        '{"start": "2026-06-20T09:00:00", "end": "2026-06-20T09:45:00", "label": "Exam Prep (1/4)", "task_id": "t2"},'
        '{"start": "2026-06-20T10:00:00", "end": "2026-06-20T10:45:00", "label": "Exam Prep (2/4)", "task_id": "t2"},'
        '{"start": "2026-06-20T11:00:00", "end": "2026-06-20T11:45:00", "label": "Exam Prep (3/4)", "task_id": "t2"},'
        '{"start": "2026-06-20T12:00:00", "end": "2026-06-20T12:45:00", "label": "Exam Prep (4/4)", "task_id": "t2"},'
        '{"start": "2026-06-19T20:30:00", "end": "2026-06-19T22:30:00", "label": "Badminton", "task_id": null}'
        ']'
    )

    class _Council:
        def arbitrate(self, context):
            return valid

    state = {
        "tasks": [
            Task(id="t1", title="Interview Prep", estimated_minutes=180, priority=1),
            Task(id="t2", title="Exam Prep", estimated_minutes=180, priority=2),
        ],
        "busy_blocks": [],
        "preferences": Preferences(workday_start_hour=9, workday_end_hour=18, max_focus_minutes_per_day=360, max_focus_minutes_per_block=45, timezone=None),
        "window_start": _utc(2026, 6, 19, 9),
        "window_end": _utc(2026, 6, 21, 18),
        "round_number": 1, "validation_attempts": 0, "max_validation_attempts": 3, "max_rounds": 3,
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

        state = {**state, **arbitrate(state)}
        result = validate(state)

    assert result["schedule"] is not None        # converges first pass, no retry
    labels = [b.label for b in result["schedule"].blocks]
    assert "Badminton" in labels                  # null block kept, not rejected
    interview = [l for l in labels if l.startswith("Interview Prep")]
    exam = [l for l in labels if l.startswith("Exam Prep")]
    assert len(interview) == 4
    assert len(exam) == 4
    # No drifted labels like (5/4)/(8/4): every split label is within the 4-block plan.
    valid_suffixes = {"(1/4)", "(2/4)", "(3/4)", "(4/4)"}
    assert all(l.split()[-1] in valid_suffixes for l in interview + exam)
```

- [ ] **Step 2: Run the regression test**

Run: `uv run pytest tests/debate/test_nodes.py -k busy_block_and_split_tasks_converge -v`
Expected: PASS (with Tasks 1-6 in place, the schedule validates on the first attempt).

- [ ] **Step 3: Full backend suite**

Run: `uv run pytest`
Expected: PASS (all).

- [ ] **Step 4: Frontend suite (unchanged, regression guard)**

Run: `cd frontend && npm test`
Expected: PASS (all — this plan does not touch the frontend).

- [ ] **Step 5: Commit**

```bash
git add tests/debate/test_nodes.py
git commit -m "test: end-to-end busy-block + split-task convergence without drift"
```

---

## Self-Review

**Spec coverage:**
- Phase 1 task-only guardrails (rules 2/3/5/6 + Rule 4 counting) → Task 1 ✓
- `block_plan` helper → Task 2 ✓
- Per-task conformance (sub-multiset) + all-or-nothing freezing → Task 3 ✓
- Freeze merge keyed by `task_id` → Task 4 ✓
- Arbiter prompt states code-owned plan → Task 5 ✓
- Scoped-repair ledger + full constraints + transcript → Task 6 ✓
- End-to-end regression mirroring the bug report → Task 7 ✓
- No persistence/API/frontend change → respected (only `validation.py`, `nodes.py`, tests touched); frontend suite run as a regression guard in Task 7 ✓

**Placeholder scan:** Every code step shows real code. The one sketch in Task 3 Step 1 is immediately replaced with the concrete `_tb` helper + full tests, and is explicitly flagged as a sketch to discard.

**Type consistency:** `block_plan(estimated_minutes, cap) -> list[int]` defined in Task 2, consumed identically in Tasks 3, 5, 6. `_fmt_task_plans(state)`, `_fmt_task_ledger(frozen_blocks, tasks, preferences)` introduced and used within their own tasks. The frozen-merge helper `_is_frozen_reemission(b)` is local to the validate node. Conformance error substring `"re-placed as a unit"` asserted in Task 3 matches the string emitted in Task 3 Step 3.
