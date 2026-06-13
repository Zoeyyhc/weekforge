# WeekForge — Design Spec

> **Codename:** Crucible · **Tagline:** *Forge your week in the crucible.*
> **Date:** 2026-06-13 · **Status:** Approved design, pre-implementation

---

## 1. One-liner

A **transparent multi-agent decision council** you can watch and participate in.
A panel of specialist agents — each defending a competing objective — **debates how to
plan your week in front of you**. You step in as the final arbiter, and you walk away
with a time-blocked schedule plus the full reasoning chain behind it. When reality
deviates, the council re-plans your remaining days from saved state, carrying the
debate history forward.

The headline is **not** "another planner." It is the **visible, participatory
deliberation engine**. Weekly planning is simply its first concrete application.

---

## 2. Goals & Non-goals

### Goals
- Showcase **deep, justified multi-agent orchestration** — the kind of architectural
  judgment that distinguishes a strong engineer, not just "I wired up a framework."
- Make the **multi-agent debate a visible product feature** (the UX), not a hidden
  backend black box.
- Demonstrate a **clean division of labor** between CrewAI and LangGraph that a reader
  can immediately understand *why* both are used.
- Be **live-demoable** and **dogfoodable** (the author plans their own week with it).

### Non-goals (YAGNI — deliberately out of scope for v1)
- ❌ Mobile app, multi-user accounts, auth/billing.
- ❌ A sophisticated ML/constraint-solver scheduler. A heuristic allocator + LLM
  judgment is enough; **the intelligence lives in deliberation, not in an optimizer**.
- ❌ More than one application domain. The engine is designed to be extensible, but
  v1 implements **only weekly planning**.
- ❌ Heavy external data integrations. Only the LLM and a calendar feed are required.

---

## 3. Core concept: a *real* debate, not theater

The single biggest risk is the debate degenerating into **LLMs performing fake
disagreement**. Three design rules keep it substantive:

1. **Conflict must be a genuine objective conflict.** The debaters defend goals that
   are *mathematically unable to be optimal simultaneously*, so tension is real:
   - **Deadline Hawk** — maximize on-time delivery; wants the schedule packed.
   - **Energy Guardian** — protect against burnout; wants breaks, no back-to-back
     high-intensity days, deep-work blocks protected.
   - **Focus Batcher** — minimize context-switching; wants similar tasks grouped,
     opposes fragmentation.
2. **The debate converges to a traceable decision.** Rounds run
   *propose → critique → revise → check convergence*, then an **Arbiter** synthesizes a
   final schedule with explicit rationale (including trade-offs it rejected).
3. **The user is a participant, not a spectator.** When the council stalls or the user
   disagrees, they can **side with an agent, add a constraint, or veto** — and the
   debate resumes with that input. This is participatory human-in-the-loop.

---

## 4. Architecture — why two frameworks

> **CrewAI defines the debaters (roles, stances, personas).
> LangGraph runs the debate (multi-round loop, convergence, arbitration, human
> interrupt, checkpoint/resume).**

This split is *forced by the headline feature*, which makes the "why two frameworks"
answer airtight in interviews.

### 4.1 CrewAI — the council (cognition / collaboration)
A crew of role-bound agents, each with a distinct objective function and persona:

| Agent          | Stance / objective                                              |
|----------------|-----------------------------------------------------------------|
| Deadline Hawk  | Time-criticality; argues for packing to hit deadlines           |
| Energy Guardian| Wellbeing; argues for slack, breaks, protected deep work        |
| Focus Batcher  | Low context-switching; argues for grouping similar tasks        |
| **Arbiter**    | Neutral synthesizer; weighs the above, produces the decision    |

Each debater also contributes domain judgment humans find hard: **effort
re-estimation** (correcting optimism bias) and **priority reasoning** (e.g. an
Eisenhower / value-vs-effort framing).

### 4.2 LangGraph — the debate flow (control plane / state)

```
intake (normalize tasks + calendar + prefs into state)
   │
   ▼
gather_proposals ──► [CrewAI debaters each propose]
   │
   ▼
critique ──► [debaters attack each other's weak points]
   │
   ▼
revise ──► [debaters adjust]
   │
   ▼
converged? ──┬─ no, under round cap ─────────► back to gather_proposals   (the LOOP)
             │
             ├─ stalled / large disagreement ─► HUMAN INTERRUPT
             │      surface the contested point; user sides / adds constraint / vetoes
             │      → resume with user input
             │
             └─ yes ─────────────────────────► arbitrate (Arbiter synthesizes)
                                                   │
                                                   ▼
                                                validate (no overlaps? deadlines met?
                                                          daily load <= cap? deps ok?)
                                                   │
                                          ┌─ fail ─┴─ pass ─► finalize (schedule + transcript)
                                          │
                                          └─ repair ─► back to arbitrate / gather_proposals
```

