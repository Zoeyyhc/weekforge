# Spec: Debate 收敛性修复 + 主日历整合

> 设计文档。实现前请通读「风险与待核对」一节并完成其中的核对项。

## 背景

WeekForge 的 debate 引擎在真实数据下会陷入**无限 retry 直到 LangGraph `recursion_limit≈25` 崩溃**。根因是四个相互关联的缺陷:

1. **自污染回声循环(根因)**:`export_schedule` 把排程写进一个独立的 "WeekForge" 日历(`integration.py:101`),事件标题带 `[tN]` 编号。下次规划时 `list_calendars` 把该日历默认勾选(`integration.py:84`),于是上次的排程块被当成 busy 重新导入。Arbiter 想给任务 `t1` 排时间,却发现时段被「`t1` 的旧输出」占死 → 规则3 永远冲突 → 约束在数学上无解 → 无限 retry。
2. **`arbitrate↔validate` 无重试上限**(`graph.py:88-93`):validate 失败无条件弹回 arbitrate,没有计数器,任何无解/难解约束都会把图跑到 `recursion_limit` 崩掉。
3. **跨天块语义模糊**(`validate_blocks`,`nodes.py`):跨午夜的块只查 start、跳过 end 的工作窗口检查,放任 22:00–00:30 这类深夜跨天块「合法」通过,且规则4 日上限把跨天时长全算到 start 那天,统计失真。
4. **Arbiter 反复无视 `workday_start`**:模型有「9 点开工」的强先验,prompt 约束不够硬,每次都触发一轮 retry。

本 spec 一次性修这四个问题。其中 ①(主日历整合)是最大、风险最高的改动,核心安全目标是:**WeekForge 绝不修改任何「外来事件」(用户自己的真实日程)**。

---

## 改动① — 主日历 + 隐藏标记(取代独立 WeekForge 日历)

### 目标

- 排程直接写入用户**主日历**(`primary`),不再创建/使用独立 "WeekForge" 日历。
- 事件标题**干净**,不再带 `[tN]` 编号。
- 区分「自排块(可重排)」与「外来事件(固定约束)」靠一个**隐藏标记**,而非独立日历或标题前缀。
- **铁律:WeekForge 只创建/删除自己打过标记的事件,绝不读改删任何无标记的外来事件。**

### 标记机制

WeekForge 写入主日历的每个事件,带一个 Google Calendar 私有扩展属性:

```python
# src/weekforge/providers/google_calendar.py 模块常量
WEEKFORGE_MARKER_KEY = "weekforge"
WEEKFORGE_MARKER_VALUE = "1"
# events.list 过滤查询字符串
WEEKFORGE_MARKER_QUERY = "weekforge=1"
```

事件 body 形如:

```python
{
    "summary": block.label,                       # 干净标题,无 [tN]
    "start": {...}, "end": {...},
    "extendedProperties": {"private": {"weekforge": "1"}},
}
```

- `extendedProperties.private` 只对本应用 + 本用户可见,不污染事件显示。
- `events.list` 默认返回 `extendedProperties`(当前 `list_events` 未用 `fields` 投影,所以无需改动即可读到)。
- `events.list` 支持 `privateExtendedProperty="weekforge=1"` 做服务端过滤。

### 数据流

**导出(export_schedule):**
1. 目标日历固定为 `"primary"`。
2. **清理旧自排块**:用标记过滤列出本周范围内带标记的事件,逐个删除(见下「删除安全」)。
3. 逐块 `insert_event`,body 带 `extendedProperties.private.weekforge="1"`,标题为 `block.label`。

**导入(import_busy → GoogleCalendarProvider.get_busy_blocks):**
- 遍历每个事件,**按标记分流**:
  - 带 `weekforge` 标记 → **跳过**(这是上次自排块,本周要重排,不当 busy)。
  - 无标记 → 作为 fixed busy block(只读地当约束)。

**判定函数(provider 内部):**

```python
def _is_weekforge_event(event: dict) -> bool:
    private = (event.get("extendedProperties") or {}).get("private") or {}
    return private.get(WEEKFORGE_MARKER_KEY) == WEEKFORGE_MARKER_VALUE
```

### 删除安全(本改动的核心,必须钉死)

当前 `delete_events_in_range`(`google_calendar.py:78-90`)无差别删除整周所有事件。**写主日历时这会抹掉用户真实会议,是数据丢失事故。** 必须改为只删带标记的事件。

`GoogleCalendarClient` 协议与 `RealGoogleCalendarClient` 的 `delete_events_in_range` 增加可选参数:

```python
def delete_events_in_range(
    self, calendar_id: str, start: datetime, end: datetime,
    private_extended_property: str | None = None,
) -> None: ...
```

实现里把该参数透传给 `events.list(..., privateExtendedProperty=private_extended_property)`(为 `None` 时不加该过滤,保持旧行为以兼容现有调用方/测试)。

