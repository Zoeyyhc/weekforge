# Debate 收敛性修复(②③④)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 debate 引擎在无解/难解约束下有界终止(arbitrate↔validate 最多重试 N 次后返回 best-effort schedule),并通过强化 arbiter prompt + 禁止跨午夜块降低 retry 概率,彻底消除「跑到 `recursion_limit≈25` 崩溃」。

**Architecture:** 三处协同改动 ——(②)给 arbitrate 节点注入真实 preferences/busy 数值与硬约束措辞;(③)`validate_blocks` 禁止跨午夜块;(④)在 `DebateState` 加重试计数 + best-effort schedule,`_route_after_validate` 加上限路由,`finalize` 在超限时交付 best-effort 并打降级标志,`runner` 初始化计数字段并把降级标志透传到 `done` 事件。

**Tech Stack:** Python, LangGraph (StateGraph + SqliteSaver), Anthropic SDK (mocked in tests), pytest, `uv`。

**对应 spec:** `docs/superpowers/specs/2026-06-16-debate-convergence-mainline-calendar-design.md` 的「改动②③④」。改动①(主日历整合)是已完成的独立 plan,不在此处。

**前置约定:**
- 命令工作目录:仓库根(或执行时的隔离 worktree 根)。
- 测试运行器:`uv run pytest`。
- 在 feature 分支/worktree 上实现(勿直接提交主分支)。

---

## File Structure

| 文件 | 职责 | 改动 |
|------|------|------|
| `src/weekforge/debate/nodes.py` | LangGraph 节点 + `validate_blocks` 纯函数 | ③ 改 `validate_blocks`;② 改 `make_arbitrate_node` 的 context;④ 改 `make_validate_node` 返回值 + `finalize_node` |
| `src/weekforge/debate/state.py` | `DebateState` TypedDict | ④ 新增 `validation_attempts`/`max_validation_attempts`/`best_effort_schedule`/`degraded`/`validation_warnings` |
| `src/weekforge/debate/graph.py` | StateGraph 装配 + 路由 | ④ 改 `_route_after_validate` 加重试上限 |
| `src/weekforge/debate/runner.py` | 流式 runner + `DebateResult` | ④ 新增 `max_validation_attempts` 参数、初始化新 state 字段、`done` 事件加 `degraded`/`validation_warnings` |
| 对应 `tests/debate/*` | 单测 | 每个改动配套测试 |

> **任务顺序理由:** ③(纯函数,最独立)→ ②(prompt 字符串)→ ④ 拆 4 步(state+validate → route → finalize → runner)。④ 各步单测独立成立,全部完成后图才端到端有界终止。

---

## Task 1: ③ `validate_blocks` 禁止跨午夜块

**Files:**
- Modify: `src/weekforge/debate/nodes.py` — `validate_blocks` 的 Rule 2 区域(当前在 `# Rule 2: block must start within work window (local time)` 注释起,到 `# Rule 3` 之前)
- Test: `tests/debate/test_validate_blocks.py`

- [ ] **Step 1: Write the failing tests**

在 `tests/debate/test_validate_blocks.py` 末尾追加:

```python
# ── Rule 2: no cross-midnight blocks ─────────────────────────────────────────

def test_cross_midnight_block_is_reported():
    # Starts 22:00 on the 15th, ends 00:30 on the 16th → spans midnight.
    blocks = [_block("Night owl", 22, 0, start_day=15, end_day=16)]
    prefs = Preferences(workday_start_hour=8, workday_end_hour=24)
    errors = validate_blocks(blocks, [], [], prefs)
    assert len(errors) == 1
    assert "spans midnight" in errors[0]
    assert "Night owl" in errors[0]


def test_same_day_block_after_work_end_is_reported():
    # Same-day block ending 19:00 with workday_end_hour=18 → after work window.
    blocks = [_block("Overtime", 9, 19)]
    errors = validate_blocks(blocks, [], [], Preferences(workday_start_hour=9, workday_end_hour=18))
    assert len(errors) == 1
    assert "after work window" in errors[0]
    assert "19:00" in errors[0]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/debate/test_validate_blocks.py::test_cross_midnight_block_is_reported tests/debate/test_validate_blocks.py::test_same_day_block_after_work_end_is_reported -v`
