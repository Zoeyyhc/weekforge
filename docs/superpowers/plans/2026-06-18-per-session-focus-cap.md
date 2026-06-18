# Per-session focus cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `max_focus_minutes_per_block` rhythm preference that hard-caps the duration of any single scheduled focus block, with council-driven splitting and a non-blocking under-scheduling warning.

**Architecture:** A new `Preferences` field becomes a Tier-1 deterministic guardrail (`classify_blocks` Rule 6) that rides the existing bounded scoped-repair loop. The Arbiter is prompted to split over-long tasks into multiple distinctly-labelled blocks sharing one `task_id`. A pure `underscheduled_tasks` helper surfaces dropped work as a non-blocking `validation_warnings` note on the validate success path. Frontend gains a fourth rhythm card.

**Tech Stack:** Python 3.12 / Pydantic / pytest (backend); Next.js 16 / TypeScript / Vitest (frontend).

## Global Constraints

- Default for the new field is **90** minutes; it applies retroactively to existing saved preferences (accepted).
- The field is a **hard guardrail** of equal standing to `max_focus_minutes_per_day` and the work window — never advisory.
- **Code never splits or fabricates blocks.** Splitting is the council's job, instructed via prompt.
- Reconciliation (`underscheduled_tasks`) is **non-blocking**: it never affects `report.ok`, never sets `degraded`, never forces a retry — it only populates `validation_warnings`.
- Constraint: `max_focus_minutes_per_block <= max_focus_minutes_per_day`.
- TDD: write the failing test before implementation. Mock Anthropic in node tests (`patch` on `weekforge.debate.nodes.Anthropic`); never call the real API.
- Arbiter still emits local wall-clock with NO offset; `validate` still merges authoritative frozen blocks in code. Do not touch the `X-WEEKFORGE:1` marker or any ICS path.

---

### Task 1: Preferences field + cross-field validator

**Files:**
- Modify: `src/weekforge/models.py:44-56` (the `Preferences` model)
- Test: `tests/test_models.py`

**Interfaces:**
- Produces: `Preferences.max_focus_minutes_per_block: int` (default 90, `gt=0`); a validator raising `ValueError` when `max_focus_minutes_per_block > max_focus_minutes_per_day`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_models.py
import pytest
from pydantic import ValidationError
from weekforge.models import Preferences


def test_preferences_default_max_focus_per_block_is_90():
    assert Preferences().max_focus_minutes_per_block == 90


def test_preferences_per_block_must_not_exceed_per_day():
    with pytest.raises(ValidationError):
        Preferences(max_focus_minutes_per_day=120, max_focus_minutes_per_block=240)


def test_preferences_per_block_equal_to_per_day_is_allowed():
    prefs = Preferences(max_focus_minutes_per_day=120, max_focus_minutes_per_block=120)
    assert prefs.max_focus_minutes_per_block == 120


