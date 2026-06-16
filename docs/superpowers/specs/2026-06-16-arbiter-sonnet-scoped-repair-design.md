# Spec: Arbiter 换 Sonnet + 作用域修复，消除仲裁震荡

> 设计文档。把 `arbitrate↔validate` 重试从"整表重写 + 只回灌最后一条错误"升级为"冻结合法块 + 只修违规块 + 累积结构化反馈"，并给 Arbiter 单独一条 Sonnet 模型线。图结构不变。

## 背景

Arbiter 生成排程后，`validate` 节点用确定性的 `validate_blocks` 做语义校验（work window 内、不撞 busy、不超每日 focus 上限、不跨午夜）。校验失败时把**最后一条**错误文本回灌给 Arbiter，让它**整张表从头重写**，最多重试 `max_validation_attempts`（默认 3）次，耗尽后交付 best-effort 排程并标 `degraded`。

实测出现**"来回震荡修不干净"**：Arbiter 修好块 A 又撞坏块 B，下一轮修好 B 又撞回 A，三次重试全部失败，最后交付一个仍含语义违规的降级结果。根因是 basic-reflection 反模式——LLM 每轮从零重写、只看最后一条错误、不知道哪些块本来已经合法。

业界做法（LangGraph Reflexion / LATS、CrewAI guardrails）的共识是：**确定性裁判 grounding + 累积结构化反馈 + 不从零重写**。本 spec 据此做最小但对症的改造，**不引入合法槽位枚举（方案 B）或外部 solver（方案 C）**——那两者会拖慢收尾或撑复杂 schema，留作后续按真实震荡率决定是否演进。