Expected: `test_cross_midnight_block_is_reported` FAILS (current code skips end-check for cross-day blocks and never emits "spans midnight"). `test_same_day_block_after_work_end_is_reported` should PASS already (same-day end check exists) — that's fine, it's a regression guard.

- [ ] **Step 3: Replace the Rule 2 region in `validate_blocks`**

In `src/weekforge/debate/nodes.py`, find this block inside `validate_blocks`:

```python
        # Rule 2: block must start within work window (local time)
        if local_start.hour + local_start.minute / 60 < preferences.workday_start_hour:
            errors.append(
                f"Block '{block.label}': starts {local_start.strftime('%H:%M')} local, "
                f"before work window {preferences.workday_start_hour:02d}:00"
            )
        # Check end time only for same-day blocks and when end_hour < 24
        cross_day = local_start.date() != local_end.date()
        if not cross_day and preferences.workday_end_hour < 24:
            if local_end.hour + local_end.minute / 60 > preferences.workday_end_hour:
                errors.append(
                    f"Block '{block.label}': ends {local_end.strftime('%H:%M')} local, "
                    f"after work window {preferences.workday_end_hour:02d}:00"
                )
```

Replace it entirely with:

```python
        # Rule 2: block must stay within one local day and inside the work window.
        cross_day = local_start.date() != local_end.date()
        if cross_day:
            errors.append(
                f"Block '{block.label}': spans midnight "
                f"(starts {local_start.strftime('%a %d %b')}, "
                f"ends {local_end.strftime('%a %d %b')}); "
                f"focus blocks must stay within one day"
            )
        else:
            if local_start.hour + local_start.minute / 60 < preferences.workday_start_hour:
                errors.append(
                    f"Block '{block.label}': starts {local_start.strftime('%H:%M')} local, "
                    f"before work window {preferences.workday_start_hour:02d}:00"
                )
            # workday_end_hour == 24 means midnight; same-day blocks ending by 23:59 are fine.
            if preferences.workday_end_hour < 24:
                if local_end.hour + local_end.minute / 60 > preferences.workday_end_hour:
                    errors.append(
                        f"Block '{block.label}': ends {local_end.strftime('%H:%M')} local, "
                        f"after work window {preferences.workday_end_hour:02d}:00"
                    )
```

(Leave the rest of `validate_blocks` — Rule 1, Rule 3, Rule 4, the `minutes_per_day` accumulation — unchanged.)

- [ ] **Step 4: Run the full validate_blocks suite to verify pass + no regressions**

Run: `uv run pytest tests/debate/test_validate_blocks.py -v`
Expected: PASS — all existing tests (including `test_workday_end_24_allows_late_blocks`, `test_local_timezone_applied_for_work_window`, `test_block_before_work_start_is_reported`) plus the 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/nodes.py tests/debate/test_validate_blocks.py
git commit -m "feat: reject cross-midnight focus blocks in validate_blocks"
```

End the commit message with the trailer:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Task 2: ② arbitrate prompt 注入 preferences/busy + 硬约束

**Files:**
- Modify: `src/weekforge/debate/nodes.py` — `make_arbitrate_node` 的 `context` 字符串
- Test: `tests/debate/test_nodes.py`

Context: 当前 `make_arbitrate_node` 的 context **不含** `_fmt_prefs` 和 `_fmt_busy`,arbiter 看不到工作窗口/时区/focus 上限/固定占用,这是它反复越界触发 retry 的根因。本任务把真实数值注入,并叠加硬约束措辞(含「不得跨午夜、午夜窗口用 23:59 收尾」,与 Task 1 的 `validate_blocks` 一致)。`_fmt_prefs` 与 `_fmt_busy` 已是模块级函数,直接复用。

- [ ] **Step 1: Write the failing test**

在 `tests/debate/test_nodes.py` 的 `# ── arbitrate ───` 区段内追加:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/debate/test_nodes.py::test_arbitrate_context_injects_prefs_busy_and_hard_constraints -v`
Expected: FAIL — current context has no "Work hours", "Standup", or "HARD SCHEDULING CONSTRAINTS".

