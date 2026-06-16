# Spec: 导出安全文案 + 降级结果警告

> 设计文档。面向用户的提醒文案 + 支撑降级警告的最小前端接线。

## 背景

两个面向用户的清晰度/信任缺口:

1. **导出无安全说明。** WeekForge 现在把排程写进用户的**主日历**(改动① 已上线)。用户不知道"它会不会动我的真实日程"。当前 `ExportButton` 只在成功后显示 `Wrote N events.`,既不预先说明边界,也不复述"只刷新自己的块"。
2. **降级结果被当成功展示。** 改动④ 已让 `done` 事件携带 `degraded` / `validation_warnings`(重试到上限后交付的 best-effort 排程,可能含语义违规)。但前端 `ForgedModal` 仍无条件庆祝("Your week is forged."),把语义违规的结果和合格结果展示得一模一样,误导用户直接导出。

本 spec 设计两条文案 + 支撑第 2 条所需的最小前端数据接线。

## 范围

- ✅ §1 导出安全/刷新文案(`ExportButton`)。
- ✅ §2 降级结果警告(`ForgedModal`,消费已有的 `done.degraded` / `validation_warnings`)。

**不在本 spec 范围:**
- 手动改过的自排块被覆盖的警告;导入选日历处的解惑(累加范围未选)。
- 任何后端/字段改动 —— `degraded` / `validation_warnings` 已由改动④ 在 `done` 事件提供,本 spec 仅前端接上。
- 把 `validation_warnings` 的原始规则文本逐条"人话化"翻译(展开区直接显示原文)。

> **实现注意(Next.js):** `frontend/AGENTS.md` 警告本仓 Next.js 版本与训练数据有出入,实现前需先读 `node_modules/next/dist/docs/` 的相关指南。本 spec 只规定文案与组件行为,不规定具体 API 写法。

---

## §1 导出文案(`ExportButton`)

方向:**平实安心型**(信任信息用大白话,不玩 forge 梗)。

### 文案(英文,与现有 UI 一致)

**点击前** —— 按钮(`Add to Google Calendar`)下方常驻一行小灰字(`text-muted`,`text-xs`):

```
WeekForge only adds and updates its own blocks — your existing events are never changed.
```

**点击后成功** —— 替换现在的 `Wrote {result.written} events.` 一句,改为:

```
Wrote {written} events. Refreshed WeekForge's own blocks and left everything else untouched.
```

后接现有的 `Open Google Calendar ↗` 链接(`result.calendar_url`),保持不变。

**失败提示**(`error`)不变。

### 行为与取舍

- 点击前的说明文字**常驻**(无论是否连了 Google),它描述的是导出行为的边界,不依赖运行结果。
- **首次导出**(此前无自排块可"refresh")仍用同一句成功文案 —— 不为 first-run / re-run 分叉措辞(YAGNI;"Refreshed … own blocks" 在零旧块时读起来也无误导)。

---

## §2 降级结果警告(`ForgedModal`)

仅当 `done.degraded === true` 时改变展示;否则**一字不改**当前庆祝形态。

### 行为

| 状态 | 展示 |
|------|------|
| `degraded` 未设置 / `false` | 现状:eyebrow `The council has ruled` + 标题 `Your week is forged.` + 副标题 `The verdict is in. Here's what the crucible produced.` + stats |
| `degraded === true` | 保留庆祝外壳与标题;副标题替换为下方降级文案;在副标题与 stats 之间插入 amber 警告条 + 可展开细节 |

### 文案(degraded 时)

**副标题**(替换 `The verdict is in. Here's what the crucible produced.`):

```
The crucible couldn't satisfy every constraint — here's the closest week it could forge.
```

**警告条**(新增,amber/caution 配色,仅 degraded 显示):

```
⚠ Some blocks may break your rules (work hours or overlaps). Review them before adding to your calendar.
```

**展开细节** —— 警告条内一个 `Show details ▾` 切换(默认折叠);展开后显示 `validation_warnings` 原文(即后端的多行 `Schedule failed semantic validation:` 文本),等宽/小字呈现。`validation_warnings` 为空时不显示该切换。

**主按钮** `View the forged week` 不变 —— 把用户带到可编辑的 `ScheduleView` 去修正。

### 语音规则

- 警告 / 安全信息 → 大白话,不玩主题梗。
- 庆祝外壳(标题、sigil、动画)→ 保留主题感。degraded 时标题 `Your week is forged.` **保留不软化**(警告条已承担提示职责,改标题会增加无谓改动)。

---

## 支撑 §2 的最小前端数据接线

`done` 事件已带 `degraded` / `validation_warnings`(改动④),但前端类型与状态尚未承接。需要四处改动:

1. **`frontend/lib/types.ts`** —— `DoneMsg` 增加可选字段:
   ```ts
   export interface DoneMsg {
     type: "done";
     schedule: Schedule | null;
     thread_id: string;
     degraded?: boolean;
     validation_warnings?: string | null;
   }
   ```
   (snake_case `validation_warnings` 对齐后端 JSON。)

2. **`frontend/lib/debateReducer.ts`** —— `DebateState` 增加 `degraded: boolean` 与 `validationWarnings: string | null`(初值 `false` / `null`);`case "done"` 写入 `m.degraded ?? false` 与 `m.validation_warnings ?? null`。其余 case 不变(`reset` 复位为初值)。

3. **`frontend/app/app/page.tsx`** —— 把 `state.degraded` 与 `state.validationWarnings` 作为新 props 传给 `<ForgedModal>`。

4. **`frontend/components/ForgedModal.tsx`** —— 新增 `degraded?: boolean` 与 `validationWarnings?: string | null` props,实现 §2 的条件渲染(副标题切换、警告条、折叠细节)。

---

## 测试要求

前端测试(`*.test.tsx` / `*.test.ts`,沿用现有 Vitest/RTL 模式):

- **`ExportButton.test.tsx`**:
  - 渲染时含点击前安全说明文字("never changed" 关键字)。
  - 导出成功后,结果文字含新措辞("left everything else untouched")且仍渲染 `Open Google Calendar` 链接。
- **`debateReducer.test.ts`**:
  - `case "done"` 携带 `degraded: true` + `validation_warnings` 时,reducer 把 `degraded` / `validationWarnings` 写入 state;不带这两个字段时回落 `false` / `null`。
- **`ForgedModal.test.tsx`(新增)**:
  - `degraded === false`:维持现状文案(无警告条,副标题为原句)。
  - `degraded === true`:渲染警告条("Review them before adding")与降级副标题;`Show details` 默认折叠,展开后出现 `validation_warnings` 文本;`validation_warnings` 为空时无 `Show details`。

回归:`npm test`(或仓库既定前端测试命令)全绿。

---

## 风险与待核对

1. **`done` 事件字段名核对**:确认后端实际发出的键是 `degraded` 与 `validation_warnings`(改动④ runner 的 `done` 字典)。实现第一步用一次真实 degraded 跑通(或看 SSE 原始帧)确认前端解析键名一致。
2. **`ForgedModal` 无现存测试文件**:需新建 `ForgedModal.test.tsx`,沿用同目录其他组件测试的渲染/查询模式。
3. **Next.js 版本差异**:见顶部 `frontend/AGENTS.md` 注意 —— 实现前读 `node_modules/next/dist/docs/`。
