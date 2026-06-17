<div align="center">

# WeekForge

### *Forge your week in the crucible.*

**A transparent, participatory multi-agent council that plans your week — and shows you exactly how it decided.**

</div>

---

## The problem

Every planning tool hands you an answer and hides the reasoning. You get a tidy calendar, but no idea *why* the deep-work block landed on Tuesday, *what* it traded away to fit the deadline, or *how* to push back when it's wrong. The hard part of planning was never drawing the boxes — it's the **negotiation between competing priorities** that nobody lets you see.

WeekForge makes that negotiation the product.

## The idea

Instead of one model silently optimizing a black box, WeekForge convenes a **council of specialists with genuinely conflicting objectives** and lets them argue your week out **in front of you**:

| Agent | Cares about | Will fight for |
|---|---|---|
| 🦅 **Deadline Hawk** | Urgency | Time-sensitive work first — because people systematically underestimate time pressure |
| 🛡️ **Energy Guardian** | Sustainability | Breaks, recovery, no back-to-back intensity — because burnout destroys more output than it saves |
| 🎯 **Focus Batcher** | Deep work | Long uninterrupted blocks, batched similar tasks — because fragmentation is the enemy of great work |
| ⚖️ **The Arbiter** | The whole picture | A schedule that honors all three as well as reality allows — and *names the trade-offs it accepted* |

They propose, critique each other, and converge. When they stall, **you** step in as the final arbiter: side with an agent, add a constraint, or veto an idea. What you get back is a time-blocked week **plus the full reasoning chain that produced it** — not a verdict from nowhere.

> The visible debate is the headline feature. Weekly planning is just the first application of a **domain-agnostic decision engine**: any problem where specialists with competing objectives must reach a justified, auditable decision.

## How it works

```
 gather_proposals ──► critique ──► check_convergence ─┬─ converged ───► arbitrate ──► validate ──► finalize
        ▲                                             │                                  │  ▲          │
        └──────────── more rounds ────────────────────┤                                  └──┘          ▼
                                                       └─ stalled ──► human_interrupt ──► (bounded loop)   schedule
```

- **CrewAI** defines *who debates* — the four agents, their personas, goals, and backstories.
- **LangGraph** runs *how the debate flows* — the propose → critique → converge loop, the human-in-the-loop `interrupt()`, and a SQLite checkpointer so a week can be **re-planned from a checkpoint** when reality changes.
- **FastAPI + Server-Sent Events** stream every step to a **Next.js** frontend, so the debate timeline animates live and the resulting schedule is editable.

Full node-by-node reference: [`docs/langgraph-workflow.md`](docs/langgraph-workflow.md).

## Design philosophy

The interesting engineering in WeekForge is about **where intelligence belongs — and where it doesn't.**

**1. Don't make a probabilistic component responsible for deterministic correctness.**
LLMs are brilliant at negotiation and terrible at clock arithmetic. So the Arbiter argues *about* the schedule, but the mechanical guarantees are enforced by deterministic code in [`validation.py`](src/weekforge/debate/validation.py):
- The Arbiter emits **local wall-clock times with no UTC offset**; code attaches the DST-correct offset (`_localize`). *(Asking the model for offsets once reintroduced a daylight-saving shift that made validation permanently unsatisfiable and dead-looped the debate. Lesson learned, encoded.)*
- On a retry, the model re-places **only the blocks flagged broken**; valid blocks are **frozen and merged back in code**, never re-derived by the model.
- The schedulable week is a **now-aware window** (`compute_week_window`) — schedules can never land in the past.

**2. A debate must always terminate.**
The `arbitrate ↔ validate` loop is **bounded** (`max_validation_attempts`, default 3). If validation never fully passes, WeekForge returns the closest **best-effort** schedule flagged `degraded` (with explicit `validation_warnings`) so you can review and fix it — it never spins forever, and it never crashes into a recursion limit.

**3. Every block is checked against hard rules before you ever see it.**
The semantic guardrail rejects anything that violates reality: outside your work window, overlapping a real commitment, over your daily focus cap, crossing midnight, or landing in the past. The agents debate; the guardrail referees.

## Calendar

- **Export is file-based and API-free.** WeekForge generates an `.ics` you download and import into any calendar (Google / Apple / Outlook). No Google account, no OAuth.
- **No calendar import yet.** Enter your existing commitments as busy blocks in the form; WeekForge cannot read them from a calendar in this version.
- Every generated event is stamped `X-WEEKFORGE:1` so a future import path can skip WeekForge's own output and never double-count it as busy.

## Getting started

**Prerequisites:** Python 3.12+, [uv](https://docs.astral.sh/uv/), Node.js (frontend), an Anthropic API key.

**Configure** (full table in [`CLAUDE.md`](CLAUDE.md)):

```bash
export ANTHROPIC_API_KEY=sk-ant-...

# Optional: run the Arbiter on a stronger model than the debaters
export WEEKFORGE_ARBITER_MODEL=anthropic/claude-sonnet-...   # falls back to WEEKFORGE_MODEL
```

**Run it:**

```bash
# Backend  →  http://127.0.0.1:8000
uv run weekforge-api

# Frontend →  http://localhost:3000
cd frontend && npm install && npm run dev
```

**Test it:**

```bash
uv run pytest                 # backend (debate + calendar + api)
cd frontend && npm test       # frontend (vitest)
```

## What you give it

A few **tasks** (title, estimated minutes, optional deadline, priority, category, dependencies, preferred days), your **busy blocks**, and your **preferences** (workday hours, a daily focus cap, timezone). The council takes it from there — and tells you what it did with it.

## Project structure

```
src/weekforge/
  debate/        # the engine
    graph.py       # LangGraph StateGraph + SQLite checkpointer
    nodes.py       # gather / critique / converge / arbitrate / validate / finalize
    validation.py  # deterministic guardrail: window, focus cap, DST localization, week window
    debaters.py    # the four CrewAI agents
    runner.py      # streaming debate generator
    state.py       # DebateState
  providers/     # ICSCalendarWriter (export) + ICSCalendarProvider (future import)
  api/           # FastAPI app, debate + ICS export routes, SSE streaming
  models.py      # Task / TimeBlock / Schedule / Preferences
frontend/        # Next.js debate-timeline UI + editable schedule
docs/            # architecture, design specs, and TDD plans
tests/           # pytest suite
```

## Status

A portfolio project showcasing **justified** multi-agent orchestration — every architectural choice exists to answer "why this, and not a single prompt?" The debate engine, the deterministic guardrails, and API-free `.ics` calendar export are implemented and tested. Design specs and test-first implementation plans live under [`docs/superpowers/`](docs/superpowers/).

<div align="center">
<sub>Built with CrewAI · LangGraph · FastAPI · Next.js · Claude</sub>
</div>
