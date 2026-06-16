# 主日历整合 + 隐藏标记 + 删除安全 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 WeekForge 排程写入用户主日历(`primary`)、用私有扩展属性标记自排块,并保证「绝不读改删任何无标记的外来事件」,从根上消除自污染回声循环。

**Architecture:** 用 Google Calendar `extendedProperties.private.weekforge="1"` 作为隐藏标记。导出时用「服务端 `privateExtendedProperty` 过滤 + 客户端 `_is_weekforge_event` 复核」两道防线只删自排块;导入时跳过带标记事件。删除安全是本 plan 的核心,由 RealClient 守卫测试 + Writer 安全测试共同钉死。

**Tech Stack:** Python, `google-api-python-client`, pytest, `uv`。

**对应 spec:** `docs/superpowers/specs/2026-06-16-debate-convergence-mainline-calendar-design.md` 的「改动①」。改动②③④ 是独立的第二个 plan,不在此处。

**前置约定:**
- 所有命令的工作目录为仓库根 `/Users/Najum/weekforge`。
- 在独立 feature 分支上实现(本 plan 触及数据安全,勿直接提交主分支)。
- 测试运行器:`uv run pytest`。

---

## File Structure

| 文件 | 职责 | 改动 |
|------|------|------|
| `src/weekforge/providers/google_calendar.py` | Provider/Writer + 客户端适配器 | 加标记常量 + `_is_weekforge_event`;RealClient delete 加过滤参数 + 客户端复核;Provider 导入跳过标记;Writer 改写主日历 + 标记 + 安全删除 |
| `src/weekforge/integration.py` | 门面:组合 auth/provider/writer | `export_schedule` 写 primary;移除 `calendar_name`;`list_calendars` 注释更新 |
| `src/weekforge/api/server.py` | 构造 `GoogleIntegration` | 移除 `WEEKFORGE_CALENDAR_NAME` 接线 |
| `tests/test_google_calendar.py` | Provider/Writer/RealClient 单测 | 更新 FakeClient(标记、过滤删除);加守卫/安全测试 |
| `tests/test_integration_calendars.py` | 门面单测 | FakeClient 加 insert/delete;`_make` 去掉 `calendar_name`;加 export 测试 |

> **保留不动:** `RealGoogleCalendarClient.find_calendar`/`create_calendar` 与 protocol 中对应声明保留(Writer 不再用,但删除会带来无谓 churn,YAGNI)。

---

## Task 1: 标记常量 + `_is_weekforge_event` 判定

**Files:**
- Modify: `src/weekforge/providers/google_calendar.py`(模块顶部,`from weekforge.models import TimeBlock` 之后)
- Test: `tests/test_google_calendar.py`

- [ ] **Step 1: Write the failing test**

在 `tests/test_google_calendar.py` 顶部 import 区追加:

```python
from weekforge.providers.google_calendar import (
    _is_weekforge_event,
    WEEKFORGE_MARKER_KEY,
    WEEKFORGE_MARKER_VALUE,
    WEEKFORGE_MARKER_QUERY,
)
```

在文件末尾追加:

```python
# ---------------------------------------------------------------------------
# Marker detection
# ---------------------------------------------------------------------------

class TestWeekforgeMarker:
    def test_constants_compose_query_string(self):
        assert WEEKFORGE_MARKER_KEY == "weekforge"
        assert WEEKFORGE_MARKER_VALUE == "1"
        assert WEEKFORGE_MARKER_QUERY == "weekforge=1"

    def test_detects_marked_event(self):
        event = {"extendedProperties": {"private": {"weekforge": "1"}}}
        assert _is_weekforge_event(event) is True

    def test_unmarked_event_is_false(self):
        assert _is_weekforge_event({"summary": "Real meeting"}) is False

    def test_other_private_props_are_false(self):
        event = {"extendedProperties": {"private": {"something": "else"}}}
        assert _is_weekforge_event(event) is False

    def test_handles_missing_or_null_extended_properties(self):
        assert _is_weekforge_event({"extendedProperties": None}) is False
        assert _is_weekforge_event({"extendedProperties": {"private": None}}) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_google_calendar.py::TestWeekforgeMarker -v`