- [ ] **Step 3: Update the context in `make_arbitrate_node`**

In `src/weekforge/debate/nodes.py`, inside `make_arbitrate_node`'s `arbitrate` function, find:

```python
        week_label = state.get("week_start") or "this week"
        context = (
            f"Week to schedule: {week_label} (Monday) through the following Sunday.\n"
            f"All datetimes in the JSON output MUST fall within this week and MUST include a UTC offset.\n\n"
            f"Tasks:\n{_fmt_tasks(state)}\n\n"
            f"Proposals:\n{proposals_text}\n\n"
            f"Critiques:\n{critiques_text}"
            f"{human_note}{prev_error}"
        )
```

Replace it with:

```python
        week_label = state.get("week_start") or "this week"
        context = (
            f"Week to schedule: {week_label} (Monday) through the following Sunday.\n"
            f"All datetimes in the JSON output MUST fall within this week and MUST include a UTC offset.\n\n"
            f"Tasks:\n{_fmt_tasks(state)}\n\n"
            f"Fixed commitments this week:\n{_fmt_busy(state)}\n\n"
            f"User preferences: {_fmt_prefs(state)}\n\n"
            f"HARD SCHEDULING CONSTRAINTS (violating any of these forces a retry):\n"
            f"- Every block's START local hour must be at or after the workday start hour above.\n"
            f"- Every block's END local hour must be at or before the workday end hour above.\n"
            f"- No block may cross midnight: a block's start and end MUST fall on the same local date.\n"
            f"- When the workday window reaches midnight, end blocks at 23:59 local — never 00:00 of the next day.\n\n"
            f"Proposals:\n{proposals_text}\n\n"
            f"Critiques:\n{critiques_text}"
            f"{human_note}{prev_error}"
        )
```

- [ ] **Step 4: Run test to verify it passes + no regressions**

Run: `uv run pytest tests/debate/test_nodes.py -v`
Expected: PASS — the new test plus all existing arbitrate/node tests (e.g. `test_arbitrate_calls_council_and_adds_transcript`, `test_arbitrate_includes_human_input_when_present`).

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/nodes.py tests/debate/test_nodes.py
git commit -m "feat: inject preferences, busy blocks, and hard window constraints into arbiter prompt"
```

End the commit message with the trailer:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Task 3: ④a state 字段 + validate 节点 best-effort/计数

**Files:**
- Modify: `src/weekforge/debate/state.py` — `DebateState`
- Modify: `src/weekforge/debate/nodes.py` — `make_validate_node`
- Test: `tests/debate/test_state.py`、`tests/debate/test_nodes.py`

### Step group A — state fields

- [ ] **Step 1: Write the failing state-shape test**

In `tests/debate/test_state.py`, update `test_debate_state_shape` by adding the three core retry fields to `required_keys`:

```python
def test_debate_state_shape():
    import typing
    hints = typing.get_type_hints(DebateState)
    required_keys = {
        "tasks", "busy_blocks", "preferences", "max_rounds",
        "round_number", "proposals", "critiques", "converged",
        "interrupt_reason", "human_input", "arbiter_output",
        "validation_error", "schedule", "transcript",
        "validation_attempts", "max_validation_attempts", "best_effort_schedule",
    }
    assert required_keys.issubset(hints.keys()), f"Missing keys: {required_keys - hints.keys()}"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run pytest tests/debate/test_state.py::test_debate_state_shape -v`
Expected: FAIL — `Missing keys: {'validation_attempts', 'max_validation_attempts', 'best_effort_schedule'}`.

- [ ] **Step 3: Add the fields to `DebateState`**

In `src/weekforge/debate/state.py`, the file currently imports `from typing import Annotated, NotRequired, TypedDict`. In the `DebateState` class, find the arbitration/output section:

```python
    # ── Arbitration & output ───────────────────────────────────────────────
    arbiter_output: str | None     # raw text from Arbiter's synthesis
    validation_error: str | None   # non-None if schedule parsing failed
    schedule: Schedule | None      # structured output; set by validate_node
