# Google Calendar UX + Mandatory Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Google login as a required gate, fix the unbind bug, pass task remarks to the model, import all calendars, and let users edit the forged schedule before exporting to Google Calendar.

**Architecture:** Ten sequential tasks — four backend (models, nodes, routes, integration) then six frontend (api, hook, components, buildRequest, calendarEvents, app page). Each task is independently committable. Backend tasks run under `uv run pytest`; frontend tasks run under `npm test -- --run` from `frontend/`.

**Tech Stack:** Python 3.12 / FastAPI / Pydantic v2 / pytest — Next.js 15 / React 19 / TypeScript / Vitest / @testing-library/react

---

## File Map

**Backend (modify only):**
- `src/weekforge/models.py` — Task model, add `remark`
- `src/weekforge/debate/nodes.py` — `_fmt_tasks`, include remark in prompt string
- `src/weekforge/api/google_routes.py` — callback redirect target → `/app?google=connected`
- `src/weekforge/integration.py` — `list_calendars`, remove WeekForge exclusion, default-select all

**Backend tests (modify only):**
- `tests/test_models.py`
- `tests/debate/test_nodes.py`
- `tests/api/test_google_routes.py`
- `tests/test_integration_calendars.py`

**Frontend (modify only):**
- `lib/api.ts` — add `googleDisconnect()`
- `lib/api.test.ts`
- `lib/useGoogleCalendar.ts` — add `statusKnown`, `disconnect()`
- `lib/useGoogleCalendar.test.ts`
- `components/GoogleConnect.tsx` — unbind becomes `<button>`, remove `disconnectUrl` prop, add `onDisconnect`
- `components/GoogleConnect.test.tsx`
- `lib/types.ts` — add `remark?` to `TaskInput`
- `lib/buildRequest.ts` — include remark when non-empty
- `lib/buildRequest.test.ts`
- `lib/calendarEvents.ts` — add `blockIndex` to `CalendarEvent`, carry through `toCalendarEvents`
- `components/WeekCalendar.tsx` — optional `onEditTime` / `onDelete` callbacks
- `components/WeekCalendar.test.tsx`
- `app/app/page.tsx` — login gate, `editedBlocks` state, wire all

---

## Task 1: Backend — Add `remark` to Task model

**Files:**
- Modify: `src/weekforge/models.py`
- Test: `tests/test_models.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_models.py`:

```python
def test_task_remark_defaults_to_none():
    task = Task(id="t1", title="Write report", estimated_minutes=90)
    assert task.remark is None


def test_task_remark_accepts_string():
    task = Task(id="t1", title="Write report", estimated_minutes=90, remark="Do this in the morning")
    assert task.remark == "Do this in the morning"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_models.py::test_task_remark_defaults_to_none -v
```

Expected: FAIL with `AttributeError: 'Task' object has no attribute 'remark'`

- [ ] **Step 3: Add `remark` field to Task**

In `src/weekforge/models.py`, add the field to `Task` after `preferred_days`:

```python
class Task(BaseModel):
    """A unit of work the council must schedule."""

    id: str
    title: str
    estimated_minutes: int = Field(gt=0)
    deadline: datetime | None = None
    priority: int = Field(default=3, ge=1, le=5)  # 1 = highest
    category: str | None = None  # used by the Focus Batcher for grouping
    depends_on: list[str] = Field(default_factory=list)
    preferred_days: list[Literal["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]] | None = None
    remark: str | None = None  # planner's note to the council
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run pytest tests/test_models.py -v
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/models.py tests/test_models.py
git commit -m "feat(models): add remark field to Task"
```

---

## Task 2: Backend — Include remark in `_fmt_tasks` prompt string

**Files:**
- Modify: `src/weekforge/debate/nodes.py`
- Test: `tests/debate/test_nodes.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/debate/test_nodes.py`:

```python
def test_fmt_tasks_includes_remark_when_present(base_state):
    from weekforge.debate.nodes import _fmt_tasks

    state = {
        **base_state,
        "tasks": [
            Task(
                id="t1",
                title="Write report",
                estimated_minutes=120,
                priority=1,
                remark="Do this first thing in the morning, before emails",
            )
        ],
    }
    result = _fmt_tasks(state)
    assert "Do this first thing in the morning" in result
    assert "note:" in result


def test_fmt_tasks_omits_note_segment_when_remark_is_none(base_state):
    from weekforge.debate.nodes import _fmt_tasks

    state = {**base_state, "tasks": [Task(id="t1", title="Write report", estimated_minutes=60, priority=2)]}
    result = _fmt_tasks(state)
    assert "note:" not in result
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/debate/test_nodes.py::test_fmt_tasks_includes_remark_when_present tests/debate/test_nodes.py::test_fmt_tasks_omits_note_segment_when_remark_is_none -v
```