Expected: FAIL — `ImportError: cannot import name '_is_weekforge_event'`

- [ ] **Step 3: Write minimal implementation**

在 `src/weekforge/providers/google_calendar.py` 的 `from weekforge.models import TimeBlock` 之后插入:

```python
# ---------------------------------------------------------------------------
# WeekForge marker — private extended property tagging our own events
# ---------------------------------------------------------------------------

WEEKFORGE_MARKER_KEY = "weekforge"
WEEKFORGE_MARKER_VALUE = "1"
WEEKFORGE_MARKER_QUERY = f"{WEEKFORGE_MARKER_KEY}={WEEKFORGE_MARKER_VALUE}"


def _is_weekforge_event(event: dict) -> bool:
    """True only if the event carries WeekForge's private marker.

    Foreign events (the user's real meetings) can never be tagged through the
    Google Calendar UI, so a True here uniquely identifies our own output.
    """
    private = (event.get("extendedProperties") or {}).get("private") or {}
    return private.get(WEEKFORGE_MARKER_KEY) == WEEKFORGE_MARKER_VALUE
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_google_calendar.py::TestWeekforgeMarker -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/providers/google_calendar.py tests/test_google_calendar.py
git commit -m "feat: add WeekForge calendar marker constants and detector"
```

---

## Task 2: RealClient 删除 — 过滤参数 + 客户端复核(纵深防御)

**Files:**
- Modify: `src/weekforge/providers/google_calendar.py:20-26`(protocol)、`:78-90`(RealClient delete)
- Test: `tests/test_google_calendar.py`

> 这是删除铁律的第二道防线:即便服务端 `privateExtendedProperty` 过滤失效,本地也绝不删无标记事件。用一个最小 fake service 直接驱动 `RealGoogleCalendarClient`。

- [ ] **Step 1: Write the failing test**

在 `tests/test_google_calendar.py` 末尾追加(`_utc` 已在文件顶部定义):

```python
from weekforge.providers.google_calendar import RealGoogleCalendarClient


# ---------------------------------------------------------------------------
# Minimal fake googleapiclient service (chained .events().list()/.delete().execute())
# ---------------------------------------------------------------------------

class _FakeRequest:
    def __init__(self, result=None, on_execute=None):
        self._result = result
        self._on_execute = on_execute

    def execute(self):
        if self._on_execute is not None:
            self._on_execute()
        return self._result


class _FakeGoogleService:
    def __init__(self, items):
        self._items = items
        self.deleted_ids: list[str] = []
        self.list_kwargs: dict | None = None

    def events(self):
        return self

    def list(self, **kwargs):
        self.list_kwargs = kwargs
        return _FakeRequest(result={"items": self._items})

    def delete(self, calendarId, eventId):
        return _FakeRequest(on_execute=lambda: self.deleted_ids.append(eventId))


class TestRealClientDeleteGuard:
    def test_guard_skips_unmarked_even_if_server_filter_bypassed(self):
        marked = {"id": "wf-1", "extendedProperties": {"private": {"weekforge": "1"}}}
        foreign = {"id": "real-1"}  # user's real meeting, no marker
        svc = _FakeGoogleService(items=[marked, foreign])
        client = RealGoogleCalendarClient(svc)

        client.delete_events_in_range(
            "primary", _utc(2026, 6, 15), _utc(2026, 6, 22),
            private_extended_property="weekforge=1",
        )

        assert svc.deleted_ids == ["wf-1"]                       # foreign NOT deleted
        assert svc.list_kwargs["privateExtendedProperty"] == "weekforge=1"

    def test_no_filter_preserves_legacy_delete_all(self):
        svc = _FakeGoogleService(items=[{"id": "a"}, {"id": "b"}])
        client = RealGoogleCalendarClient(svc)

        client.delete_events_in_range("primary", _utc(2026, 6, 15), _utc(2026, 6, 22))

        assert svc.deleted_ids == ["a", "b"]
        assert "privateExtendedProperty" not in svc.list_kwargs
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_google_calendar.py::TestRealClientDeleteGuard -v`
Expected: FAIL — `TypeError: delete_events_in_range() got an unexpected keyword argument 'private_extended_property'`