```

Replace it with:

```python
    # ── Arbitration & output ───────────────────────────────────────────────
    arbiter_output: str | None     # raw text from Arbiter's synthesis
    validation_error: str | None   # non-None if schedule parsing failed
    schedule: Schedule | None      # structured output; set by validate_node

    # ── Retry bound + best-effort fallback ─────────────────────────────────
    validation_attempts: int               # incremented on each validate failure
    max_validation_attempts: int           # cap; set by runner (default 3)
    best_effort_schedule: Schedule | None   # last schedule that parsed, even if semantically invalid
    degraded: NotRequired[bool]            # finalize sets True when delivering best-effort
    validation_warnings: NotRequired[str | None]  # the semantic violations carried with a degraded result
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/debate/test_state.py -v`
Expected: PASS (all state tests).

### Step group B — validate node

- [ ] **Step 5: Write the failing validate-node tests**

In `tests/debate/test_nodes.py`, in the `# ── validate ───` section, add:

```python
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
```

- [ ] **Step 6: Run to verify they fail**

Run: `uv run pytest tests/debate/test_nodes.py::test_validate_semantic_fail_returns_best_effort_and_increments_attempts tests/debate/test_nodes.py::test_validate_parse_fail_increments_attempts_without_best_effort -v`
Expected: FAIL — current validate node returns neither `best_effort_schedule` nor `validation_attempts`.

- [ ] **Step 7: Update `make_validate_node`**

In `src/weekforge/debate/nodes.py`, inside `make_validate_node`'s `validate` function, find the semantic-failure return:

```python
            if errors:
                error_msg = "Schedule failed semantic validation:\n" + "\n".join(
                    f"  - {e}" for e in errors
                )
                event = {
                    "round": state["round_number"],
                    "speaker": "System",
                    "content": f"{error_msg}\nRetrying arbitration.",
                    "event_type": "validation_fail",
                }
                return {"schedule": None, "validation_error": error_msg, "transcript": [event]}
            return {"schedule": Schedule(blocks=blocks), "validation_error": None}
```

Replace it with:

```python
            if errors:
                error_msg = "Schedule failed semantic validation:\n" + "\n".join(
                    f"  - {e}" for e in errors
                )
                event = {
                    "round": state["round_number"],
                    "speaker": "System",
                    "content": f"{error_msg}\nRetrying arbitration.",
                    "event_type": "validation_fail",
                }
                return {
                    "schedule": None,
                    "validation_error": error_msg,
                    # Blocks parsed fine — keep them as the best-effort fallback.
                    "best_effort_schedule": Schedule(blocks=blocks),
                    "validation_attempts": state.get("validation_attempts", 0) + 1,
                    "transcript": [event],
                }
            return {"schedule": Schedule(blocks=blocks), "validation_error": None}
```

Then find the parse-failure return (the `except Exception` branch):

```python
        except Exception as exc:
            error_msg = str(exc)
            event = {
                "round": state["round_number"],
                "speaker": "System",
                "content": f"Schedule parsing failed: {error_msg}. Retrying arbitration.",
                "event_type": "validation_fail",
            }
            return {"schedule": None, "validation_error": error_msg, "transcript": [event]}
```

Replace its return statement with (add only the `validation_attempts` key — do NOT add `best_effort_schedule`, so any prior value is preserved by LangGraph):

```python
        except Exception as exc:
            error_msg = str(exc)
            event = {
                "round": state["round_number"],
                "speaker": "System",
                "content": f"Schedule parsing failed: {error_msg}. Retrying arbitration.",
                "event_type": "validation_fail",
            }
            return {
                "schedule": None,
                "validation_error": error_msg,
                "validation_attempts": state.get("validation_attempts", 0) + 1,
                "transcript": [event],
            }
```

