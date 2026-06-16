# Spec: Debate 收敛性修复 + 主日历整合

> 设计文档。实现前请通读「风险与待核对」一节并完成其中的核对项。

## 背景

WeekForge 的 debate 引擎在真实数据下会陷入**无限 retry 直到 LangGraph `recursion_limit≈25` 崩溃**。根因是四个相互关联的缺陷:

1. **自污染回声循环(根因)**:`export_schedule` 把排程写进一个独立的 "WeekForge" 日历(`integration.py:101`),事件标题带 `[tN]` 编号。下次规划时 `list_calendars` 把该日历默认勾选(`integration.py:84`),于是上次的排程块被当成 busy 重新导入。Arbiter 想给任务 `t1` 排时间,却发现时段被「`t1` 的旧输出」占死 → 规则3 永远冲突 → 约束在数学上无解 → 无限 retry。
2. **`arbitrate↔validate` 无重试上限**(`graph.py:88-93`):validate 失败无条件弹回 arbitrate,没有计数器,任何无解/难解约束都会把图跑到 `recursion_limit` 崩掉。
3. **跨天块语义模糊**(`validate_blocks`,`nodes.py`):跨午夜的块只查 start、跳过 end 的工作窗口检查,放任 22:00–00:30 这类深夜跨天块「合法」通过,且规则4 日上限把跨天时长全算到 start 那天,统计失真。
4. **Arbiter 反复无视 `workday_start`**:模型有「9 点开工」的强先验,prompt 约束不够硬,每次都触发一轮 retry。

本 spec 一次性修这四个问题。其中 ①(主日历整合)是最大、风险最高的改动,核心安全目标是:**WeekForge 绝不修改任何「外来事件」(用户自己的真实日程)**。

### 实现拆分建议

- **改动① 单独成一个 plan / 单独 PR**,与 ②③④ 分开 —— 它独占全部数据安全面,review 与回归应聚焦。内部 TDD 严格排序:
  1. client 协议 + `RealGoogleCalendarClient` 加 `private_extended_property` 参数 + 客户端 `_is_weekforge_event` 复核;FakeClient 补 `extendedProperties` 存储与过滤(含「过滤失效」可注入行为)。
  2. **先写安全测试(S2,red)** → 再写 provider 跳过标记 + Writer 写 `primary`/打标记/带过滤+复核删除。
  3. integration + `api/server.py` 接线、清理 `calendar_name`。
- **②③④ 合成一个 plan**。④ 虽碰 state/nodes/graph/runner 四文件但语义内聚,按「state 字段 → validate 返回 → 路由 → finalize → runner 初始化 → done 契约」顺序 TDD。

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
- **安全基石(必须在实现中保持的假设):** `extendedProperties.private` **无法通过 Google Calendar 普通 UI 设置**,只能由本应用经 API 写入。因此用户的任何真实会议都不可能「碰巧」带上 `weekforge=1` 标记 —— 标记是 WeekForge 独占的。这条假设是整个删除铁律安全性的根基。

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

**纵深防御(必须):服务端过滤之外,删除循环里再加一道客户端复核。** 服务端 `privateExtendedProperty` 过滤是第一道防线,但它是远端的、单点的:一旦参数被传成 `None`、拼写错、库版本丢掉 query 串、或 API 行为变化,`events.list` 就会返回整周所有事件 → 在 primary 上逐个删除 = 抹掉用户真实会议。因此 `delete_events_in_range` 的删除循环**必须**在调 delete 之前用 `_is_weekforge_event` 本地复核每个事件:

```python
for event in resp.get("items", []):
    # 安全网:即便服务端过滤失效,本地也绝不删无标记事件。
    if private_extended_property is not None and not _is_weekforge_event(event):
        continue
    self._svc.events().delete(calendarId=calendar_id, eventId=event["id"]).execute()
```

> 注意:安全检查只能放在 client 的 delete 方法内,因为 Writer 把 list+delete 一起委托给 client,Writer 本身看不到事件列表。(可选更干净的重构:把 Writer 改成「自己 `list_events`(带标记过滤)→ 逐个 `_is_weekforge_event` 核对 → 按 id 删」,让持有铁律的 Writer 层直接掌控删除集合,并在该层做安全测试。本 spec 采用上面的 client 内复核方案,重构留作后续可选项。)

`GoogleCalendarWriter` 的删除调用**必须**传 `private_extended_property=WEEKFORGE_MARKER_QUERY`:

```python
self._client.delete_events_in_range(
    "primary", week_start, week_end,
    private_extended_property=WEEKFORGE_MARKER_QUERY,
)
```

> **不变量:** writer 的删除路径有两道独立防线 —— ① 服务端 `privateExtendedProperty` 过滤;② 客户端 `_is_weekforge_event` 复核。无标记事件即使绕过①也会被②挡下,不可能进入 delete 调用。这条由专门测试守住(见测试 S2)。

### 受影响文件

- `src/weekforge/providers/google_calendar.py`
  - 加标记常量 + `_is_weekforge_event` 判定。
  - `GoogleCalendarClient` 协议 + `RealGoogleCalendarClient.delete_events_in_range` 增加 `private_extended_property` 参数。
  - `GoogleCalendarProvider.get_busy_blocks`:跳过带标记事件。
  - `GoogleCalendarWriter`:`__init__(client, target_calendar_id="primary")`(移除 `calendar_name`/`find_calendar`/`create_calendar` 逻辑);`write_blocks` 写 `primary`、插入带标记、删除用标记过滤 + 客户端复核。
- `src/weekforge/integration.py`
  - `export_schedule`:改用主日历写入(不再 `find/create` WeekForge 日历)。
  - `list_calendars`:移除注释里针对 WeekForge 输出日历的特殊说明(不再有独立日历)。`selected_by_default` 维持对所有日历为 `True` —— **注意现状已是全 `True`(`integration.py:84`),本改动只是删掉那条提到 WeekForge 日历的注释**,不是「恢复」。自污染已由标记机制 + `get_busy_blocks` 跳过标记根除。
  - `GoogleIntegration.__init__` 的 `calendar_name` 参数:移除。
- **`calendar_name` 清理点位(grep 已确认,必须一并改,否则启动/测试报错):**
  - `src/weekforge/api/server.py:36,41` —— `WEEKFORGE_CALENDAR_NAME` 环境变量读取 + 传入 `GoogleIntegration(calendar_name=...)`,移除。
  - `tests/test_google_calendar.py`(多处 `GoogleCalendarWriter(client, calendar_name="WeekForge")`、`find_calendar`/`create_calendar` 断言)、`tests/test_integration_calendars.py:41` —— 随接口改写。
- `src/weekforge/auth/google_oauth.py`:**已核对,scope 充足,无需改动**(见风险一节)。

### 已知边角(不在本 spec 解决)

- 用户**手动改过**的自排事件仍带标记,下次会被当自排忽略并在重排时删除 → 手动微调会丢失。是否「尊重手动改过的自排块」是独立产品问题,留待后续 spec。**此边角不影响「外来事件绝不被动」的核心保证。**
- **分页未处理**:`list_events` / `delete_events_in_range` 均未处理 `nextPageToken`(默认 250 条/页)。每周标记事件数远小于 250,实务无碍;且对删除是 **fail-safe**(漏页 → 残留旧标记块,不会误删外来事件)。记录为已知限制,后续如遇超量再补分页。

---

## 改动② — arbitrate prompt 强化工作窗口约束

### 目标

降低 Arbiter 产出越界块(早于 `workday_start`、晚于 `workday_end`、跨午夜)的概率,减少 retry。

### 根因订正:arbiter 当前根本没拿到 preferences 和 busy

审查代码确认:`make_arbitrate_node` 的 `context`(`nodes.py:260-267`)只含 tasks、proposals、critiques、human_note、prev_error —— **既没有 `_fmt_prefs`,也没有 `_fmt_busy`**。arbiter 不知道工作窗口、时区、focus 上限,也不直接知道固定占用,全靠从 proposals 文本二手推断。所以背景里的「根因#4:Arbiter 反复无视 `workday_start`」很大程度上不是 prior 太强,而是**根本没把工作窗口数值告诉它**。仅加抽象措辞治标不治本。

### 改动

`src/weekforge/debate/nodes.py` 的 `make_arbitrate_node` 的 `context`:

1. **注入真实 preferences 数值**:加入 `_fmt_prefs(state)`(含 `workday_start_hour`/`workday_end_hour`/timezone/`max_focus_minutes_per_day` 的具体值),与 `gather_proposals` 一致。
2. **注入固定占用**:加入 `_fmt_busy(state)`,让 arbiter 直接看到需避让的 busy 块(减少规则3 overlap 冲突的二手猜测)。
3. **在上述数值基础上叠加硬约束措辞**(英文,与现有 prompt 一致),明确:
   - 每个块 start 的 local hour 必须 ≥ `workday_start_hour`(用真实数值)。
   - 每个块 end 的 local hour 必须 ≤ `workday_end_hour`(用真实数值)。
   - 任何块**不得跨越午夜**(start 与 end 必须同一本地日期)。
   - **当工作窗口延伸到午夜(`workday_end_hour == 24`)时,块结束时间用 `23:59`,不要用次日 `00:00`** —— 否则会与改动③ 的「禁止跨午夜」判定冲突(00:00 落在次日 → 被判 spans midnight → 触发 retry)。见改动③ 的边界说明。

行为由 LLM 决定,无法单测;测试验证 arbitrate 注入的 context 字符串包含 ① 真实工作窗口数值/时区(`_fmt_prefs` 输出特征)、② 工作窗口下限/上限/禁止跨午夜/23:59 收尾的关键措辞(防止 prompt 被回退删除)。

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