- [ ] **Step 3: Update the protocol signature**

`src/weekforge/providers/google_calendar.py` 的 `GoogleCalendarClient` 协议中,替换:

```python
    def delete_events_in_range(self, calendar_id: str, start: datetime, end: datetime) -> None: ...
```

为:

```python
    def delete_events_in_range(
        self, calendar_id: str, start: datetime, end: datetime,
        private_extended_property: str | None = None,
    ) -> None: ...
```

- [ ] **Step 4: Implement param + guard in RealGoogleCalendarClient**

替换 `RealGoogleCalendarClient.delete_events_in_range`(原 `:78-90`)整段为:

```python
    def delete_events_in_range(
        self, calendar_id: str, start: datetime, end: datetime,
        private_extended_property: str | None = None,
    ) -> None:
        list_kwargs: dict = {
            "calendarId": calendar_id,
            "timeMin": start.isoformat(),
            "timeMax": end.isoformat(),
            "singleEvents": True,
        }
        if private_extended_property is not None:
            list_kwargs["privateExtendedProperty"] = private_extended_property
        resp = self._svc.events().list(**list_kwargs).execute()
        for event in resp.get("items", []):
            # Defense in depth: even if the server-side filter is bypassed,
            # NEVER delete an event that doesn't carry our marker.
            if private_extended_property is not None and not _is_weekforge_event(event):
                continue
            self._svc.events().delete(calendarId=calendar_id, eventId=event["id"]).execute()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest tests/test_google_calendar.py::TestRealClientDeleteGuard -v`
Expected: PASS (2 passed)

- [ ] **Step 6: Commit**

```bash
git add src/weekforge/providers/google_calendar.py tests/test_google_calendar.py
git commit -m "feat: filter + client-side guard in delete_events_in_range"
```

---

## Task 3: Provider 导入时跳过带标记事件

**Files:**
- Modify: `src/weekforge/providers/google_calendar.py:121-129`(`get_busy_blocks`)
- Test: `tests/test_google_calendar.py`(`_gcal_event` 助手加 marker 选项 + 新测试)

- [ ] **Step 1: 给 `_gcal_event` 助手加 marker 选项**

替换 `tests/test_google_calendar.py` 的 `_gcal_event`(原 `:75-83`)为:

```python
def _gcal_event(
    summary: str, start: datetime, end: datetime,
    calendar_id: str = "primary", marker: bool = False,
) -> dict:
    event = {
        "summary": summary,
        "start": {"dateTime": start.isoformat()},
        "end": {"dateTime": end.isoformat()},
        "start_dt": start,
        "end_dt": end,
        "_calendar_id": calendar_id,
    }
    if marker:
        event["extendedProperties"] = {"private": {"weekforge": "1"}}
    return event
```

- [ ] **Step 2: Write the failing test**

在 `TestGoogleCalendarProvider` 类内追加方法:

```python
    def test_skips_weekforge_marked_events_on_import(self):
        client = FakeGoogleCalendarClient(events=[
            _gcal_event("Standup", _utc(2026, 6, 15, 9), _utc(2026, 6, 15, 10)),  # foreign
            _gcal_event("Old deep work", _utc(2026, 6, 15, 13), _utc(2026, 6, 15, 15), marker=True),  # self
        ])
        provider = GoogleCalendarProvider(client)

        blocks = provider.get_busy_blocks(_utc(2026, 6, 15), _utc(2026, 6, 22))

        assert [b.label for b in blocks] == ["Standup"]
```

- [ ] **Step 3: Run test to verify it fails**

Run: `uv run pytest tests/test_google_calendar.py::TestGoogleCalendarProvider::test_skips_weekforge_marked_events_on_import -v`
Expected: FAIL — `assert ['Standup', 'Old deep work'] == ['Standup']`

- [ ] **Step 4: Implement skip in get_busy_blocks**

替换 `GoogleCalendarProvider.get_busy_blocks`(原 `:121-129`)的循环体,加入跳过判定:

