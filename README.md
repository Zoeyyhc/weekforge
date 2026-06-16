# WeekForge

> *Forge your week in the crucible.*

WeekForge is a **transparent, participatory multi-agent decision council** for weekly planning. Three conflicting-objective agents — **Deadline Hawk**, **Energy Guardian**, **Focus Batcher** — plus a neutral **Arbiter** debate how to plan your week **in front of you**. You watch the reasoning unfold, step in as the final arbiter (side with an agent, add a constraint, or veto), and get back a time-blocked schedule with the full reasoning chain. The visible debate is the product; weekly planning is the first application of a domain-agnostic engine.

## How it works

```
gather_proposals → critique → check_convergence ─┬─ converged ──► arbitrate ─► validate ─► finalize
        ▲                                         ├─ more rounds ─► (loop)        │  ▲           │
        └─────────────────────────────────────────┘                              └──┘ (bounded)  ▼
                                            stalled → human_interrupt → arbitrate              schedule
```

- **CrewAI** defines the debaters (roles/personas) and the Arbiter.
- **LangGraph** runs the debate loop, the human-in-the-loop `interrupt()`, and a SQLite checkpointer for per-week re-planning.
- The `arbitrate↔validate` loop is **bounded** (`max_validation_attempts`, default 3). If validation never passes, WeekForge returns the closest **best-effort** schedule flagged `degraded` so you can review and fix it — it never loops forever.
- **FastAPI + SSE** streams the debate to a **Next.js** frontend (live debate timeline + editable schedule).

Full node-by-node reference: [`docs/langgraph-workflow.md`](docs/langgraph-workflow.md).

## Google Calendar integration

WeekForge can read your busy blocks and write the forged schedule back to your **primary** Google Calendar. It is **safe by design**: every event it creates is tagged with a private marker, and WeekForge will **only ever modify or delete its own blocks — never your real events**. On the next plan it skips its own blocks (so it re-plans them fresh instead of treating them as immovable).

## Getting started

**Prerequisites:** Python 3.12+, [uv](https://docs.astral.sh/uv/), Node.js (for the frontend), an Anthropic API key, and (optional) Google OAuth credentials for calendar sync.

**Configure** (env vars — see [`CLAUDE.md`](CLAUDE.md) for the full table):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# Optional, for Google Calendar sync:
export GOOGLE_OAUTH_CLIENT_ID=...
export GOOGLE_OAUTH_CLIENT_SECRET=...
export GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8000/auth/google/callback
```

**Run the backend:**

```bash
uv run weekforge-api          # http://127.0.0.1:8000
```

**Run the frontend:**

```bash
cd frontend
npm install
npm run dev                   # http://localhost:3000
```

## Testing

```bash
uv run pytest                 # backend
cd frontend && npm test       # frontend (vitest)
```

## Project structure

```
src/weekforge/
  debate/        # LangGraph engine: graph, nodes, state, runner, debaters
  providers/     # Google Calendar read/write (marker-safe)
  auth/          # Google OAuth + token store
  api/           # FastAPI app, routes, SSE streaming
  models.py      # Task / TimeBlock / Schedule / Preferences
frontend/        # Next.js debate-timeline UI
docs/            # architecture + design specs/plans
tests/           # pytest suite (debate + calendar + api)
```

## Status

Portfolio project showcasing justified multi-agent orchestration. The debate engine and Google Calendar read/write are implemented and tested; active development continues on feature branches. Design specs and TDD implementation plans live under `docs/superpowers/`.
