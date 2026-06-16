# Spec: Guardrail + Local-time Debaters

## 问题

两个相关但独立的缺陷：

1. **Debaters 看到 UTC 时间**：`_fmt_busy` 用 `strftime` 直接格式化 UTC-aware datetime，没有转本地时间，也没有标注 "UTC"。Debaters 拿错误的时间窗口推理。

2. **Validate 只做结构校验**：`make_validate_node` 只验证 JSON 能解析、end > start。调度是否在工作时间内、是否与 busy blocks 冲突——完全不检查。

---

## 变更范围

只动 `src/weekforge/debate/nodes.py`，新增对应测试。

---

## Change 1：`_fmt_busy` 转本地时间

**位置**：`nodes.py:39-44`

**Before**：
```python
def _fmt_busy(state: DebateState) -> str:
    lines = [
        f"- {b.label}: {b.start.strftime('%a %d %b %H:%M')}–{b.end.strftime('%H:%M')}"
        for b in state["busy_blocks"]
    ]
```

**After**：
```python
def _fmt_busy(state: DebateState) -> str:
    tz_name = state["preferences"].timezone
    tz = ZoneInfo(tz_name) if tz_name else timezone.utc
    lines = [
        f"- {b.label}: "
        f"{b.start.astimezone(tz).strftime('%a %d %b %H:%M')}–"
        f"{b.end.astimezone(tz).strftime('%H:%M')} local"
        for b in state["busy_blocks"]
    ]
```

**要点**：
- 无 timezone 时 fallback 到 UTC（保持现有行为，加 "local" 标注至少让 AI 知道这是真实语义）
- 不改函数签名，不影响其他调用方

---

## Change 2：提取纯函数 `validate_blocks`

新增一个**纯函数**，与 LangGraph 状态无关，方便单独测试：

```python
def validate_blocks(
    blocks: list[TimeBlock],
    tasks: list[Task],
    busy_blocks: list[TimeBlock],
    preferences: Preferences,
) -> list[str]:
    """返回所有语义错误的描述列表。空列表 = 通过。"""
```

**四条规则，按优先级排列**：

| # | 规则 | 错误信息格式 |
|---|---|---|
| 1 | `task_id` 必须是已知 ID 或 `None` | `"Block 'X': unknown task_id 't99'"` |
| 2 | 块必须在工作时间窗口内（本地时间） | `"Block 'X': starts 02:00 local, before work window 12:00"` |
| 3 | 块不得与任何 busy block 时间重叠 | `"Block 'X': overlaps with busy 'Meeting' (12:00–13:00 local)"` |
| 4 | 每日总专注时间不超过 `max_focus_minutes_per_day` | `"Mon 15 Jun: 480min scheduled, exceeds 360min/day limit"` |

**规则 2 的边界处理**：
- `workday_end_hour = 24` 视为午夜，即当天 23:59:59 结束的块合法
- 跨天的块（开始日期 ≠ 结束日期）只检查开始时间的 local hour

---

## Change 3：在 `make_validate_node` 里调用 guardrail

在现有 Pydantic 解析**成功后**，立即调用 `validate_blocks`：

```python
blocks = [TimeBlock(...) for b in blocks_data]
errors = validate_blocks(
    blocks,
    state["tasks"],
    state["busy_blocks"],
    state["preferences"],
)
if errors:
    error_msg = "Schedule failed semantic validation:\n" + "\n".join(f"  - {e}" for e in errors)
    # → 触发现有 retry 路由，errors 喂回 Arbiter 的下次 prompt
    return {"schedule": None, "validation_error": error_msg, "transcript": [...]}

return {"schedule": Schedule(blocks=blocks), "validation_error": None}
```

retry 路由和 Arbiter 的 `prev_error` 注入已存在，**不需要改 graph.py**。

---

## 测试要求

新增 `tests/debate/test_validate_blocks.py`，覆盖：

- `task_id` 不在已知列表 → 报错
- 块开始时间早于 `workday_start_hour`（本地）→ 报错
- 块与 busy block 重叠 → 报错
- 每日超出 `max_focus_minutes_per_day` → 报错
- 所有规则都满足 → 空列表
- `preferences.timezone = None` 时不崩溃（fallback UTC）

`_fmt_busy` 测试（已有文件里加 case）：
- UTC+10 环境下，UTC `12:00` 的 busy block 显示为 `22:00 local`

---

## 不在此 Spec 内

- Arbiter 改用 `tool_use` 结构化输出（更大的重构，独立做）
- 跨周边界检查（`week_start` 到 `week_start + 7d`）——暂缓，`week_start` 目前是 `str | None`，需要先统一类型