- [ ] **Step 8: Run to verify pass + no regressions**

Run: `uv run pytest tests/debate/test_nodes.py -v`
Expected: PASS — new tests plus existing validate tests (`test_validate_parses_valid_json_into_schedule`, `test_validate_sets_error_on_semantic_violation`, `test_validate_sets_error_on_invalid_json`).

- [ ] **Step 9: Commit**

```bash
git add src/weekforge/debate/state.py src/weekforge/debate/nodes.py tests/debate/test_state.py tests/debate/test_nodes.py
git commit -m "feat: track validation attempts and capture best-effort schedule on failure"
```

End the commit message with the trailer:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Task 4: ④b `_route_after_validate` 重试上限

**Files:**
- Modify: `src/weekforge/debate/graph.py` — `_route_after_validate`
- Test: `tests/debate/test_graph.py`

- [ ] **Step 1: Write the failing tests**

In `tests/debate/test_graph.py`, after `test_route_invalid_schedule_goes_to_arbitrate`, add:

```python
def test_route_retries_arbitrate_when_under_cap():
    state = {"schedule": None, "validation_attempts": 1, "max_validation_attempts": 3}
    assert _route_after_validate(state) == "arbitrate"


def test_route_finalizes_when_attempts_reach_cap():
    state = {"schedule": None, "validation_attempts": 3, "max_validation_attempts": 3}
    assert _route_after_validate(state) == "finalize"
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest tests/debate/test_graph.py::test_route_finalizes_when_attempts_reach_cap -v`
Expected: FAIL — current `_route_after_validate` returns "arbitrate" whenever `schedule is None`, ignoring the attempt count.

- [ ] **Step 3: Update `_route_after_validate`**

In `src/weekforge/debate/graph.py`, find:

```python
def _route_after_validate(state: DebateState) -> str:
    if state.get("schedule") is not None:
        return "finalize"
    return "arbitrate"
```

Replace it with:

```python
def _route_after_validate(state: DebateState) -> str:
    if state.get("schedule") is not None:
        return "finalize"
    # Bound the arbitrate↔validate loop: after the cap, hand off the best-effort
    # schedule to finalize instead of retrying into recursion_limit.
    if state.get("validation_attempts", 0) >= state.get("max_validation_attempts", 3):
        return "finalize"
    return "arbitrate"
```

- [ ] **Step 4: Run to verify pass + no regressions**

Run: `uv run pytest tests/debate/test_graph.py -v`
Expected: PASS — new tests plus existing routing tests (`test_route_valid_schedule_goes_to_finalize`, `test_route_invalid_schedule_goes_to_arbitrate` — the latter still routes to "arbitrate" because attempts default to 0 < 3).

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/graph.py tests/debate/test_graph.py
git commit -m "feat: cap arbitrate-validate retries and route to finalize when exhausted"
```

End the commit message with the trailer:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Task 5: ④c `finalize_node` best-effort + 降级标志

**Files:**
- Modify: `src/weekforge/debate/nodes.py` — `finalize_node`
- Test: `tests/debate/test_nodes.py`

- [ ] **Step 1: Write the failing tests**

In `tests/debate/test_nodes.py`, in the `# ── finalize ───` section (keep the existing `test_finalize_returns_schedule_unchanged`), add:

```python
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
    assert any(e["event_type"] == "system" for e in result["transcript"])


def test_finalize_returns_none_when_no_schedule_and_no_best_effort(base_state):
    state = {**base_state, "schedule": None, "best_effort_schedule": None}
    result = finalize_node(state)
    assert result["schedule"] is None
    assert result.get("degraded") in (None, False)
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest tests/debate/test_nodes.py::test_finalize_delivers_best_effort_when_no_valid_schedule tests/debate/test_nodes.py::test_finalize_returns_none_when_no_schedule_and_no_best_effort -v`
Expected: FAIL — current `finalize_node` just returns `{"schedule": state["schedule"]}` (would `KeyError`/return None, no `degraded`).