```python
    def get_busy_blocks(self, start: datetime, end: datetime) -> list[TimeBlock]:
        blocks: list[TimeBlock] = []
        for calendar_id in self._calendar_ids:
            for e in self._client.list_events(calendar_id, start, end):
                # WeekForge's own blocks are re-planned this week; never treat
                # them as fixed busy time, or we re-import our own output.
                if _is_weekforge_event(e):
                    continue
                label = e.get("summary") or "Busy"
                blocks.append(
                    TimeBlock(start=e["start_dt"], end=e["end_dt"], label=label)
                )
        return blocks
```

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest tests/test_google_calendar.py::TestGoogleCalendarProvider -v`
Expected: PASS (all provider tests, including the new one)

- [ ] **Step 6: Commit**

```bash
git add src/weekforge/providers/google_calendar.py tests/test_google_calendar.py
git commit -m "feat: skip WeekForge-marked events when importing busy blocks"
```

---

## Task 4: Writer 改写 — 写 primary + 打标记 + 安全删除

**Files:**
- Modify: `src/weekforge/providers/google_calendar.py:136-169`(`GoogleCalendarWriter`)
- Test: `tests/test_google_calendar.py`(更新 FakeClient、改/删旧 Writer 测试、加新测试)

> Writer 删除现在走 `delete_events_in_range(..., private_extended_property=WEEKFORGE_MARKER_QUERY)`。FakeClient 的 delete 要镜像服务端过滤(只删带标记),让契约/安全测试在 Fake 上成立。

- [ ] **Step 1: 更新 FakeClient.delete_events_in_range(标记过滤 + 记录)**

替换 `tests/test_google_calendar.py` 的 `FakeGoogleCalendarClient.__init__` 与 `delete_events_in_range`(原 `:27-32` 与 `:59-68`):

```python
    def __init__(self, events: list[dict] | None = None, calendars: list[dict] | None = None) -> None:
        self._events: list[dict] = events or []
        self.inserted: list[dict] = []
        self.deleted_ranges: list[tuple] = []
        self.delete_filters: list[str | None] = []
        self._calendars: dict[str, str] = {}
        self._calendar_list: list[dict] = calendars or []
```

```python
    def delete_events_in_range(
        self, calendar_id: str, start: datetime, end: datetime,
        private_extended_property: str | None = None,
    ) -> None:
        self.deleted_ranges.append((calendar_id, start, end))
        self.delete_filters.append(private_extended_property)

        def _should_delete(e: dict) -> bool:
            in_range = (
                e.get("_calendar_id") == calendar_id
                and e["start_dt"] < end
                and e["end_dt"] > start
            )
            if not in_range:
                return False
            # Mirror Google's server-side privateExtendedProperty filter.
            if private_extended_property is not None:
                return _is_weekforge_event(e)
            return True

        self._events = [e for e in self._events if not _should_delete(e)]