def test_preferences_per_block_must_be_positive():
    with pytest.raises(ValidationError):
        Preferences(max_focus_minutes_per_block=0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_models.py -k max_focus_per_block -v`
Expected: FAIL (field/validator absent; default is currently undefined attribute).

- [ ] **Step 3: Add the field and validator**

In `src/weekforge/models.py`, add the field to `Preferences` (after `max_focus_minutes_per_day`):

```python
    max_focus_minutes_per_block: int = Field(default=90, gt=0)
```

Extend the existing `_end_after_start` validator body (it runs `mode="after"`) to also check the cap relationship, before `return self`:

```python
        if self.max_focus_minutes_per_block > self.max_focus_minutes_per_day:
            raise ValueError(
                "max_focus_minutes_per_block must not exceed max_focus_minutes_per_day"
            )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_models.py -v`
Expected: PASS (all, including existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/models.py tests/test_models.py
git commit -m "feat: add max_focus_minutes_per_block preference with cap validator"
```

---

### Task 2: Rule 6 — per-block focus cap guardrail

**Files:**
- Modify: `src/weekforge/debate/validation.py:72-126` (the per-block loop in `classify_blocks`)
- Test: `tests/debate/test_validate_blocks.py`

**Interfaces:**
- Consumes: `Preferences.max_focus_minutes_per_block` (Task 1).
- Produces: a `BlockReport.errors` entry for any block whose `duration_minutes` exceeds the per-block cap, making it non-`frozen`.

- [ ] **Step 1: Write the failing tests**

Match the construction style already in `tests/debate/test_validate_blocks.py` (build `TimeBlock`s, a `Task`, and `Preferences`, call `classify_blocks`).

```python
def test_block_over_per_block_cap_is_reported_and_not_frozen():
    prefs = Preferences(max_focus_minutes_per_block=90, max_focus_minutes_per_day=360)
    task = Task(id="t1", title="Report", estimated_minutes=180)
    block = TimeBlock(
        start=datetime(2026, 6, 16, 9, 0, tzinfo=timezone.utc),
        end=datetime(2026, 6, 16, 12, 0, tzinfo=timezone.utc),  # 180min
        label="Report",
        task_id="t1",
    )
    report = classify_blocks([block], [task], [], prefs)
    rep = report.reports[0]
    assert not rep.frozen
    assert any("single-focus cap" in e for e in rep.errors)


def test_block_at_per_block_cap_is_clean():
    prefs = Preferences(max_focus_minutes_per_block=90, max_focus_minutes_per_day=360)
    task = Task(id="t1", title="Report", estimated_minutes=90)
    block = TimeBlock(
        start=datetime(2026, 6, 16, 9, 0, tzinfo=timezone.utc),
        end=datetime(2026, 6, 16, 10, 30, tzinfo=timezone.utc),  # 90min
        label="Report",
        task_id="t1",
    )
    report = classify_blocks([block], [task], [], prefs)
    assert report.reports[0].frozen
```

(Add `from datetime import datetime, timezone` and the relevant imports if not already present at the top of the file — check the existing imports first and reuse them.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/debate/test_validate_blocks.py -k per_block -v`
Expected: FAIL (`test_block_over_per_block_cap...` — block is wrongly frozen).

- [ ] **Step 3: Implement Rule 6**

In `src/weekforge/debate/validation.py`, inside the `for rep in reports:` loop of `classify_blocks`, after the Rule 5 window check (around line 122) and before the `day = local_start.date()` line, add:

```python
        # Rule 6: single block must not exceed the per-block focus cap
        if block.duration_minutes > preferences.max_focus_minutes_per_block:
            rep.errors.append(
                f"Block '{block.label}': {block.duration_minutes}min exceeds "
                f"{preferences.max_focus_minutes_per_block}min single-focus cap"
            )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_validate_blocks.py -v`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/validation.py tests/debate/test_validate_blocks.py
git commit -m "feat: enforce per-block focus cap as classify_blocks Rule 6"
```

---

### Task 3: `underscheduled_tasks` reconciliation helper

**Files:**
- Modify: `src/weekforge/debate/validation.py` (add a new pure function near `remaining_focus_budget`)
- Test: `tests/debate/test_validate_blocks.py`

**Interfaces:**
- Produces: `underscheduled_tasks(blocks: list[TimeBlock], tasks: list[Task]) -> dict[str, tuple[int, int]]` — maps `task_id -> (scheduled_minutes, estimated_minutes)` for tasks whose scheduled total is strictly less than `estimated_minutes`. Blocks with `task_id=None` and tasks with no blocks-shortfall are excluded.

- [ ] **Step 1: Write the failing tests**

```python
from weekforge.debate.validation import underscheduled_tasks


def test_underscheduled_tasks_flags_short_task():
    tasks = [Task(id="t1", title="Report", estimated_minutes=180)]
    blocks = [
        TimeBlock(
            start=datetime(2026, 6, 16, 9, 0, tzinfo=timezone.utc),
            end=datetime(2026, 6, 16, 10, 30, tzinfo=timezone.utc),  # 90min
            label="Report (1/2)",
            task_id="t1",
        )
    ]
    assert underscheduled_tasks(blocks, tasks) == {"t1": (90, 180)}


def test_underscheduled_tasks_sums_multiple_blocks_and_omits_complete():
    tasks = [Task(id="t1", title="Report", estimated_minutes=180)]
    blocks = [
        TimeBlock(
            start=datetime(2026, 6, 16, 9, 0, tzinfo=timezone.utc),
            end=datetime(2026, 6, 16, 10, 30, tzinfo=timezone.utc),  # 90
            label="Report (1/2)", task_id="t1",
        ),
        TimeBlock(
            start=datetime(2026, 6, 16, 11, 0, tzinfo=timezone.utc),
            end=datetime(2026, 6, 16, 12, 30, tzinfo=timezone.utc),  # 90
            label="Report (2/2)", task_id="t1",
        ),
    ]
    assert underscheduled_tasks(blocks, tasks) == {}


def test_underscheduled_tasks_ignores_blocks_without_task_id():
    tasks = [Task(id="t1", title="Report", estimated_minutes=60)]
    blocks = [
        TimeBlock(
            start=datetime(2026, 6, 16, 9, 0, tzinfo=timezone.utc),
            end=datetime(2026, 6, 16, 10, 0, tzinfo=timezone.utc),
            label="Lunch", task_id=None,
        )
    ]
    assert underscheduled_tasks(blocks, tasks) == {"t1": (0, 60)}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/debate/test_validate_blocks.py -k underscheduled -v`
Expected: FAIL with ImportError / `underscheduled_tasks` not defined.

- [ ] **Step 3: Implement the helper**

In `src/weekforge/debate/validation.py`, add after `remaining_focus_budget`:

```python
def underscheduled_tasks(
    blocks: list[TimeBlock],
    tasks: list[Task],
) -> dict[str, tuple[int, int]]:
    """Per task_id: (scheduled_minutes, estimated_minutes) where scheduled < estimated.

    Used for a non-blocking warning: splitting an over-long task can silently
    drop work, so we surface any task whose scheduled minutes fall short.
    """
    scheduled: dict[str, int] = {}
    for b in blocks:
        if b.task_id is not None:
            scheduled[b.task_id] = scheduled.get(b.task_id, 0) + b.duration_minutes
    short: dict[str, tuple[int, int]] = {}
    for t in tasks:
        got = scheduled.get(t.id, 0)
        if got < t.estimated_minutes:
            short[t.id] = (got, t.estimated_minutes)
    return short
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_validate_blocks.py -k underscheduled -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/validation.py tests/debate/test_validate_blocks.py
git commit -m "feat: add underscheduled_tasks reconciliation helper"
```

---

### Task 4: Arbiter prompt — cap in prefs + split instruction

**Files:**
- Modify: `src/weekforge/debate/nodes.py:64-73` (`_fmt_prefs`) and `src/weekforge/debate/nodes.py:359-363` (arbitrate HARD SCHEDULING CONSTRAINTS list)
- Test: `tests/debate/test_nodes.py`

**Interfaces:**
- Consumes: `Preferences.max_focus_minutes_per_block` (Task 1).
- Produces: the per-block cap string in `_fmt_prefs` output and a split bullet in the arbitrate context.

- [ ] **Step 1: Write the failing test**

Mirror the existing `test_arbitrate_context_injects_prefs_busy_and_hard_constraints` (around line 117) which builds `base_state` and inspects the context the mock council receives. Add:

```python
def test_arbitrate_context_includes_per_block_cap_and_split_rule(mock_council, base_state):
    # base_state["preferences"] default has max_focus_minutes_per_block == 90
    arbitrate = make_arbitrate_node(mock_council)
    arbitrate(base_state)
    context = mock_council.last_arbitrate_context  # however the existing test reads it
    assert "single focus" in context.lower() or "90min" in context
    assert "task_id" in context and "distinct label" in context.lower()
```

NOTE: adapt the context-capture line to match how `test_arbitrate_context_injects_prefs_busy_and_hard_constraints` already retrieves the context (e.g. via `mock_council.arbitrate.call_args` or a recorded attribute). Read that test first and copy its mechanism exactly.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/debate/test_nodes.py -k per_block_cap_and_split -v`
Expected: FAIL (strings absent).

- [ ] **Step 3: Update the prompt strings**

In `_fmt_prefs`, change the `max focus` line to also state the per-block cap:

```python
        f"max focus {p.max_focus_minutes_per_day}min/day, "
        f"max single focus block {p.max_focus_minutes_per_block}min. "
```

In the arbitrate node's `context` HARD SCHEDULING CONSTRAINTS bullets (after the midnight bullets, ~line 363), add:

```python
            f"- No single block may exceed {state['preferences'].max_focus_minutes_per_block} minutes. "
            f"Split a longer task into multiple blocks sharing the same task_id, each with a "
            f"distinct label (e.g. 'Report (1/2)', 'Report (2/2)').\n"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_nodes.py -v`
Expected: PASS (all, including the existing prefs-injection test — verify the `max_focus ...min/day` substring it asserts still matches; adjust that assertion if it pinned the old trailing punctuation).

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/nodes.py tests/debate/test_nodes.py
git commit -m "feat: prompt Arbiter with per-block cap and split-into-blocks rule"
```

---

### Task 5: Non-blocking reconciliation warning on validate success

**Files:**
- Modify: `src/weekforge/debate/nodes.py:450-457` (the `report.ok` success return in `make_validate_node`)
- Test: `tests/debate/test_nodes.py`

**Interfaces:**
- Consumes: `underscheduled_tasks` (Task 3).
- Produces: on a successful validation, `validation_warnings` is a human-readable under-scheduling string when any task is short, else `None`. `degraded` stays `False`; `schedule` is still returned; no retry.

- [ ] **Step 1: Write the failing tests**

Follow the pattern of `test_validate_parses_valid_json_into_schedule` (mock `weekforge.debate.nodes.Anthropic` to return a JSON array; build `base_state` with a task whose `estimated_minutes` exceeds the returned blocks' total).

```python
def test_validate_success_warns_when_task_underscheduled(base_state, mock_api_key):
    # base_state has task t1 estimated 180min; Arbiter returns one 90min block.
    # ... set base_state["tasks"] = [Task(id="t1", title="Report", estimated_minutes=180)]
    # ... mock Anthropic content to a single 09:00-10:30 block for t1 (valid against window/caps)
    # ... run make_validate_node and assert success + warning
    assert result["schedule"] is not None
    assert result["degraded"] is False
    assert result["validation_warnings"] is not None
    assert "Report" in result["validation_warnings"] and "180" in result["validation_warnings"]


def test_validate_success_no_warning_when_fully_scheduled(base_state, mock_api_key):
    # task estimated equals returned block minutes -> no warning
    assert result["validation_warnings"] is None
```

Construct the mock Anthropic response and `base_state` exactly as the existing success tests do (read `test_validate_parses_valid_json_into_schedule` and `test_validate_success_clears_frozen_blocks` for the precise scaffolding, window/preferences, and `mock_api_key` fixture).

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/debate/test_nodes.py -k validate_success_warns -v`
Expected: FAIL (`validation_warnings` is currently hard-coded `None` on success).

- [ ] **Step 3: Implement the warning on the success path**

Add the import at the top of `nodes.py` (the `from weekforge.debate.validation import (...)` group already imports `remaining_focus_budget`):

```python
    underscheduled_tasks,
```

Replace the success return (currently sets `"validation_warnings": None`) with a computed warning:

```python
            short = underscheduled_tasks(blocks, state["tasks"])
            warning = None
            if short:
                titles = {t.id: t.title for t in state["tasks"]}
                warning = "Under-scheduled tasks (the council could not fit all estimated time): " + "; ".join(
                    f"{titles.get(tid, tid)}: only {got} of {est}min scheduled"
                    for tid, (got, est) in sorted(short.items())
                )
            return {
                "schedule": Schedule(blocks=blocks),
                "validation_error": None,
                "degraded": False,
                "validation_warnings": warning,
                "best_effort_schedule": None,
                "frozen_blocks": [],
            }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/debate/test_nodes.py -v`
Expected: PASS. Confirm `test_validate_success_clears_stale_best_effort_metadata` still passes — it expects `validation_warnings is None` for a fully-scheduled run; ensure that test's task/block minutes match (no shortfall) or update it to a fully-scheduled fixture.

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/nodes.py tests/debate/test_nodes.py
git commit -m "feat: surface under-scheduled tasks as non-blocking validation warning"
```

---

### Task 6: Persistence back-compat test (no code change)

**Files:**
- Test: `tests/auth/test_store.py`

**Interfaces:**
- Consumes: `UserStore.save_preferences` / `get_preferences`, `Preferences` (Task 1).

- [ ] **Step 1: Write the failing test**

```python
def test_old_preferences_without_per_block_loads_with_default(store):
    user = store.create_user("c@d.com", "pw", "Cy")
    # Simulate a row written before the field existed.
    legacy_json = (
        '{"workday_start_hour": 9, "workday_end_hour": 18, '
        '"max_focus_minutes_per_day": 360, "timezone": null}'
    )
    with store._connect() as conn:  # use the store's own connection helper
        conn.execute(
            "UPDATE users SET preferences = ? WHERE id = ?", (legacy_json, user.id)
        )
    prefs = store.get_preferences(user.id)
    assert prefs is not None
    assert prefs.max_focus_minutes_per_block == 90
```

NOTE: read `src/weekforge/auth/store.py` for the actual connection-helper name (e.g. `_connect`) and use it; if direct DB write is awkward, instead `save_preferences` a `Preferences()` and assert the round-trip default. The point is: a stored shape lacking the field deserializes to default 90.

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `uv run pytest tests/auth/test_store.py -k per_block -v`
Expected: PASS once Task 1 is merged (the default fills in). If it fails, the deserialization path needs the default — investigate before proceeding.

- [ ] **Step 3: Commit**

```bash
git add tests/auth/test_store.py
git commit -m "test: legacy preferences load with default per-block focus cap"
```

---

### Task 7: Frontend types + request builder

**Files:**
- Modify: `frontend/lib/types.ts:81-86` (`PreferencesInput`)
- Modify: `frontend/lib/buildRequest.ts:23-28` (`PrefsDraft`) and `:71-76` (the `preferences` mapping)
- Test: `frontend/lib/buildRequest.test.ts`

**Interfaces:**
- Produces: `PrefsDraft.maxFocusPerBlock: string`; request `preferences.max_focus_minutes_per_block: number`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/lib/buildRequest.test.ts`, matching the existing test that asserts the `preferences` mapping:

```ts
it("maps maxFocusPerBlock to max_focus_minutes_per_block", () => {
  const prefs = {
    workdayStartHour: "9",
    workdayEndHour: "18",
    maxFocusMinutes: "360",
    maxFocusPerBlock: "90",
  };
  const req = buildRequest([], [], prefs, "2026-06-15");
  expect(req.preferences?.max_focus_minutes_per_block).toBe(90);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- buildRequest`
Expected: FAIL (TS error on `maxFocusPerBlock` / undefined mapping).

- [ ] **Step 3: Implement the types and mapping**

In `frontend/lib/types.ts`, add to `PreferencesInput`:

```ts
  max_focus_minutes_per_block?: number;
```

In `frontend/lib/buildRequest.ts`, add to `PrefsDraft`:

```ts
  maxFocusPerBlock: string;
```

And in the `preferences` object of `buildRequest`, after `max_focus_minutes_per_day`:

```ts
      max_focus_minutes_per_block: Number(prefs.maxFocusPerBlock),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- buildRequest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/buildRequest.ts frontend/lib/buildRequest.test.ts
git commit -m "feat(frontend): carry max_focus_minutes_per_block through request builder"
```

---

### Task 8: Frontend rhythm card + state wiring

**Files:**
- Modify: `frontend/components/TaskForm.tsx:75-79` (`SEED_PREFS`), `:99-104` (`validatePrefs`), `:370-406` (rhythm-step grid + cards)
- Modify: `frontend/lib/auth.ts:9-13` (`SavedPreferences`)
- Modify: `frontend/app/app/page.tsx:71-76` (hydration) and `:157-162` (save block)
- Test: `frontend/components/TaskForm.test.tsx`

**Interfaces:**
- Consumes: `PrefsDraft.maxFocusPerBlock` (Task 7).
- Produces: a rendered `data-testid="pref-focus-block"` input bound to `prefs.maxFocusPerBlock`; `SavedPreferences.max_focus_minutes_per_block`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/components/TaskForm.test.tsx`, following the existing rhythm-step tests (navigate to step 2, query by testid):

```ts
it("renders the per-session focus card and updates it", async () => {
  // ...render TaskForm, advance to the rhythm step as the existing tests do...
  const input = screen.getByTestId("pref-focus-block") as HTMLInputElement;
  expect(input).toBeInTheDocument();
  fireEvent.change(input, { target: { value: "60" } });
  expect(input.value).toBe("60");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- TaskForm`
Expected: FAIL (`pref-focus-block` not found).

- [ ] **Step 3: Implement the card and wiring**

In `frontend/components/TaskForm.tsx`:

`SEED_PREFS` gains:

```ts
  maxFocusPerBlock: "90",
```

`validatePrefs` gains a guard mirroring the backend (after the start/end check):

```ts
  if (Number(prefs.maxFocusPerBlock) > Number(prefs.maxFocusMinutes))
    return "Per-session focus cannot exceed daily focus.";
```

Change the rhythm grid wrapper from `sm:grid-cols-3` to `sm:grid-cols-2`, and add a fourth `PrefCard` after the `🎯 Max Focus` card:

```tsx
                <PrefCard label="🔥 Per Session" hint="min / block">
                  <input
                    data-testid="pref-focus-block"
                    type="number"
                    min={0}
                    value={prefs.maxFocusPerBlock}
                    onChange={(e) => setPrefs((p) => ({ ...p, maxFocusPerBlock: e.target.value }))}
                    className="w-full border-0 border-b border-[#272430] bg-transparent py-1 font-mono text-2xl font-bold text-foreground outline-none transition-colors focus:border-ember"
                    aria-label="Max focus minutes per block"
                  />
                </PrefCard>
```

In `frontend/lib/auth.ts`, add to `SavedPreferences`:

```ts
  max_focus_minutes_per_block: number;
```

In `frontend/app/app/page.tsx` hydration block (`setInitialPrefs({...})`), add:

```ts
          maxFocusPerBlock: String(res.preferences.max_focus_minutes_per_block),
```

In the `handleStart` save block (`const prefs: SavedPreferences = {...}`), add:

```ts
        max_focus_minutes_per_block: p.max_focus_minutes_per_block ?? 90,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test`
Expected: PASS (TaskForm + the whole suite; fix any other spec that constructs a `PrefsDraft`/`SavedPreferences` literal without the new field — add `maxFocusPerBlock`/`max_focus_minutes_per_block` to those fixtures).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/TaskForm.tsx frontend/components/TaskForm.test.tsx frontend/lib/auth.ts frontend/app/app/page.tsx
git commit -m "feat(frontend): add per-session focus rhythm card and persistence"
```

---

### Task 9: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Backend suite**

Run: `uv run pytest`
Expected: PASS (all).

- [ ] **Step 2: Frontend suite**

Run: `cd frontend && npm test`
Expected: PASS (all).

- [ ] **Step 3: Confirm no stray fixtures broke**

If anything fails, it is almost certainly a test/fixture constructing `Preferences`, `PrefsDraft`, or `SavedPreferences` without the new field, or the existing `_fmt_prefs` substring assertion (Task 4). Fix the fixture/assertion, re-run, then stop — implementation is complete.

---

## Self-Review

**Spec coverage:**
- §1 model field + validator → Task 1 ✓
- §2 Rule 6 guardrail → Task 2 ✓
- §3 `underscheduled_tasks` + non-blocking warning → Task 3 (helper) + Task 5 (wiring) ✓
- §4 Arbiter prompt (cap + split, distinct labels) → Task 4 ✓
- §5 persistence back-compat → Task 6 ✓
- §6 API schema (no change) → covered implicitly by Task 1 (field rides `Preferences`); no dedicated task needed
- §7 frontend (types, buildRequest, TaskForm, hydration/save) → Tasks 7–8 ✓
- Testing section → each task is test-first; Task 9 is the full-suite gate ✓

**Placeholder scan:** Concrete code in every implementation step. Two NOTE callouts (Task 4 context-capture mechanism, Task 6 connection helper) direct the implementer to copy an existing, named test's mechanism rather than inventing one — these are pointers to real code, not placeholders.

**Type consistency:** `max_focus_minutes_per_block` (snake, backend + request), `maxFocusPerBlock` (camel, draft), `SavedPreferences.max_focus_minutes_per_block`, `underscheduled_tasks(blocks, tasks) -> dict[str, tuple[int, int]]` used identically in Tasks 3 and 5. Default `90` consistent across model, SEED_PREFS, save fallback.