`GoogleCalendarWriter` 的删除调用**必须**传 `private_extended_property=WEEKFORGE_MARKER_QUERY`:

```python
self._client.delete_events_in_range(
    "primary", week_start, week_end,
    private_extended_property=WEEKFORGE_MARKER_QUERY,
)
```

> **不变量:** writer 的删除路径永远先按标记筛、再删筛出的结果;无标记事件不可能进入删除集合。这条由一个专门测试守住(见测试)。

### 受影响文件

- `src/weekforge/providers/google_calendar.py`
  - 加标记常量 + `_is_weekforge_event` 判定。
  - `GoogleCalendarClient` 协议 + `RealGoogleCalendarClient.delete_events_in_range` 增加 `private_extended_property` 参数。
  - `GoogleCalendarProvider.get_busy_blocks`:跳过带标记事件。
  - `GoogleCalendarWriter`:`__init__(client, target_calendar_id="primary")`(移除 `calendar_name`/`find_calendar`/`create_calendar` 逻辑);`write_blocks` 写 `primary`、插入带标记、删除用标记过滤。
- `src/weekforge/integration.py`
  - `export_schedule`:改用主日历写入(不再 `find/create` WeekForge 日历)。
  - `list_calendars`:移除针对 WeekForge 日历的特殊处理(不再有独立日历);`selected_by_default` 恢复对所有日历为 `True`,自污染已由标记机制根除。
  - `GoogleIntegration.__init__` 的 `calendar_name` 参数:移除或停用(若被其他调用方引用需一并清理)。
- `src/weekforge/auth/google_oauth.py`:**核对 scope**(见风险一节)。

### 已知边角(不在本 spec 解决)

用户**手动改过**的自排事件仍带标记,下次会被当自排忽略并在重排时删除 → 手动微调会丢失。是否「尊重手动改过的自排块」是独立产品问题,留待后续 spec。**此边角不影响「外来事件绝不被动」的核心保证。**

---

## 改动② — arbitrate prompt 强化工作窗口约束

### 目标

降低 Arbiter 产出越界块(早于 `workday_start`、晚于 `workday_end`、跨午夜)的概率,减少 retry。

### 改动

`src/weekforge/debate/nodes.py` 的 `make_arbitrate_node` 的 `context` 中,新增一段硬约束措辞(英文,与现有 prompt 一致),明确:

- 每个块 start 的 local hour 必须 ≥ `workday_start_hour`。
- 每个块 end 的 local hour 必须 ≤ `workday_end_hour`。
- 任何块**不得跨越午夜**(start 与 end 必须同一本地日期)。

行为由 LLM 决定,无法单测;测试只验证 arbitrate 注入的 context 字符串包含这些约束关键词(防止 prompt 被回退删除)。

---

## 改动③ — `validate_blocks` 禁止跨天块

### 目标

消除跨午夜块的模糊地带;禁止后,所有块都在单日内,规则4 日上限统计天然准确。

### 改动

`src/weekforge/debate/nodes.py` 的 `validate_blocks`,规则2 区域:

- 移除现有「跨天只查 start、跳过 end」的特殊分支。
- 新增:`local_start.date() != local_end.date()` → 报错,格式:
  `Block 'X': spans midnight (starts Mon 15 Jun, ends Tue 16 Jun); focus blocks must stay within one day`
- 非跨天块:同时检查 start ≥ `workday_start_hour` 且 end ≤ `workday_end_hour`(`workday_end_hour == 24` 视为午夜,允许当天 23:59 结束)。
- 规则4:因所有块单日,`minutes_per_day` 统计无需特殊处理。

---

## 改动④ — `arbitrate↔validate` 重试上限 + best-effort 收尾

### 目标

任何无解/难解约束最多重试 N 次(默认 3),超限后返回**最后一次能解析的** schedule(best-effort),交给前端已有的可编辑面板,而非把图跑崩。

### state 字段(`src/weekforge/debate/state.py`)

`DebateState` 新增:

```python
validation_attempts: int                  # validate 每次失败递增
max_validation_attempts: int              # 上限,runner 初始化(默认 3)
best_effort_schedule: Schedule | None     # 最后一次「能解析」的 schedule
```

(均为替换语义,非 reducer。)

### validate 节点(`make_validate_node`,`nodes.py`)

- 解析成功且语义通过 → `{schedule, validation_error: None}`(不变)。
- **语义失败**(blocks 能解析,只是违规):
  `{schedule: None, validation_error, best_effort_schedule: Schedule(blocks=blocks), validation_attempts: <prev+1>, transcript: [...]}`
- **解析失败**(连 blocks 都构造不出):
  `{schedule: None, validation_error, validation_attempts: <prev+1>, transcript: [...]}`(`best_effort_schedule` 保持原值)。
- `<prev+1>` = `state.get("validation_attempts", 0) + 1`。

### 路由(`_route_after_validate`,`graph.py`)