```

- [ ] **Step 2: 移除两个已过时的「创建日历」测试**

删除 `tests/test_google_calendar.py` 中以下两个方法(Writer 不再创建/复用日历):
- `test_creates_weekforge_calendar_if_absent`
- `test_reuses_existing_calendar`

将 `TestGoogleCalendarWriter` 内其余所有 `GoogleCalendarWriter(client, calendar_name="WeekForge")` 替换为 `GoogleCalendarWriter(client)`(共 6 处:`test_inserts_one_event_per_block`、`test_event_title_matches_block_label`、`test_clears_existing_events_before_writing`、`test_returns_count_of_written_events`、`test_writes_wall_clock_time_with_timezone_when_provided`、`test_writes_offset_datetime_without_timezone_fallback`)。

- [ ] **Step 3: Write the failing tests(primary + 标记 + 安全删除)**

在 `TestGoogleCalendarWriter` 类内追加:

```python
    def test_writes_to_primary_without_creating_calendar(self):
        client = FakeGoogleCalendarClient()
        writer = GoogleCalendarWriter(client)

        writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))

        assert all(e["_calendar_id"] == "primary" for e in client.inserted)
        assert client._calendars == {}  # create_calendar never called

    def test_tags_each_event_with_marker_and_clean_title(self):
        client = FakeGoogleCalendarClient()
        writer = GoogleCalendarWriter(client)

        writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))

        for e in client.inserted:
            assert e["extendedProperties"]["private"]["weekforge"] == "1"
            assert "[t" not in e["summary"]

    def test_delete_passes_marker_filter(self):
        client = FakeGoogleCalendarClient()
        writer = GoogleCalendarWriter(client)

        writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))

        assert client.delete_filters == ["weekforge=1"]

    def test_deletes_only_marked_events_and_keeps_foreign(self):
        foreign = _gcal_event("Real meeting", _utc(2026, 6, 15, 9), _utc(2026, 6, 15, 10))
        old_self = _gcal_event("Old deep work", _utc(2026, 6, 16, 13), _utc(2026, 6, 16, 15), marker=True)
        client = FakeGoogleCalendarClient(events=[foreign, old_self])
        writer = GoogleCalendarWriter(client)

        writer.write_blocks(self._blocks(), _utc(2026, 6, 15), _utc(2026, 6, 22))

        remaining = [e["summary"] for e in client._events]
        assert "Real meeting" in remaining       # foreign untouched
        assert "Old deep work" not in remaining  # old WeekForge block cleared
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `uv run pytest tests/test_google_calendar.py::TestGoogleCalendarWriter -v`
Expected: FAIL — 新测试因 `GoogleCalendarWriter()` 仍要 `calendar_name`、写入到 `cal-weekforge` 而非 `primary`、事件无 `extendedProperties` 而失败。

- [ ] **Step 5: Rewrite GoogleCalendarWriter**

替换 `GoogleCalendarWriter` 整个类(原 `:136-169`,保留 `_event_time` 原样)为:

```python
class GoogleCalendarWriter:
    """Writes forged schedule blocks into the user's primary calendar.

    Each event carries a private WeekForge marker so re-exports delete ONLY our
    own blocks. Foreign events (the user's real meetings) are never read,
    modified, or deleted — guaranteed by the marker filter plus the client-side
    guard in delete_events_in_range.
    """

    def __init__(self, client: GoogleCalendarClient, target_calendar_id: str = "primary") -> None:
        self._client = client
        self._target_calendar_id = target_calendar_id

    def write_blocks(
        self,
        blocks: list[TimeBlock],
        week_start: datetime,
        week_end: datetime,
        time_zone: str | None = None,
    ) -> int:
        cal_id = self._target_calendar_id

        # Clear previous WeekForge blocks only — marker filter + guard ensure
        # foreign events are never touched.
        self._client.delete_events_in_range(
            cal_id, week_start, week_end,
            private_extended_property=WEEKFORGE_MARKER_QUERY,
        )

        for block in blocks:
            event = {
                "summary": block.label,
                "start": self._event_time(block.start, time_zone),
                "end": self._event_time(block.end, time_zone),
                "extendedProperties": {
                    "private": {WEEKFORGE_MARKER_KEY: WEEKFORGE_MARKER_VALUE}
                },
            }
            self._client.insert_event(cal_id, event)

        return len(blocks)

    @staticmethod
    def _event_time(dt: datetime, time_zone: str | None) -> dict:
        """Build a Google Calendar start/end time object.

        Block times are wall-clock-local: the hour the scheduler chose (e.g. 09:00)
        is the user's intended local time, even though it may carry a placeholder
        UTC offset. When the caller knows the user's IANA zone we drop the offset
        and pass `timeZone`, so Google anchors the event to that zone instead of
        treating the placeholder offset as an absolute instant. Without a zone we
        fall back to the original offset-bearing timestamp.
        """
        if time_zone:
            return {"dateTime": dt.replace(tzinfo=None).isoformat(), "timeZone": time_zone}
        return {"dateTime": dt.isoformat()}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/test_google_calendar.py::TestGoogleCalendarWriter -v`
Expected: PASS (all Writer tests, including the 4 new ones; the two create-calendar tests are gone)

- [ ] **Step 7: Commit**