- **Cyclic repair**: bounded round cap prevents infinite loops.
- **Participatory HITL**: `interrupt()` hands the contested decision to the user.
- **Checkpointer (state persistence)**: each *week* is a thread. State **and debate
  history** are saved. The next day the user re-enters with progress updates; the graph
  **resumes from the checkpoint** and re-plans only the remaining days.

---

## 5. Data layer — minimal, pluggable

The project's value is deliberation, not data plumbing. External hard dependencies are
only **the LLM** and **a calendar feed** (which has a zero-OAuth path). Everything else
is user input.

Sources sit behind interfaces so dev/demo/real backends are hot-swappable (also makes
testing easy — a strong engineering signal):

```
CalendarProvider.get_busy_blocks(date_range) -> [TimeBlock]
    impls: MockCalendar  →  ICSCalendar (secret iCal URL, no OAuth)  →  GoogleCalendar (read-only; optional write-back)

TaskProvider.get_tasks() -> [Task]
    impls: JSONTasks (v1)  →  (optional) Todoist / Notion
```

| Data                          | Source                         | External access?      |
|-------------------------------|--------------------------------|-----------------------|
| Fixed commitments (busy)      | Calendar                       | Yes — ICS or Google   |
| Tasks (title, deadline, est.) | User-entered JSON/form         | No                    |
| Working hours / energy prefs  | One-time config                | No                    |
| Daily progress (re-planning)  | User check-in (NL or form)     | No                    |
| LLM reasoning                 | Anthropic Claude API           | **Yes — only hard dep** |

**Calendar plan:** Mock for development → **ICS secret-URL** for real-data demos (no
OAuth) → Google Calendar API read-only (and optional event write-back) as a stretch
"real integration + OAuth" résumé line.

---

## 6. Backend

- **FastAPI** wraps the LangGraph/CrewAI engine.
- **Streaming**: debate rounds are pushed to the frontend live via **SSE** (or
  WebSocket) — LangGraph's streaming maps cleanly onto this. Watching the debate
  unfold in real time is the high point of the demo.
- Endpoints (indicative): start/replan a week, stream the debate, submit a user
  intervention (side / constrain / veto), submit daily progress.
- **Persistence**: SQLite-backed checkpointer keyed by week. No Postgres needed for v1.

## 7. Frontend

- **Next.js / React** (chosen for polish and to reuse the author's existing TS skills;
  pairs with the Python backend to show full-stack range).
- **Debate timeline UX**: each agent has an avatar/color; proposals and critiques
  stream in round by round like a conversation/timeline.
- **Intervention UI**: at an interrupt the user can side with an agent, add a
  constraint, or veto — then the debate resumes.
- **Output view**: the final time-blocked weekly schedule + an expandable reasoning
  chain (and the trade-offs the Arbiter rejected).
- Built with the `frontend-design` skill during implementation (it applies because the
  UI is custom React, not a constrained framework like Streamlit).

---

## 8. Tech stack summary

| Layer        | Choice                                                    |
|--------------|-----------------------------------------------------------|
| Debaters     | CrewAI (Python)                                           |
| Orchestration| LangGraph (Python) — debate loop, HITL, checkpointer      |
| LLM          | Anthropic Claude (latest capable model)                   |
| Backend      | FastAPI + SSE/WebSocket streaming                         |
| Persistence  | SQLite checkpointer (per-week threads)                    |
| Frontend     | Next.js / React                                           |
| Data sources | Provider interfaces: Calendar (Mock→ICS→Google), Tasks (JSON) |

---

## 9. Risks & mitigations

| Risk                                            | Mitigation                                            |
|-------------------------------------------------|-------------------------------------------------------|
| Debate becomes theatrical / fake disagreement   | Ground debaters in genuinely conflicting objectives   |
| Scheduler becomes pure algorithm, LLM adds nothing | Keep LLM in priority reasoning, effort re-estimation, trade-off explanation |
| Calendar OAuth eats time                        | Start Mock → ICS secret URL (no OAuth); Google is stretch |
| Over-investing in UI dilutes the orchestration headline | UI serves the debate-visualization; don't gold-plate beyond it |
| Debate loop runs away on cost/latency           | Hard round cap; converge early; small models for non-arbiter turns if needed |

---

## 10. Demo narrative (interview script)

> "I built an AI decision council. You drop in your week's tasks and three
> conflicting-objective agents debate the schedule **in front of you** — the Deadline
> Hawk wants it packed, the Energy Guardian wants slack, the Focus Batcher wants
> similar work grouped. You watch them argue round by round, and if you don't like
> where it's heading you step in and arbitrate. Under the hood, CrewAI plays the
> debaters and LangGraph runs the debate loop, the human-in-the-loop interrupt, and
> the checkpointed re-planning when my week changes."

---

## 11. Future extensions (explicitly deferred)

- Additional decision domains reusing the same engine (the council is domain-agnostic).
- Google Calendar write-back; Todoist/Notion task providers.
- Per-user estimation-bias learning (the planner gets calibrated to you over time).
- "Fork your week" what-if simulation via checkpoint branching.