Expected: Both FAIL

- [ ] **Step 3: Add remark to `_fmt_tasks`**

In `src/weekforge/debate/nodes.py`, update `_fmt_tasks`:

```python
def _fmt_tasks(state: DebateState) -> str:
    lines = []
    for t in state["tasks"]:
        line = f"- [{t.id}] {t.title} ({t.estimated_minutes}min, priority {t.priority}"
        if t.deadline:
            line += f", deadline {t.deadline.strftime('%a %d %b')}"
        if t.category:
            line += f", category: {t.category}"
        if t.preferred_days:
            pref = " · ".join(
                f"{'1st' if i == 0 else '2nd'} {d}"
                for i, d in enumerate(t.preferred_days[:2])
            )
            line += f", prefer: {pref}"
        if t.remark:
            line += f", note: \"{t.remark}\""
        line += ")"
        lines.append(line)
    return "\n".join(lines) if lines else "No tasks."
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run pytest tests/debate/test_nodes.py -v
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/debate/nodes.py tests/debate/test_nodes.py
git commit -m "feat(debate): include task remark in council prompt"
```

---

## Task 3: Backend — OAuth callback redirects to `/app`

**Files:**
- Modify: `src/weekforge/api/google_routes.py`
- Test: `tests/api/test_google_routes.py`

- [ ] **Step 1: Update the existing callback test**

In `tests/api/test_google_routes.py`, update `test_callback_completes_login_and_redirects_to_frontend`:

```python
def test_callback_completes_login_and_redirects_to_frontend(unconnected_client):
    client, fake = unconnected_client
    resp = client.get("/auth/google/callback?code=fake-code&state=s")
    assert resp.status_code == 307
    assert resp.headers["location"] == "http://localhost:3000/app?google=connected"
    assert fake.is_connected()
```

- [ ] **Step 2: Run the updated test to verify it fails**

```bash
uv run pytest tests/api/test_google_routes.py::test_callback_completes_login_and_redirects_to_frontend -v
```

Expected: FAIL — current redirect lands at `http://localhost:3000?google=connected`, not `/app`

- [ ] **Step 3: Fix the redirect target**

In `src/weekforge/api/google_routes.py`, update `auth_callback`:

```python
@router.get("/auth/google/callback")
def auth_callback(code: str, state: str = ""):
    google.complete_login(code)
    frontend = google.frontend_url()
    return RedirectResponse(url=f"{frontend}/app?google=connected", status_code=307)
```

- [ ] **Step 4: Run all Google routes tests to verify they pass**

```bash
uv run pytest tests/api/test_google_routes.py -v
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/api/google_routes.py tests/api/test_google_routes.py
git commit -m "fix(oauth): redirect callback to /app after Google login"
```

---

## Task 4: Backend — Import all calendars (include WeekForge output)

**Files:**
- Modify: `src/weekforge/integration.py`
- Test: `tests/test_integration_calendars.py`

- [ ] **Step 1: Update the existing calendars test**

In `tests/test_integration_calendars.py`, replace `test_list_calendars_excludes_weekforge_and_marks_primary_default` with:

```python
def test_list_calendars_includes_all_calendars_and_selects_all_by_default():
    client = FakeClient(calendars=[
        {"id": "najum@gmail.com", "summary": "najum@gmail.com", "primary": True},
        {"id": "holidays@x", "summary": "US Holidays"},
        {"id": "wf@x", "summary": "WeekForge"},
    ])
    google = _make(client)

    cals = google.list_calendars()

    summaries = [c["summary"] for c in cals]
    # WeekForge calendar is now included — importing previous output is intentional
    assert "WeekForge" in summaries
    assert len(cals) == 3

    # All calendars default-selected so import picks up everything
    assert all(c["selected_by_default"] for c in cals)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_integration_calendars.py::test_list_calendars_includes_all_calendars_and_selects_all_by_default -v
```

Expected: FAIL — WeekForge is currently excluded, and only primary is default-selected

- [ ] **Step 3: Remove the exclusion and default-select all**

In `src/weekforge/integration.py`, update `list_calendars`:

```python
def list_calendars(self) -> list[dict]:
    """Return the user's calendars for the import picker.

    All calendars are listed and selected by default so import captures
    the full picture. The WeekForge output calendar is included — users
    can deselect it in the picker if they want to exclude previous output.
    """
    result: list[dict] = []
    for c in self._client().list_calendars():
        result.append(
            {
                "id": c["id"],
                "summary": c.get("summary"),
                "primary": bool(c.get("primary", False)),
                "selected_by_default": True,
            }
        )
    return result
```

- [ ] **Step 4: Run the full integration calendar test suite**

```bash
uv run pytest tests/test_integration_calendars.py -v
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/integration.py tests/test_integration_calendars.py
git commit -m "feat(integration): include all calendars in import picker, select all by default"
```

---

## Task 5: Frontend — `googleDisconnect` fetch helper

**Files:**
- Modify: `lib/api.ts`
- Test: `lib/api.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the `"google calendar helpers"` describe block in `lib/api.test.ts`:

```typescript
it("googleDisconnect POSTs to the disconnect endpoint", async () => {
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);

  const { googleDisconnect } = await import("@/lib/api");
  await googleDisconnect("http://api");

  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("http://api/auth/google/disconnect");
  expect(init.method).toBe("POST");
});
```

Also add `googleDisconnect` to the import at the top of `lib/api.test.ts`:

```typescript
import {
  googleStatus, googleLoginUrl, listCalendars, importBusy,
  exportSchedule, googleDisconnectUrl, googleDisconnect,
} from "@/lib/api";
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm test -- --run lib/api.test.ts
```

Expected: FAIL with `googleDisconnect is not a function`

- [ ] **Step 3: Add `googleDisconnect` to api.ts**

In `lib/api.ts`, add after `googleDisconnectUrl`:

```typescript
export async function googleDisconnect(base: string = API_BASE): Promise<void> {
  const res = await fetch(`${base}/auth/google/disconnect`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to disconnect: ${res.status}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --run lib/api.test.ts
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add lib/api.ts lib/api.test.ts
git commit -m "feat(api): add googleDisconnect POST helper"
```

---

## Task 6: Frontend — `statusKnown` and `disconnect` in `useGoogleCalendar`

**Files:**
- Modify: `lib/useGoogleCalendar.ts`
- Test: `lib/useGoogleCalendar.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the content of `lib/useGoogleCalendar.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useGoogleCalendar } from "@/lib/useGoogleCalendar";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/google/status")) return { ok: true, json: async () => ({ connected: true }) };
      if (url.endsWith("/auth/google/disconnect") && init?.method === "POST")
        return { ok: true, json: async () => ({}) };
      if (url.includes("/calendar/google/calendars")) return {
        ok: true,
        json: async () => ({ calendars: [{ id: "p", summary: "me", primary: true, selected_by_default: true }] }),
      };
      if (url.includes("/calendar/google/busy")) return {
        ok: true,
        json: async () => ({ busy_blocks: [{ start: "s", end: "e", label: "Standup", task_id: null }] }),
      };
      return { ok: true, json: async () => ({}) };
    }),
  );
});

afterEach(() => vi.restoreAllMocks());

describe("useGoogleCalendar", () => {
  it("statusKnown is false initially, true after status resolves", async () => {
    const { result } = renderHook(() => useGoogleCalendar("http://api"));
    expect(result.current.statusKnown).toBe(false);
    await waitFor(() => expect(result.current.statusKnown).toBe(true));
  });

  it("loads connection status on mount", async () => {
    const { result } = renderHook(() => useGoogleCalendar("http://api"));
    await waitFor(() => expect(result.current.connected).toBe(true));
  });

  it("loads calendars and tracks selection", async () => {
    const { result } = renderHook(() => useGoogleCalendar("http://api"));
    await act(async () => { await result.current.loadCalendars(); });
    expect(result.current.calendars).toHaveLength(1);
    expect(result.current.selectedIds).toEqual(["p"]);
    act(() => result.current.toggleCalendar("p"));
    expect(result.current.selectedIds).toEqual([]);
  });

  it("imports busy blocks for the selected calendars", async () => {
    const { result } = renderHook(() => useGoogleCalendar("http://api"));
    await act(async () => { await result.current.loadCalendars(); });
    let blocks: import("@/lib/types").TimeBlock[] | undefined;
    await act(async () => { blocks = await result.current.importWeek("2026-06-15"); });
    expect(blocks).toHaveLength(1);
    expect(blocks![0].label).toBe("Standup");
  });

  it("disconnect POSTs and sets connected to false", async () => {
    const { result } = renderHook(() => useGoogleCalendar("http://api"));
    await waitFor(() => expect(result.current.connected).toBe(true));
    await act(async () => { await result.current.disconnect(); });
    expect(result.current.connected).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --run lib/useGoogleCalendar.test.ts
```

Expected: FAIL — `statusKnown` and `disconnect` do not exist yet

- [ ] **Step 3: Update `useGoogleCalendar.ts`**

Replace the content of `lib/useGoogleCalendar.ts` with:

```typescript
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  googleStatus, googleDisconnect, listCalendars, importBusy, CalendarInfo,
} from "@/lib/api";
import { TimeBlock } from "@/lib/types";

export interface UseGoogleCalendar {
  connected: boolean;
  statusKnown: boolean;
  calendars: CalendarInfo[];
  selectedIds: string[];
  loadCalendars: () => Promise<void>;
  toggleCalendar: (id: string) => void;
  importWeek: (weekStart: string) => Promise<TimeBlock[]>;
  disconnect: () => Promise<void>;
}

export function useGoogleCalendar(base?: string): UseGoogleCalendar {
  const [connected, setConnected] = useState(false);
  const [statusKnown, setStatusKnown] = useState(false);
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    googleStatus(base)
      .then((c) => { setConnected(c); setStatusKnown(true); })
      .catch(() => { setConnected(false); setStatusKnown(true); });
  }, [base]);

  const loadCalendars = useCallback(async () => {
    const cals = await listCalendars(base);
    setCalendars(cals);
    setSelectedIds(cals.filter((c) => c.selected_by_default).map((c) => c.id));
  }, [base]);

  const toggleCalendar = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const importWeek = useCallback(
    (weekStart: string) => importBusy(weekStart, selectedIds, base),
    [selectedIds, base],
  );

  const disconnect = useCallback(async () => {
    await googleDisconnect(base);
    setConnected(false);
  }, [base]);

  return { connected, statusKnown, calendars, selectedIds, loadCalendars, toggleCalendar, importWeek, disconnect };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --run lib/useGoogleCalendar.test.ts
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add lib/useGoogleCalendar.ts lib/useGoogleCalendar.test.ts
git commit -m "feat(hook): add statusKnown and disconnect to useGoogleCalendar"
```

---

## Task 7: Frontend — GoogleConnect unbind as button

**Files:**
- Modify: `components/GoogleConnect.tsx`
- Test: `components/GoogleConnect.test.tsx`
- Modify: `app/app/page.tsx` (prop swap only)

- [ ] **Step 1: Write failing tests**

Replace `components/GoogleConnect.test.tsx` with:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GoogleConnect } from "@/components/GoogleConnect";

describe("GoogleConnect", () => {
  it("shows a connect link when disconnected", () => {
    render(<GoogleConnect connected={false} loginUrl="http://api/auth/google/login" onDisconnect={vi.fn()} />);
    const link = screen.getByRole("link", { name: /bind your google calendar/i });
    expect(link).toHaveAttribute("href", "http://api/auth/google/login");
  });

  it("shows the bound seal when connected", () => {
    render(<GoogleConnect connected={true} loginUrl="http://api/auth/google/login" onDisconnect={vi.fn()} />);
    expect(screen.getByText(/calendar bound/i)).toBeInTheDocument();
  });

  it("unbind is a button (not a link) that calls onDisconnect", async () => {
    const onDisconnect = vi.fn();
    render(<GoogleConnect connected={true} loginUrl="http://api/auth/google/login" onDisconnect={onDisconnect} />);
    const btn = screen.getByRole("button", { name: /unbind/i });
    await userEvent.click(btn);
    expect(onDisconnect).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --run components/GoogleConnect.test.tsx
```

Expected: FAIL — `onDisconnect` prop doesn't exist, unbind is currently an `<a>` not a `<button>`

- [ ] **Step 3: Update `GoogleConnect.tsx`**

Replace the content of `components/GoogleConnect.tsx` with:

```typescript
export function GoogleConnect({
  connected,
  loginUrl,
  onDisconnect,
}: {
  connected: boolean;
  loginUrl: string;
  onDisconnect: () => void;
}) {
  if (!connected) {
    return (
      <a
        href={loginUrl}
        className="group inline-flex items-center gap-2.5 rounded-xl border border-[#272430] bg-[#0c0d12] px-4 py-2.5 text-sm font-semibold text-foreground/90 transition-colors hover:border-guardian/50 hover:text-foreground"
        data-testid="google-connect"
      >
        <span aria-hidden className="text-base">🗓</span>
        Bind your Google Calendar
        <span className="font-mono text-[10px] uppercase tracking-wider text-[#4a4845] transition-colors group-hover:text-guardian/70">
          optional
        </span>
      </a>
    );
  }
  return (
    <div
      className="inline-flex items-center gap-3 rounded-xl border border-guardian/30 bg-guardian/[0.07] px-3.5 py-2 shadow-[inset_0_0_18px_-8px_var(--guardian)]"
      data-testid="google-connected"
    >
      {/* Glowing bound-rune. */}
      <span aria-hidden className="relative grid h-5 w-5 place-items-center">
        <span className="absolute inset-0 rounded-full bg-guardian/25 blur-[5px]" />
        <span className="relative h-2 w-2 rounded-full bg-guardian shadow-[0_0_10px_2px_var(--guardian)]" />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold text-foreground">Calendar bound</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-guardian/70">
          Google · live
        </span>
      </span>
      <span aria-hidden className="mx-0.5 h-6 w-px bg-guardian/20" />
      <button
        type="button"
        onClick={onDisconnect}
        className="font-mono text-[11px] tracking-wide text-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
      >
        unbind
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Update `app/app/page.tsx` to use the new prop**

In `app/app/page.tsx`, find the `googleSlot` JSX and change the `GoogleConnect` usage:

Old:
```typescript
import { googleLoginUrl, googleDisconnectUrl, exportSchedule } from "@/lib/api";
```
New:
```typescript
import { googleLoginUrl, exportSchedule } from "@/lib/api";
```

Old:
```typescript
<GoogleConnect
  connected={google.connected}
  loginUrl={googleLoginUrl()}
  disconnectUrl={googleDisconnectUrl()}
/>
```
New:
```typescript
<GoogleConnect
  connected={google.connected}
  loginUrl={googleLoginUrl()}
  onDisconnect={google.disconnect}
/>
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- --run components/GoogleConnect.test.tsx
```

Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add components/GoogleConnect.tsx components/GoogleConnect.test.tsx app/app/page.tsx
git commit -m "fix(GoogleConnect): unbind via POST instead of GET anchor"
```

---

## Task 8: Frontend — Pass remark to the council via `buildRequest`

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/buildRequest.ts`
- Test: `lib/buildRequest.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `lib/buildRequest.test.ts` (inside a new describe block at the end of the file):

```typescript
describe("buildRequest — remark", () => {
  it("includes remark on the task when non-empty", () => {
    const req = buildRequest(
      [makeDraft({ remark: "Do this early in the morning" })],
      noBlocks,
      prefs,
    );
    expect(req.tasks[0].remark).toBe("Do this early in the morning");
  });

  it("omits remark when blank", () => {
    const req = buildRequest([makeDraft({ remark: "" })], noBlocks, prefs);
    expect(req.tasks[0].remark).toBeUndefined();
  });

  it("omits remark when whitespace only", () => {
    const req = buildRequest([makeDraft({ remark: "   " })], noBlocks, prefs);
    expect(req.tasks[0].remark).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --run lib/buildRequest.test.ts
```

Expected: FAIL — `remark` is currently dropped in `buildRequest`

- [ ] **Step 3: Add `remark` to `TaskInput` in `lib/types.ts`**

In `lib/types.ts`, update `TaskInput`:

```typescript
export interface TaskInput {
  id: string;
  title: string;
  estimated_minutes: number;
  deadline?: string | null;
  priority?: number;
  category?: string | null;
  depends_on?: string[];
  preferred_days?: string[];
  remark?: string | null;
}
```

- [ ] **Step 4: Include remark in `buildRequest`**

In `lib/buildRequest.ts`, update the `TaskDraft` comment and the `buildRequest` tasks mapping:

Change the comment on `remark` in `TaskDraft` from:
```typescript
remark: string; // planner's note to themselves; UI-only, not sent to the council
```
to:
```typescript
remark: string; // planner's note to the council; included in the request when non-empty
```

Update the tasks mapping inside `buildRequest`:

```typescript
tasks: tasks.map((t, i) => ({
  id: `t${i + 1}`,
  title: t.title.trim(),
  estimated_minutes: Number(t.estimatedMinutes),
  priority: t.priority,
  deadline: t.hasDeadline ? deadlineToISO(t.deadlineWeekday) : null,
  ...(t.preferredDays.length > 0 && { preferred_days: t.preferredDays }),
  ...(t.remark.trim() !== "" && { remark: t.remark.trim() }),
})),
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- --run lib/buildRequest.test.ts
```

Expected: All PASS (including the existing tests which expect no `remark` key when blank)

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/buildRequest.ts lib/buildRequest.test.ts
git commit -m "feat(buildRequest): pass task remark to the council"
```

---

## Task 9: Frontend — WeekCalendar: editable time + delete

**Files:**
- Modify: `lib/calendarEvents.ts`
- Modify: `components/WeekCalendar.tsx`
- Test: `components/WeekCalendar.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `components/WeekCalendar.test.tsx`:

```typescript
import userEvent from "@testing-library/user-event";

describe("WeekCalendar — editable mode", () => {
  it("renders time inputs when onEditTime is provided", () => {
    render(
      <WeekCalendar
        schedule={SCHEDULE}
        onEditTime={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    // Each block row should have two <input type="time"> elements
    const inputs = document.querySelectorAll('input[type="time"]');
    expect(inputs.length).toBe(SCHEDULE.blocks.length * 2); // start + end per block
  });

  it("calls onDelete with the correct block index when delete is clicked", async () => {
    const onDelete = vi.fn();
    render(
      <WeekCalendar schedule={SCHEDULE} onEditTime={vi.fn()} onDelete={onDelete} />,
    );
    const deleteButtons = screen.getAllByRole("button", { name: /delete block/i });
    await userEvent.click(deleteButtons[0]);
    expect(onDelete).toHaveBeenCalledWith(0);
  });

  it("calls onEditTime with block index, field, and new value", async () => {
    const onEditTime = vi.fn();
    render(
      <WeekCalendar schedule={SCHEDULE} onEditTime={onEditTime} onDelete={vi.fn()} />,
    );
    const startInputs = document.querySelectorAll<HTMLInputElement>('input[type="time"]');
    await userEvent.clear(startInputs[0]);
    await userEvent.type(startInputs[0], "10:30");
    // onEditTime called with (0, "start", "10:30")
    expect(onEditTime).toHaveBeenCalledWith(0, "start", expect.stringContaining("10:30"));
  });

  it("does not render delete buttons or time inputs in read-only mode", () => {
    render(<WeekCalendar schedule={SCHEDULE} />);
    expect(screen.queryByRole("button", { name: /delete block/i })).not.toBeInTheDocument();
    expect(document.querySelectorAll('input[type="time"]').length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --run components/WeekCalendar.test.tsx
```

Expected: FAIL — WeekCalendar doesn't accept `onEditTime` or `onDelete`

- [ ] **Step 3: Add `blockIndex` to `CalendarEvent` in `lib/calendarEvents.ts`**

In `lib/calendarEvents.ts`, update the `CalendarEvent` interface and `toCalendarEvents`:

```typescript
export interface CalendarEvent {
  title: string;
  start: Date;
  end: Date;
  color: string;
  blockIndex: number;
}

export function toCalendarEvents(blocks: TimeBlock[]): CalendarEvent[] {
  return blocks.map((b, i) => ({
    title: b.label,
    start: new Date(b.start),
    end: new Date(b.end),
    color: PALETTE[i % PALETTE.length],
    blockIndex: i,
  }));
}
```

(`groupEventsByDay` and `DayGroup` don't need changes — they carry `CalendarEvent` as-is.)

- [ ] **Step 4: Update `WeekCalendar.tsx` with optional edit/delete callbacks**

Replace `components/WeekCalendar.tsx` with:

```typescript
"use client";

import { format } from "date-fns";
import { Schedule } from "@/lib/types";
import { toCalendarEvents, groupEventsByDay } from "@/lib/calendarEvents";

function formatDuration(start: Date, end: Date): string {
  const mins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function toTimeInput(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function WeekCalendar({
  schedule,
  onEditTime,
  onDelete,
}: {
  schedule: Schedule;
  onEditTime?: (blockIndex: number, field: "start" | "end", timeStr: string) => void;
  onDelete?: (blockIndex: number) => void;
}) {
  if (schedule.blocks.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="schedule-empty">
        The council produced an empty schedule.
      </p>
    );
  }

  const editable = Boolean(onEditTime && onDelete);
  const events = toCalendarEvents(schedule.blocks);
  const days = groupEventsByDay(events);

  return (
    <div
      className="animate-forged scroll-forge max-h-[600px] overflow-y-auto rounded-xl border border-[#272430] bg-gradient-to-b from-[#15171f] to-[#101219] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
      data-testid="week-calendar"
    >
      <ol className="flex flex-col">
        {days.map((day) => (
          <li key={day.key}>
            <div className="sticky top-0 z-10 flex items-baseline justify-between border-b border-[#272430] bg-[#13151c]/95 px-4 py-2.5 backdrop-blur">
              <span className="font-display text-[0.9rem] leading-none tracking-tight text-amber">
                {format(day.date, "EEE")}{" "}
                <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-muted">
                  {format(day.date, "MMM d")}
                </span>
              </span>
              <span className="font-mono text-[0.62rem] font-medium uppercase tracking-[0.18em] text-muted">
                {day.events.length} {day.events.length === 1 ? "block" : "blocks"}
              </span>
            </div>

            <ul className="flex flex-col py-1">
              {day.events.map((e) => (
                <li
                  key={e.blockIndex}
                  className="group flex gap-3.5 px-4 py-3 transition-colors hover:bg-white/[0.025]"
                >
                  <span
                    aria-hidden
                    className="mt-0.5 w-[3px] shrink-0 self-stretch rounded-full transition-shadow"
                    style={{ backgroundColor: e.color, boxShadow: `0 0 8px -1px ${e.color}` }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-sans text-[0.95rem] font-semibold leading-snug text-foreground">
                      {e.title}
                    </p>
                    <p className="mt-1.5 flex items-center gap-2 font-mono text-[0.72rem] text-muted">
                      {editable ? (
                        <>
                          <input
                            type="time"
                            defaultValue={toTimeInput(e.start)}
                            onChange={(ev) => onEditTime!(e.blockIndex, "start", ev.target.value)}
                            className="border-0 border-b border-[#272430] bg-transparent font-mono text-[0.72rem] text-muted outline-none focus:border-ember"
                            aria-label={`Start time for ${e.title}`}
                          />
                          <span className="text-border">–</span>
                          <input
                            type="time"
                            defaultValue={toTimeInput(e.end)}
                            onChange={(ev) => onEditTime!(e.blockIndex, "end", ev.target.value)}
                            className="border-0 border-b border-[#272430] bg-transparent font-mono text-[0.72rem] text-muted outline-none focus:border-ember"
                            aria-label={`End time for ${e.title}`}
                          />
                        </>
                      ) : (
                        <>
                          <span>{format(e.start, "h:mm a")}</span>
                          <span className="text-border">–</span>
                          <span>{format(e.end, "h:mm a")}</span>
                        </>
                      )}
                      <span className="ml-auto rounded-md border border-white/[0.05] bg-white/[0.04] px-2 py-0.5 text-[0.66rem] text-muted/90">
                        {formatDuration(e.start, e.end)}
                      </span>
                      {editable && (
                        <button
                          type="button"
                          onClick={() => onDelete!(e.blockIndex)}
                          aria-label={`Delete block ${e.title}`}
                          className="ml-1 text-[#3a3530] transition-colors hover:text-rose-400"
                        >
                          ✕
                        </button>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
```

- [ ] **Step 5: Run all WeekCalendar tests**

```bash
npm test -- --run components/WeekCalendar.test.tsx
```

Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add lib/calendarEvents.ts components/WeekCalendar.tsx components/WeekCalendar.test.tsx
git commit -m "feat(WeekCalendar): optional edit-time and delete callbacks before export"
```

---

## Task 10: Frontend — App page: login gate + `editedBlocks` + wire everything

**Files:**
- Modify: `app/app/page.tsx`
- Test: `app/app/page.test.tsx`

- [ ] **Step 1: Write failing tests**

Replace `app/app/page.test.tsx` with:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Home from "./page";

function mockFetch(connected: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/auth/google/status"))
        return { ok: true, json: async () => ({ connected }) };
      return { ok: true, json: async () => ({}) };
    }),
  );
}

beforeEach(() => {
  mockFetch(false);
});

describe("Home page — login gate", () => {
  it("shows the login screen when not connected", async () => {
    render(<Home />);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /sign in with google/i })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("task-form")).not.toBeInTheDocument();
  });

  it("shows the task form when connected", async () => {
    mockFetch(true);
    render(<Home />);
    await waitFor(() => expect(screen.getByTestId("task-form")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /sign in with google/i })).not.toBeInTheDocument();
  });

  it("renders nothing while status is loading", () => {
    // fetch never resolves — statusKnown stays false
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<Home />);
    expect(screen.queryByTestId("task-form")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign in with google/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --run app/app/page.test.tsx
```

Expected: FAIL — page currently shows task-form regardless of connection state

- [ ] **Step 3: Add login gate and `editedBlocks` to `app/app/page.tsx`**

At the top of `app/app/page.tsx`, the imports stay the same except replace the `googleDisconnectUrl` import (already removed in Task 7).

Add `editedBlocks` state and handlers inside `Home()`, right after the existing state declarations (`showForged`, `forgedShownRef`):

```typescript
// ── Editable copy of the forged schedule ──────────────────────────────────
const [editedBlocks, setEditedBlocks] = useState<import("@/lib/types").TimeBlock[]>([]);

useEffect(() => {
  if (state.status === "done" && state.schedule) {
    setEditedBlocks(state.schedule.blocks);
  } else if (state.status === "idle") {
    setEditedBlocks([]);
  }
}, [state.status, state.schedule]);

function handleEditTime(blockIndex: number, field: "start" | "end", timeStr: string) {
  setEditedBlocks((prev) =>
    prev.map((b, i) => {
      if (i !== blockIndex) return b;
      const base = new Date(b[field]);
      const [h, m] = timeStr.split(":").map(Number);
      base.setHours(h, m, 0, 0);
      const updated = base.toISOString();
      const newBlock = { ...b, [field]: updated };
      if (new Date(newBlock.end).getTime() <= new Date(newBlock.start).getTime()) return b;
      return newBlock;
    }),
  );
}

function handleDeleteBlock(blockIndex: number) {
  setEditedBlocks((prev) => prev.filter((_, i) => i !== blockIndex));
}
```

Add the login gate at the start of the `return` in `Home()`, before the existing `<main>`:

```typescript
// ── Login gate ─────────────────────────────────────────────────────────────
if (!google.statusKnown) return null;

if (!google.connected) {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-4">
      <AppAtmosphere />
      <div className="flex flex-col items-center gap-8 text-center">
        <ForgeLogo size="lg" href="/" />
        <div>
          <h2 className="font-display text-3xl font-light tracking-tight">
            The council awaits your calendar.
          </h2>
          <p className="mt-3 text-sm text-muted">
            Connect Google Calendar to convene the council and forge your week.
          </p>
        </div>
        <a
          href={googleLoginUrl()}
          className="inline-flex items-center gap-2 rounded-xl bg-ember px-7 py-3.5 text-sm font-semibold text-background shadow-[0_0_0_0_rgba(255,107,53,0.5)] transition-all duration-300 hover:shadow-[0_0_36px_4px_rgba(255,107,53,0.45)]"
        >
          Sign in with Google →
        </a>
      </div>
    </main>
  );
}
```

Update the `WeekCalendar` usage (inside the `!showForm` block) to use `editedBlocks` and pass edit/delete handlers:

Old:
```typescript
<WeekCalendar schedule={state.schedule} />
{google.connected && (
  <ExportButton
    onExport={() => exportSchedule(currentWeekStartLocal(), state.schedule!.blocks)}
  />
)}
```

New:
```typescript
<WeekCalendar
  schedule={{ ...state.schedule!, blocks: editedBlocks }}
  onEditTime={handleEditTime}
  onDelete={handleDeleteBlock}
/>
{google.connected && (
  <ExportButton
    onExport={() => exportSchedule(currentWeekStartLocal(), editedBlocks)}
  />
)}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --run app/app/page.test.tsx
```

Expected: All PASS

- [ ] **Step 5: Run the full frontend test suite**

```bash
npm test -- --run
```

Expected: All PASS. If any tests fail due to the `GoogleConnect` prop rename or `statusKnown`/`disconnect` additions, fix them now (they should already be handled by Tasks 6–8).

- [ ] **Step 6: Run the full backend test suite**

```bash
cd .. && uv run pytest -v
```

Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add app/app/page.tsx app/app/page.test.tsx
git commit -m "feat(app): mandatory Google login gate + editable forged schedule before export"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Google login is mandatory gate | Task 10 (gate) + Task 3 (callback redirect) |
| Unbind `Method Not Allowed` fix | Task 5 (POST helper) + Task 6 (hook) + Task 7 (button) |
| Remark → model | Task 1 (model) + Task 2 (nodes) + Task 8 (buildRequest/types) |
| Import all calendars incl. WeekForge | Task 4 |
| Edit time + delete before export | Task 9 (WeekCalendar) + Task 10 (editedBlocks) |

All five spec requirements are covered. No placeholders. Type names are consistent throughout (`blockIndex: number`, `statusKnown: boolean`, `disconnect: () => Promise<void>`, `onEditTime`, `onDelete`). The `editedBlocks` state is `TimeBlock[]` (from `lib/types.ts`) consistently.