```bash
git add src/weekforge/providers/google_calendar.py tests/test_google_calendar.py
git commit -m "feat: write schedule to primary calendar with WeekForge marker and safe delete"
```

---

## Task 5: 门面 `GoogleIntegration` — 写 primary + 移除 calendar_name

**Files:**
- Modify: `src/weekforge/integration.py:24-104`
- Test: `tests/test_integration_calendars.py`

- [ ] **Step 1: 给 integration 测试 FakeClient 加 insert/delete + 写失败测试**

替换 `tests/test_integration_calendars.py` 的 import 区与 `FakeClient`(原 `:8-37`)为:

```python
from __future__ import annotations

from datetime import datetime, timezone

from weekforge.integration import GoogleIntegration
from weekforge.models import TimeBlock


class _FakeStore:
    def save(self, c): ...
    def load(self): return {"token": "t"}
    def clear(self): ...


def _utc(y, m, d, h=0):
    return datetime(y, m, d, h, tzinfo=timezone.utc)


class FakeClient:
    def __init__(self, calendars=None, events=None):
        self._calendars = calendars or []
        self._events = events or []
        self.inserted = []
        self.deleted = []

    def list_calendars(self):
        return self._calendars

    def list_events(self, calendar_id, start, end):
        return [
            e for e in self._events
            if e["_calendar_id"] == calendar_id and e["start_dt"] < end and e["end_dt"] > start
        ]

    def insert_event(self, calendar_id, event):
        event["_calendar_id"] = calendar_id
        self.inserted.append(event)
        return f"evt-{len(self.inserted)}"

    def delete_events_in_range(self, calendar_id, start, end, private_extended_property=None):
        self.deleted.append((calendar_id, private_extended_property))
```

替换 `_make`(原 `:40-43`)为(去掉 `calendar_name`):

```python
def _make(client) -> GoogleIntegration:
    google = GoogleIntegration(token_store=_FakeStore())
    google._client = lambda: client  # inject fake client
    return google
```

在文件末尾追加:

```python
def test_export_schedule_writes_marked_event_to_primary():
    client = FakeClient()
    google = _make(client)
    blocks = [TimeBlock(start=_utc(2026, 6, 15, 9), end=_utc(2026, 6, 15, 10),
                        label="Deep work", task_id="t1")]

    count, url = google.export_schedule(blocks, _utc(2026, 6, 15))

    assert count == 1
    assert client.inserted[0]["_calendar_id"] == "primary"
    assert client.inserted[0]["extendedProperties"]["private"]["weekforge"] == "1"
    assert client.deleted == [("primary", "weekforge=1")]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_integration_calendars.py -v`
Expected: FAIL — `_make` 仍传 `calendar_name` 已删,但 `GoogleIntegration.__init__` 此刻仍接受它;新 `test_export_schedule...` 会因 `GoogleCalendarWriter(self._client(), calendar_name=...)` 写到 `cal-weekforge` 而非 `primary` 失败。(若 `_make` 报 unexpected kwarg 则在 Step 3 修复。)

- [ ] **Step 3: 改写 GoogleIntegration**

在 `src/weekforge/integration.py` 中:

(a) 替换 `__init__`(原 `:27-36`)为(移除 `calendar_name`):

```python
    def __init__(
        self,
        token_store: OAuthTokenStore,
        frontend_url: str = "http://localhost:3000",
    ) -> None:
        self._store = token_store
        self._frontend_url = frontend_url
        self._pending_code_verifier: str | None = None
```

(b) 替换 `list_calendars` 的 docstring(原 `:70-76`)为(去掉 WeekForge 输出日历的特殊措辞):

```python
    def list_calendars(self) -> list[dict]:
        """Return the user's calendars for the import picker.

        All calendars are listed and selected by default so import captures the
        full picture. WeekForge's own blocks live on the primary calendar tagged
        with a private marker and are skipped at read time, so there is no
        self-output calendar to special-case here.
        """
```

(c) 替换 `export_schedule`(原 `:96-104`)为(写 primary,不传 calendar_name):