参考：
- [LangChain — Reflection Agents](https://www.langchain.com/blog/reflection-agents)：basic reflection 未 grounding 时"结果未必更好"；Reflexion 靠**累积历史 + 显式列出多余/缺失**让反思更有建设性。
- [CrewAI Task Guardrails](https://www.analyticsvidhya.com/blog/2025/11/introduction-to-task-guardrails-in-crewai/)：函数式（确定性）guardrail + retry 回传**具体失败原因**。

## 范围

- ✅ §1 Arbiter 独立模型线（Sonnet），debater 与 validate 解析仍用 Haiku。
- ✅ §2 `validate_blocks` 升级为**逐块**分类（合法 / 待修 + 原因）。
- ✅ §3 `validate` 节点产出**作用域修复反馈** + 冻结合法块。
- ✅ §4 `arbitrate` 节点重试时**注入冻结块为占用时间 + 每日剩余 focus 预算 + 只修违规块**。
- ✅ §5 安全网保留 + 重试次数埋点。

**不在本 spec 范围：**
- 方案 B（合法槽位枚举 / 受限选择）、方案 C（CP-SAT 等外部 solver）。
- debater 层的软偏好结构化字段——辩论仍只在自然语言里进行，结构化产物只由 Arbiter 产出。
- 缓冲、`depends_on` 排序、跨任务能量编排等**关系型约束**（`validate_blocks` 现不校验，本 spec 不新增）。
- 图（`graph.py`）的节点/路由结构——保持 `arbitrate→validate→(retry|finalize)` 不变，仅改节点内部与 state。

> **模型 id 注意**：所有模型一律经环境变量注入，**不在代码里硬编码具体 id**（沿用现有 `DEFAULT_MODEL` 的 litellm `anthropic/` 前缀格式）。Sonnet 的当前 id 实现时查 `claude-api` skill 确认。

---

## §1 Arbiter 独立模型线

现状：`build_council(api_key, model=DEFAULT_MODEL)`（debaters.py:84）构造**一个** `LLM` 实例，四个 agent（DeadlineHawk / EnergyGuardian / FocusBatcher / Arbiter）共用。

改动：

1. `build_council` 增加参数 `arbiter_model: str | None = None`。
   - `arbiter_model` 为 `None` 时，Arbiter 沿用 `model`（行为与今天完全一致，零回归）。
   - 非 `None` 时，**单独**构造 `arbiter_llm = LLM(model=arbiter_model, api_key=api_key)`，只赋给 `self.arbiter` 这个 Agent；三个 debater 仍用原 `llm`。
2. 新增环境变量 `WEEKFORGE_ARBITER_MODEL`，由构造 council 的位置（runner / api 层，与读取 `WEEKFORGE_MODEL` 同处）读取并透传。未设置时回落到 `WEEKFORGE_MODEL`。
3. `validate` 节点里抽 JSON 的 `Anthropic(...).messages.create(model="claude-haiku-4-5-...")` 调用**保持 Haiku 不变**——纯解析不需要 Sonnet。

推荐生产值：`WEEKFORGE_ARBITER_MODEL=anthropic/claude-sonnet-4-6`（以 `claude-api` skill 确认的当前 Sonnet id 为准）。

文档：在 `CLAUDE.md` 的环境变量表新增一行 `WEEKFORGE_ARBITER_MODEL`（用途：Arbiter 仲裁模型，默认回落 `WEEKFORGE_MODEL`）。

---

## §2 `validate_blocks` 升级为逐块分类

现状：`validate_blocks(blocks, tasks, busy, prefs) -> list[str]`（nodes.py:70）只返回一串错误文本，label 拼在字符串里，无法定位"哪个块合法、哪个该修"。

改动：新增结构化分类（保留纯函数、无 I/O、可独立测试）。建议返回一个轻量结果对象：

```python
@dataclass
class BlockReport:
    block: TimeBlock
    errors: list[str]          # 该块自身的违规（规则 1/2/3）；空 = 局部合法

@dataclass
class ValidationReport:
    reports: list[BlockReport]     # 每个输入块一项，保持输入顺序
    day_errors: list[str]          # 日级违规（规则 4 每日 focus 上限），不归属单块
    over_cap_days: set[date]       # 超上限的本地日期集合（供"待修"判定用）

    @property
    def frozen(self) -> list[TimeBlock]:
        """零自身违规 且 不在超上限日 → 可冻结。"""
    @property
    def to_fix(self) -> list[BlockReport]:
        """有自身违规，或落在超上限日（带日级原因）→ 待修。"""
    @property
    def ok(self) -> bool:
        return not self.to_fix and not self.day_errors
```

规则归属：

- **规则 1/2/3（未知 task_id、越界/跨午夜、撞 busy）**：逐块判定，写入该块 `errors`。
- **规则 4（每日 focus 上限）**：日级。超上限的那一天，其上**所有块**进 `to_fix`（携带"周X 超 Ymin"这条日级原因），不冻结——因为是整组超额，需移走其中一部分。v1 不挑"移哪几块最优"，把决策交给 Arbiter（见 §4）。

兼容：保留旧 `validate_blocks(...) -> list[str]` 作为薄封装（拼接 `report` 的所有错误），以免其它调用点（如测试、export 校验）一次性大改；新逻辑走 `classify_blocks(...) -> ValidationReport`。

---

## §3 `validate` 节点：作用域修复反馈 + 冻结块

现状（nodes.py:330-354）：失败时把整段错误文本写进 `validation_error` / `validation_warnings`，存 `best_effort_schedule`，`validation_attempts += 1`，路由回 `arbitrate`。

改动 `validate` 在 `classify_blocks` 返回 `not ok` 时：

1. 计算 `report.frozen`（合法且不在超上限日的块）与 `report.to_fix`。
2. 写**结构化作用域反馈**到 `validation_error`（人类可读、同时进 transcript 的 `validation_fail` 事件），形如：

   ```
   Schedule failed semantic validation. Keep the FROZEN blocks exactly as-is; only re-place the BROKEN ones.

   FROZEN (do not move, already valid):
     - Standup            Mon 10:00–11:00
     - Write Q3 report    Mon 11:00–14:00
   BROKEN (re-place these only):
     - Review 5 pull requests: starts 08:00 local, before work window 09:00
   Daily focus budget remaining after FROZEN blocks:
     - Mon: 60min left (cap 360, frozen uses 300)
   ```

3. 新增 state 字段 `frozen_blocks: list[TimeBlock]` ← `report.frozen`，供 `arbitrate` 直接消费（避免从文本里反解析）。
4. `best_effort_schedule = Schedule(blocks=blocks)`（全部块，含 frozen+broken）—— 兜底语义不变。
5. `validation_attempts += 1`，`schedule=None`，路由回 `arbitrate`（与现状一致）。

`ok` 为真时与现状一致：`schedule = Schedule(blocks)`，清空 `validation_error` / `frozen_blocks` / `validation_warnings`。

新增 state 字段（`state.py`）：

```python
frozen_blocks: NotRequired[list[TimeBlock]]   # validate 写入；arbitrate 重试时读取
```

---

## §4 `arbitrate` 节点：注入冻结块 + 剩余预算 + 只修违规

现状（nodes.py:250-292）：重试时只把 `validation_error` 作为一句 `prev_error` 拼进 prompt，要求"输出合法 JSON"，没有冻结概念。

改动：当 `state.get("frozen_blocks")` 非空（即这是一次作用域重试）时，prompt 增加三块硬约束：

1. **占用时间（不可覆盖）**：把 frozen 块逐条列出，明确"这些时段已被占用且**已确定，不要移动、不要覆盖、原样保留在最终输出里**"。语义上等同把它们当额外 busy，但**与 busy 分开陈述**（busy 是外部承诺、不计 focus；frozen 是已定的 focus 块、计入预算）。
2. **每日剩余 focus 预算**：对每个本地日给出 `cap − 该日 frozen 块占用分钟`，要求新排的块不超过剩余预算。**这是"冻结块连占用的 focus 分钟一起算"的落实**——避免 Arbiter 把违规块塞进一个已被 frozen 块占满的日子。
3. **只修违规块**：明确"**只需要为下列任务重新安排时间**：[broken 块的 label/task_id]；其余一律保持 frozen。"

行为保证（为何单调收敛）：合法块被冻结、且作为占用时间 + 预算回灌，Arbiter 每轮只动违规子集 → 违规数**只减不增**，不再"修 A 撞 B"。Sonnet 更强的指令遵循进一步降低残余漂移。

首次仲裁（无 `frozen_blocks`）行为与今天一致：全量合成，不注入冻结约束。`arbitrate` 仍在返回里把 `validation_error` 清 `None`（下一次 validate 会重算 frozen 与反馈）。

---

## §5 安全网 + 埋点

- `max_validation_attempts=3` 上限与 `finalize` 的 best-effort / `degraded` 兜底**保持不动**（CLAUDE.md 红线："Debate must terminate"）。本 spec 是**降低**重试触发率与失败率，不动终止保证。
- **诚实声明**：§3/§4 是强力缓解（理论上单调收敛），但仍是 LLM，**非数学保证**；上限 + degraded 仍是最终防线。
- **埋点**：`finalize_node`（或 runner 收尾处）用标准 `logging` 记一行 `validation_attempts` 与是否 `degraded`，便于跑一段时间统计真实震荡率。判据：若 Sonnet+作用域修复后重试稳定在 0–1，则够用；若仍频繁撞 3 次，才有数据支撑去考虑方案 B/C。（不改 `done` 事件 schema；纯服务端日志。）

---

## 测试要求（TDD：先写失败测试）

沿用现有注入式测试（`MockCouncil` / `FakeGoogleCalendarClient`，mock `weekforge.debate.nodes.Anthropic`，DB 用 `:memory:`）。

**`debaters` —— Arbiter 模型线（§1）：**
- `build_council(api_key, model=M)` 不传 `arbiter_model` 时，Arbiter 与 debater 用同一模型（回归：行为不变）。
- 传 `arbiter_model=S` 时，Arbiter 的 LLM 模型为 `S`、三个 debater 仍为 `M`。

**`classify_blocks`（§2）：**
- 全合法 → `ok is True`，`frozen` 含全部块，`to_fix` 空。
- 单块撞 busy / 越界 / 跨午夜 / 未知 task_id → 该块进 `to_fix` 且带对应原因；其余块进 `frozen`。
- 某日超 focus 上限 → 该日所有块进 `to_fix`（带日级原因），`over_cap_days` 含该日；他日合法块仍 `frozen`。
- 时区：违规判定按 `preferences.timezone` 本地时间（沿用现有 `astimezone`）。

**`validate` 节点（§3）：**
- 部分违规：`schedule is None`，`frozen_blocks` == 合法块集合，`validation_error` 文本含 `FROZEN` 与 `BROKEN` 段及每日剩余预算，`best_effort_schedule` 含全部块，`validation_attempts` +1。
- 全合法：`schedule` 设值，`frozen_blocks` 清空，`validation_error/validation_warnings` 为 `None`。

**`arbitrate` 节点（§4）：**
- `frozen_blocks` 非空时（用 `MockCouncil` 捕获传入 `arbitrate` 的 context），context 含：frozen 块占用时间、每日剩余 focus 预算、"只重排 broken 块"指令。
- `frozen_blocks` 空/缺失时，context **不含**上述冻结约束（首轮全量合成回归）。

**收敛性（端到端，脚本化 `MockCouncil`）：**
- 构造一个"只修被点名的 broken 块、不动 frozen 块"的脚本化 Arbiter：第一次产出含 1 个违规块，重试后修正 → **1 次重试内 `ok`**，最终 `schedule` 非空、`degraded` 未置位。验证不再震荡到耗尽。
- 回归：一个"始终修不好"的脚本化 Arbiter 仍在 3 次后 `finalize` 交付 `degraded` best-effort（终止保证不变）。

回归命令：`uv run pytest`（重点 `tests/debate`）全绿。

---

## 风险与待核对

1. **超上限日的"移哪几块"未优化**：v1 把超上限日**整天**的块全标 `to_fix`，可能让 Arbiter 重排得比必要更多（但不破坏正确性，仍单调收敛）。若实测重排过激，后续可改成"只标该日最低优先级/最晚的若干块"。
2. **frozen 与 busy 的语义分离**：实现 §4 时务必区分——frozen 计入每日 focus 预算，busy 不计。混淆会导致预算算错、把违规块又塞进满日。测试需覆盖"frozen 占满日 → 违规块被迫移到他日"。
3. **`validate_blocks` 旧签名调用点**：保留薄封装前，先 grep 现有调用点（export 校验等）确认未被破坏。
4. **Sonnet 成本/延迟**：单次仲裁比 Haiku 慢且贵，但重试次数预期下降，净延迟应持平或更优；上线后用 §5 埋点核对 token / 时延实际变化。
5. **模型 id 不硬编码**：`WEEKFORGE_ARBITER_MODEL` 全程经 env；提交前确认代码内无写死的 Sonnet id。