> **边界说明(与改动② 协同):** 判定用 `local_start.date() != local_end.date()`,所以**结束于次日 00:00 的块(如 23:00–00:00)会被判 spans midnight**。这是有意为之 —— 当窗口到午夜时,合法块应以 `23:59` 收尾,而非 `00:00`。改动② 的 prompt 已显式要求模型用 23:59,二者必须保持一致,否则会在「最后一小时」反复刷 retry。

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
degraded: NotRequired[bool]               # finalize 交付 best-effort 时置 True
validation_warnings: NotRequired[str | None]  # 降级时携带的语义违规说明
```

(均为替换语义,非 reducer。)`degraded`/`validation_warnings` 由 finalize 在交付 best-effort 时写入,供 runner 透出到 `done` 事件(见下「done 事件契约」)。

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

(`schedule` 与 `best_effort_schedule` 皆无时,返回 `schedule=None` —— 彻底无可解析输出的真失败。clean 路径不写 `degraded`,默认视为 `False`。)

### runner(`run_debate`,`runner.py`)

- 新增参数 `max_validation_attempts: int = 3`。
- 初始 `DebateState` 增加 `validation_attempts=0`、`max_validation_attempts=<param>`、`best_effort_schedule=None`。
- 流式循环中,从 finalize 的 node_output 捕获 `degraded` / `validation_warnings`(像捕获 `schedule` 一样)。

### done 事件契约(必须,防止 best-effort 被当成功)

审查确认 `finalize` 的 best-effort 输出会经 runner → SSE(`routes.py:46`)**原样**转发给前端,而当前 `done` 事件**没有降级标志** —— 语义违规的 best-effort 与经完整 validation 的合格 schedule 在前端看来一模一样,只有 transcript 里一条 System 文本作为线索。这正是「把违规结果当成功误导用户」的真实通路。

`done` 事件 schema 扩展为:

```python
yield {
    "type": "done",
    "schedule": final_schedule,
    "degraded": bool,                 # True = best-effort,含未解决的语义违规
    "validation_warnings": str | None,  # degraded 时的违规说明,供 UI 展示
    "thread_id": thread_id,
}
```

前端据 `degraded` 把可编辑面板标成「需人工核对」,不得仅依赖 transcript 文本。`DebateResult` TypedDict(`runner.py`)同步加 `degraded`/`validation_warnings` 字段。

> **前端改动不在本 spec 的代码范围内**,但本 spec **拥有** `done` 事件的契约,故必须在此定义;前端消费该标志作为后续跟进项。

---

## 测试要求

### 改动①(`tests/test_google_calendar.py`、`tests/test_integration_calendars.py`)

- **导出打标记**:`write_blocks` 插入的每个事件 body 含 `extendedProperties.private.weekforge == "1"`,且 `summary` 不含 `[t`。
- **导出写 primary**:写入目标 `calendar_id == "primary"`,不调用 `create_calendar`。
- **删除只删带标记**(安全测试,必须有):FakeClient 主日历预置「1 个带标记事件 + 1 个无标记外来事件」,跑 `write_blocks` 后,**无标记事件仍在**,带标记旧事件被删。
- **删除走标记过滤**:`delete_events_in_range` 收到 `private_extended_property="weekforge=1"`。
- **[S2] 反向锁定 —— writer 永不传 None**:断言 Writer 的删除调用**始终**带 `private_extended_property=WEEKFORGE_MARKER_QUERY`,绝不为 `None`(防止重构时漏传退回无差别删除)。
- **[S2] 客户端复核挡住过滤失效**:让 FakeClient 在收到过滤参数时**故意返回一个无标记事件**(模拟服务端没过滤),断言删除循环的 `_is_weekforge_event` 复核把它跳过 —— 无标记事件**不被删**。(没有改动① 的客户端复核,此测试无法通过;它正是纵深防御的回归守卫。)
- **导入分流**:provider 读到「带标记 + 无标记」混合事件时,`get_busy_blocks` 只返回无标记事件对应的 busy block。
- FakeGoogleCalendarClient 需支持 `extendedProperties` 存储与 `privateExtendedProperty` 过滤。

> **测试边界说明:** FakeClient 的过滤逻辑由我们自己实现,故安全测试证明的是「过滤正确时契约成立」与「过滤失效时客户端复核兜底」,**不能**证明真实 Google API 的过滤语义 —— 后者需在实现第一步用真账号做一次手动 smoke 验证(见风险一节)。

### 改动②(`tests/debate/test_nodes.py`)

- arbitrate 节点的 context 字符串包含**真实工作窗口数值/时区**(`_fmt_prefs` 输出特征,如 `Work hours 9:00–17:00`)与固定占用(`_fmt_busy` 输出),证明 preferences/busy 已注入。
- arbitrate context 包含工作窗口下限/上限/禁止跨午夜/`23:59` 收尾的关键措辞。

### 改动③(`tests/debate/test_validate_blocks.py`)

- 跨午夜块 → 报错含 "spans midnight"。
- 非跨天且 end 晚于 `workday_end` → 报错含 "after work window"。
- `test_workday_end_24_allows_late_blocks`(22:00–23:00 同日)仍通过。

### 改动④(`tests/debate/test_nodes.py`、`tests/debate/test_graph.py`)

- 语义失败时 validate 返回的 `best_effort_schedule` 为含解析块的 `Schedule`,且 `validation_attempts` 递增。
- `_route_after_validate`:`validation_attempts >= max` 且无 `schedule` → `"finalize"`;未达上限 → `"arbitrate"`。
- finalize 在无 `schedule` 但有 `best_effort_schedule` 时返回 best-effort、`degraded=True`、`validation_warnings` 非空,并加 system transcript 事件。
- finalize 在有 clean `schedule` 时不置 `degraded`(或 `degraded=False`)。
- 解析始终失败(无 best-effort)→ finalize 返回 `schedule=None`。
- **done 事件契约**:runner 在交付 best-effort 时,`done` 事件带 `degraded=True` 与 `validation_warnings`;clean schedule 时 `degraded` 为 `False`/缺省。

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

1. **OAuth scope —— 已核对,无需改动。** `google_oauth.py:14` 的 `SCOPES = ["https://www.googleapis.com/auth/calendar"]` 是完整读写日历权限,写 primary events 完全覆盖。**不会变更 scope,既有 `weekforge_tokens.json` 无需重新授权。**(原先此处对 scope 变更的顾虑已排除。)
2. **真实 API 过滤语义 smoke(实现第一步,必做)**:单元测试用 FakeClient 无法证明真实 `events.list(privateExtendedProperty="weekforge=1")` 的服务端过滤行为。实现第一步用真账号跑一次:写入带标记事件 + 预置一个无标记事件 → 确认带过滤的 list 只返回带标记事件 → 确认 `write_blocks` 重跑后无标记事件仍在。即便此 smoke 通过,改动① 的客户端 `_is_weekforge_event` 复核仍保留为第二道防线。
3. **`extendedProperties` 读取**:确认 `events.list` 响应在测试 FakeClient 与真实 API 下都带 `extendedProperties`(真实 API 默认带;FakeClient 需补)。
4. **`delete_events_in_range` 旧调用方**:grep 已确认真实调用方仅 provider 自身 + 一个 Fake 测试;增加可选参数(默认 `None` 保持旧行为)无破坏。
5. **`GoogleIntegration.calendar_name`**:grep 已确认引用点位(见受影响文件,含 `api/server.py:36,41` 及多个测试),移除时一并清理。
6. **msgpack 反序列化告警**(`weekforge.models.Task/TimeBlock/Preferences` 未注册):本 spec 不处理,但 ④ 新增 `best_effort_schedule: Schedule` 进 checkpoint 会加重该告警面;记录为后续待办。