```python
    def export_schedule(
        self, blocks: list[TimeBlock], week_start: datetime, time_zone: str | None = None
    ) -> tuple[int, str]:
        """Write blocks to the user's primary calendar. Returns (written_count, calendar_url)."""
        week_end = week_start + timedelta(days=7)
        writer = GoogleCalendarWriter(self._client())
        count = writer.write_blocks(blocks, week_start, week_end, time_zone=time_zone)
        calendar_url = "https://calendar.google.com/calendar/r/week"
        return count, calendar_url
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_integration_calendars.py -v`
Expected: PASS (existing list/import tests + new export test)

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/integration.py tests/test_integration_calendars.py
git commit -m "feat: export schedule to primary calendar; drop calendar_name from GoogleIntegration"
```

---

## Task 6: 清理 `api/server.py` 的 `WEEKFORGE_CALENDAR_NAME` 接线 + 全量回归

**Files:**
- Modify: `src/weekforge/api/server.py:36,41`
- Verify: 整个 `tests/`

- [ ] **Step 1: 移除 calendar_name 接线**

在 `src/weekforge/api/server.py` 中:
- 删除 `calendar_name = os.environ.get("WEEKFORGE_CALENDAR_NAME", "WeekForge")` 这一行。
- 在 `return GoogleIntegration(...)` 调用里删除 `calendar_name=calendar_name,` 这一参数行。

改后该构造应为:

```python
    return GoogleIntegration(
        token_store=JsonFileTokenStore(token_path),
        frontend_url=frontend_url,
    )
```

- [ ] **Step 2: 确认无遗留引用**

Run: `grep -rn "calendar_name\|WEEKFORGE_CALENDAR_NAME" src tests`
Expected: 无输出(全部已清理)。

- [ ] **Step 3: 全量回归**

Run: `uv run pytest tests/ -q`
Expected: 全绿,无 failure/error。

- [ ] **Step 4: Commit**

```bash
git add src/weekforge/api/server.py
git commit -m "chore: remove WEEKFORGE_CALENDAR_NAME wiring after primary-calendar migration"
```

---

## 实现第一步之外的手动核对(spec 风险一节)

> 这些不是自动化步骤,实现期间人工完成一次:

- [ ] **真实 API 过滤 smoke**:用真账号写入带标记事件 + 预置一个无标记事件 → 确认 `events.list(privateExtendedProperty="weekforge=1")` 只返回带标记事件 → `export_schedule` 重跑后无标记事件仍在。(即便通过,Task 2 的客户端复核仍保留。)
- [ ] **OAuth scope**:已核对 `google_oauth.py:14` 为完整 `calendar` 读写 scope,无需改动、无需重新授权。

---

## Self-Review

**Spec coverage(改动① 全部要点):**
- 写 primary + 干净标题 → Task 4。
- 隐藏标记机制 + `_is_weekforge_event` → Task 1 / Task 4。
- 导出清旧自排块(标记过滤)→ Task 4。
- 删除安全两道防线(服务端过滤 + 客户端复核)→ Task 2(复核)+ Task 4(过滤传参)。
- 导入按标记分流跳过 → Task 3。
- 受影响文件 integration / server.py / 测试 → Task 5 / Task 6。
- 测试要求:打标记+写 primary+删除只删带标记+删除走过滤+导入分流+Fake 支持 extendedProperties → 覆盖于 Task 1–5;S2 反向锁定(永不传 None)由 `test_no_filter_preserves_legacy_delete_all` + `test_delete_passes_marker_filter` 共同守;S2 过滤失效复核由 `test_guard_skips_unmarked_even_if_server_filter_bypassed` 守。
- OAuth scope 核对 + 真实 API smoke → 手动核对清单。
- 已知边角(手动改过的自排块、分页)→ 不实现,spec 已记录。

**Placeholder scan:** 无 TBD/TODO;每个代码步骤均给出完整代码与确切命令/预期。

**Type consistency:** `WEEKFORGE_MARKER_KEY/VALUE/QUERY`、`_is_weekforge_event`、`private_extended_property` 参数名、`target_calendar_id`、`delete_filters` 在各 task 间一致;`GoogleCalendarWriter(client)` 单参构造在 Task 4 定义、Task 5 调用一致。