- [ ] **Step 3: Rewrite `finalize_node`**

In `src/weekforge/debate/nodes.py`, find:

```python
def finalize_node(state: DebateState) -> dict:
    """Terminal node — passes the validated schedule through unchanged."""
    return {"schedule": state["schedule"]}
```

Replace it with:

```python
def finalize_node(state: DebateState) -> dict:
    """Terminal node.

    Normally passes the validated schedule through. If validation never produced
    a clean schedule but an earlier attempt parsed into blocks, deliver that
    best-effort schedule flagged as degraded so the UI can mark it for review.
    """
    schedule = state.get("schedule")
    if schedule is None:
        best = state.get("best_effort_schedule")
        if best is not None:
            warning = (
                f"Exceeded {state.get('max_validation_attempts', 3)} validation "
                "retries; returning best-effort schedule (may contain semantic issues)."
            )
            event = {
                "round": state["round_number"],
                "speaker": "System",
                "content": warning,
                "event_type": "system",
            }
            return {
                "schedule": best,
                "degraded": True,
                "validation_warnings": state.get("validation_error") or warning,
                "transcript": [event],
            }
    return {"schedule": schedule}
```

- [ ] **Step 4: Run to verify pass + no regressions**

Run: `uv run pytest tests/debate/test_nodes.py -v`
Expected: PASS — new tests plus `test_finalize_returns_schedule_unchanged` (schedule present → returns `{"schedule": schedule}`, no `degraded`).

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/nodes.py tests/debate/test_nodes.py
git commit -m "feat: deliver best-effort schedule with degraded flag from finalize"
```

End the commit message with the trailer:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Task 6: ④d runner 初始化字段 + `done` 事件降级标志 + 全量回归

**Files:**
- Modify: `src/weekforge/debate/runner.py` — `run_debate`、`DebateResult`
- Test: `tests/debate/test_runner.py`

- [ ] **Step 1: Write the failing tests**

In `tests/debate/test_runner.py`, add:

```python
def test_run_debate_initialises_retry_fields(mock_council, mock_api_key, sample_tasks, sample_busy, sample_prefs):
    with patch("weekforge.debate.runner.build_graph") as mock_build:
        mock_graph = MagicMock()
        mock_build.return_value = mock_graph
        mock_graph.stream.return_value = iter([
            {"finalize": {"schedule": Schedule(), "transcript": []}},
        ])

        list(run_debate(
            tasks=sample_tasks, busy_blocks=sample_busy, preferences=sample_prefs,
            thread_id="retry-init", api_key=mock_api_key, council=mock_council,
        ))

        stream_arg = mock_graph.stream.call_args.args[0]
        assert stream_arg["validation_attempts"] == 0
        assert stream_arg["max_validation_attempts"] == 3
        assert stream_arg["best_effort_schedule"] is None


def test_run_debate_done_event_carries_degraded_flag(mock_council, mock_api_key, sample_tasks, sample_busy, sample_prefs):
    best = Schedule()
    with patch("weekforge.debate.runner.build_graph") as mock_build:
        mock_graph = MagicMock()
        mock_build.return_value = mock_graph
        mock_graph.stream.return_value = iter([
            {"finalize": {
                "schedule": best,
                "degraded": True,
                "validation_warnings": "Exceeded 3 validation retries; returning best-effort schedule.",
                "transcript": [],
            }},
        ])

        events = list(run_debate(
            tasks=sample_tasks, busy_blocks=sample_busy, preferences=sample_prefs,
            thread_id="degraded-thread", api_key=mock_api_key, council=mock_council,
        ))

    done = [e for e in events if e["type"] == "done"][0]
    assert done["degraded"] is True
    assert "Exceeded" in done["validation_warnings"]