```python
def _route_after_validate(state: DebateState) -> str:
    if state.get("schedule") is not None:
        return "finalize"
    if state.get("validation_attempts", 0) >= state.get("max_validation_attempts", 3):
        return "finalize"
    return "arbitrate"
```

### finalize 节点(`finalize_node`,`nodes.py`)

```python
def finalize_node(state: DebateState) -> dict:
    schedule = state.get("schedule")
    if schedule is None:
        best = state.get("best_effort_schedule")
        if best is not None:
            event = {
                "round": state["round_number"],
                "speaker": "System",
                "content": (
                    f"Exceeded {state.get('max_validation_attempts', 3)} validation "
                    "retries; returning best-effort schedule (may contain semantic issues)."
                ),
                "event_type": "system",
            }
            return {"schedule": best, "transcript": [event]}
    return {"schedule": schedule}
```

(`schedule` 与 `best_effort_schedule` 皆无时,返回 `schedule=None` —— 彻底无可解析输出的真失败。)

### runner(`run_debate`,`runner.py`)

- 新增参数 `max_validation_attempts: int = 3`。
- 初始 `DebateState` 增加 `validation_attempts=0`、`max_validation_attempts=<param>`、`best_effort_schedule=None`。

---

## 测试要求

### 改动①(`tests/test_google_calendar.py`、`tests/test_integration_calendars.py`)

- **导出打标记**:`write_blocks` 插入的每个事件 body 含 `extendedProperties.private.weekforge == "1"`,且 `summary` 不含 `[t`。
- **导出写 primary**:写入目标 `calendar_id == "primary"`,不调用 `create_calendar`。
- **删除只删带标记**(安全测试,必须有):FakeClient 主日历预置「1 个带标记事件 + 1 个无标记外来事件」,跑 `write_blocks` 后,**无标记事件仍在**,带标记旧事件被删。
- **删除走标记过滤**:`delete_events_in_range` 收到 `private_extended_property="weekforge=1"`。
- **导入分流**:provider 读到「带标记 + 无标记」混合事件时,`get_busy_blocks` 只返回无标记事件对应的 busy block。
- FakeGoogleCalendarClient 需支持 `extendedProperties` 存储与 `privateExtendedProperty` 过滤。

### 改动②(`tests/debate/test_nodes.py`)

- arbitrate 节点的 context 字符串包含工作窗口下限/上限/禁止跨午夜的关键措辞。

### 改动③(`tests/debate/test_validate_blocks.py`)

- 跨午夜块 → 报错含 "spans midnight"。
- 非跨天且 end 晚于 `workday_end` → 报错含 "after work window"。
- `test_workday_end_24_allows_late_blocks`(22:00–23:00 同日)仍通过。

### 改动④(`tests/debate/test_nodes.py`、`tests/debate/test_graph.py`)

- 语义失败时 validate 返回的 `best_effort_schedule` 为含解析块的 `Schedule`,且 `validation_attempts` 递增。
- `_route_after_validate`:`validation_attempts >= max` 且无 `schedule` → `"finalize"`;未达上限 → `"arbitrate"`。
- finalize 在无 `schedule` 但有 `best_effort_schedule` 时返回 best-effort 并加 system transcript 事件。
- 解析始终失败(无 best-effort)→ finalize 返回 `schedule=None`。

### 回归

`uv run pytest tests/` 全绿。

---

## 不在本 spec 范围

- 尊重用户手动改过的自排事件(标记冲突的产品决策)。
- 跨周边界检查(`week_start` 到 `week_start+7d` 的硬校验);`week_start` 目前是 `str | None`,需先统一类型。
- Arbiter 改用 `tool_use` 结构化输出(更大的重构)。
- 多 target 日历导出(始终写 `primary`)。

---

## 风险与待核对(实现第一步)

1. **OAuth scope**:写主日历 events 需要写权限。当前已能 `create_calendar` + `insert_event`,推断写 scope(`https://www.googleapis.com/auth/calendar` 或 `calendar.events`)已具备 —— **核对 `src/weekforge/auth/google_oauth.py` 的 scopes 列表确认**。若 scope 变更,既有 OAuth token 需重新授权(`weekforge_tokens.json` 失效)。
2. **`extendedProperties` 读取**:确认 `events.list` 响应在测试 FakeClient 与真实 API 下都带 `extendedProperties`(真实 API 默认带;FakeClient 需补)。
3. **`delete_events_in_range` 旧调用方**:增加可选参数后,确认现有调用方/测试不受影响(默认 `None` 保持旧行为)。
4. **`GoogleIntegration.calendar_name`**:移除前 grep 全仓确认无其他引用。
5. **msgpack 反序列化告警**(`weekforge.models.Task/TimeBlock/Preferences` 未注册):本 spec 不处理,但 ④ 新增 `best_effort_schedule: Schedule` 进 checkpoint 会加重该告警面;记录为后续待办。