def test_run_debate_done_event_defaults_not_degraded(mock_council, mock_api_key, sample_tasks, sample_busy, sample_prefs):
    with patch("weekforge.debate.runner.build_graph") as mock_build:
        mock_graph = MagicMock()
        mock_build.return_value = mock_graph
        mock_graph.stream.return_value = iter([
            {"finalize": {"schedule": Schedule(), "transcript": []}},
        ])

        events = list(run_debate(
            tasks=sample_tasks, busy_blocks=sample_busy, preferences=sample_prefs,
            thread_id="clean-thread", api_key=mock_api_key, council=mock_council,
        ))

    done = [e for e in events if e["type"] == "done"][0]
    assert done["degraded"] is False
    assert done["validation_warnings"] is None
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest tests/debate/test_runner.py::test_run_debate_initialises_retry_fields tests/debate/test_runner.py::test_run_debate_done_event_carries_degraded_flag -v`
Expected: FAIL — initial `DebateState` lacks the retry fields (KeyError on `stream_arg["validation_attempts"]`), and the `done` event has no `degraded` key.

- [ ] **Step 3: Add `max_validation_attempts` param + init fields**

In `src/weekforge/debate/runner.py`, find the `run_debate` signature:

```python
def run_debate(
    tasks: list[Task],
    busy_blocks: list[TimeBlock],
    preferences: Preferences,
    thread_id: str,
    api_key: str,
    council: Council,
    max_rounds: int = 3,
    db_path: str = "weekforge.db",
    resume_value: str | None = None,
    require_human_on_stall: bool = True,
    week_start: str | None = None,
) -> Generator[dict[str, Any], None, None]:
```

Add `max_validation_attempts: int = 3` (place it right after `max_rounds`):

```python
def run_debate(
    tasks: list[Task],
    busy_blocks: list[TimeBlock],
    preferences: Preferences,
    thread_id: str,
    api_key: str,
    council: Council,
    max_rounds: int = 3,
    max_validation_attempts: int = 3,
    db_path: str = "weekforge.db",
    resume_value: str | None = None,
    require_human_on_stall: bool = True,
    week_start: str | None = None,
) -> Generator[dict[str, Any], None, None]:
```

Then find the initial `DebateState(...)` construction:

```python
        stream_input = DebateState(
            tasks=tasks,
            busy_blocks=busy_blocks,
            preferences=preferences,
            max_rounds=max_rounds,
            week_start=week_start,
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

Replace it with (add the three retry fields):

```python
        stream_input = DebateState(
            tasks=tasks,
            busy_blocks=busy_blocks,
            preferences=preferences,
            max_rounds=max_rounds,
            week_start=week_start,
            round_number=0,
            proposals={},
            critiques={},
            converged=False,
            interrupt_reason=None,
            human_input=None,
            arbiter_output=None,
            validation_error=None,
            schedule=None,
            validation_attempts=0,
            max_validation_attempts=max_validation_attempts,
            best_effort_schedule=None,
            transcript=[],
        )
```

- [ ] **Step 4: Capture degraded flag + emit it on the done event**

Still in `run_debate`, find:

```python
    final_schedule: Schedule | None = None
    interrupted = False
```

Replace with:

```python
    final_schedule: Schedule | None = None
    degraded = False
    validation_warnings: str | None = None
    interrupted = False
```

Then find the node-output loop:

```python
            # Stream transcript events from any node update
            for node_name, node_output in chunk.items():
                if not isinstance(node_output, dict):
                    continue
                for event in node_output.get("transcript", []):
                    yield {
                        "type": "debate_event",
                        "round": event["round"],
                        "speaker": event["speaker"],
                        "content": event["content"],
                        "event_type": event["event_type"],
                    }
                if "schedule" in node_output and node_output["schedule"] is not None:
                    final_schedule = node_output["schedule"]
```

Replace it with (add degraded capture):

```python
            # Stream transcript events from any node update
            for node_name, node_output in chunk.items():
                if not isinstance(node_output, dict):
                    continue
                for event in node_output.get("transcript", []):
                    yield {
                        "type": "debate_event",
                        "round": event["round"],
                        "speaker": event["speaker"],
                        "content": event["content"],
                        "event_type": event["event_type"],
                    }
                if "schedule" in node_output and node_output["schedule"] is not None:
                    final_schedule = node_output["schedule"]
                if node_output.get("degraded"):
                    degraded = True
                    validation_warnings = node_output.get("validation_warnings")
```

Then find the done emit:

```python
        if not interrupted:
            yield {"type": "done", "schedule": final_schedule, "thread_id": thread_id}
```

Replace with:

```python
        if not interrupted:
            yield {
                "type": "done",
                "schedule": final_schedule,
                "degraded": degraded,
                "validation_warnings": validation_warnings,
                "thread_id": thread_id,
            }
```

- [ ] **Step 5: Extend the `DebateResult` TypedDict**

In `src/weekforge/debate/runner.py`, the imports include `from typing import Any, Generator, TypedDict`. Change that line to add `NotRequired`:

```python
from typing import Any, Generator, NotRequired, TypedDict
```

Then find:

```python
class DebateResult(TypedDict):
    thread_id: str
    schedule: Schedule | None
    transcript: list[dict]
```

Replace with:

```python
class DebateResult(TypedDict):
    thread_id: str
    schedule: Schedule | None
    transcript: list[dict]
    degraded: NotRequired[bool]
    validation_warnings: NotRequired[str | None]
```

- [ ] **Step 6: Run to verify pass + no regressions**

Run: `uv run pytest tests/debate/test_runner.py -v`
Expected: PASS — new tests plus all existing runner tests (`test_run_debate_yields_done_event_with_schedule`, `test_debate_result_shape`, interrupt/resume tests).

- [ ] **Step 7: Full regression**

Run: `uv run pytest tests/ -q`
Expected: ALL green. Report the exact final line (e.g. "157 passed"). If any test outside this plan's scope is red, STOP and report it.

- [ ] **Step 8: Commit**

```bash
git add src/weekforge/debate/runner.py tests/debate/test_runner.py
git commit -m "feat: initialise retry fields and surface degraded flag on done event"
```

End the commit message with the trailer:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Self-Review

**1. Spec coverage (改动②③④ 全部要点):**
- ② arbitrate 注入真实 `_fmt_prefs` + `_fmt_busy` + 硬约束(含 23:59 收尾)→ Task 2;测试验证含真实工作窗口数值/busy/约束关键词。
- ③ `validate_blocks` 禁止跨午夜 + 同日 end 检查 + `workday_end==24` 允许晚块 → Task 1;测试覆盖 spans-midnight、after-work-window、`test_workday_end_24_allows_late_blocks` 仍通过。
- ④ state 字段 → Task 3A;validate best-effort/计数 → Task 3B;`_route_after_validate` 上限 → Task 4;finalize best-effort + degraded → Task 5;runner 初始化 + done 契约(degraded/validation_warnings)+ `DebateResult` → Task 6。
- 回归 `uv run pytest tests/` 全绿 → Task 6 Step 7。
- ②③ 一致性(23:59 收尾)→ Task 2 prompt 与 Task 1 校验措辞一致。

**2. Placeholder scan:** 无 TBD/TODO;每个代码步骤给出完整替换代码 + 确切命令 + 预期结果。

**3. Type consistency:** 字段名 `validation_attempts`/`max_validation_attempts`/`best_effort_schedule`/`degraded`/`validation_warnings` 在 state.py(Task 3)、nodes.py validate/finalize(Task 3/5)、graph.py route(Task 4)、runner.py(Task 6)各处一致;`max_validation_attempts` 默认 3 在 state 注释、route 默认、runner 参数三处统一;`finalize` 写 `degraded=True`/`validation_warnings`,runner 以同名键读取并放入 `done` 事件,键名匹配。

**已知非目标(spec「不在范围」):** 跨周边界硬校验、Arbiter 改 `tool_use` 结构化输出、msgpack 反序列化告警(④ 新增 `best_effort_schedule: Schedule` 进 checkpoint 会加重该告警面,记录为后续待办)、前端消费 `degraded` 标志(本 plan 定义 `done` 契约,前端改动另行跟进)。
