# CLAUDE.md — WeekForge

Transparent multi-agent decision council that plans the user's week. CrewAI debaters + LangGraph debate loop, FastAPI/SSE backend, Next.js frontend. Human-facing intro: `README.md`. Debate-graph architecture: `docs/langgraph-workflow.md`.

## Commands

```bash
# Backend (Python 3.12+, uv-managed)
uv run weekforge-api          # serve FastAPI on $WEEKFORGE_HOST:$WEEKFORGE_PORT (default 127.0.0.1:8001)
uv run pytest                 # run the test suite (pythonpath=src, testpaths=tests)
uv run pytest tests/debate    # a subset

# Frontend (Next.js 16, in frontend/)
cd frontend && npm run dev    # dev server (default :3000)
cd frontend && npm test       # vitest run
```

## Architecture map

- `src/weekforge/debate/` — the engine. `graph.py` (LangGraph StateGraph + SQLite checkpointer), `nodes.py` (gather/critique/converge/herald/arbitrate/validate/finalize nodes; `herald` = neutral pre-vote summariser on the stall→interrupt path, emits `proposal_summaries`), `validation.py` (the deterministic guardrail: `classify_blocks`, `compute_week_window`, `remaining_focus_budget`, `_localize` DST helper), `state.py` (`DebateState`), `runner.py` (`run_debate` streaming generator), `debaters.py` (CrewAI council).
- `src/weekforge/providers/ics_writer.py` — `ICSCalendarWriter`: schedule blocks → downloadable `.ics` bytes; tags every event `X-WEEKFORGE:1`.
- `src/weekforge/providers/calendar.py` — `ICSCalendarProvider` (path-based import, unused/reserved for future import path).
- `src/weekforge/api/ics_routes.py` — `POST /calendar/ics/export`: JSON body → `text/calendar` attachment.
- `src/weekforge/api/` — FastAPI app (`app.py`/`server.py`), routes (`routes.py` debate, `ics_routes.py` export), `sse.py`, `sessions.py`.
- `src/weekforge/models.py` — Pydantic `Task` / `TimeBlock` / `Schedule` / `Preferences`.
- `frontend/` — Next.js app; debate timeline UX, `ExportButton`, `ForgedModal`, `ScheduleView`, `HeraldModal` + `HeraldSigil` (pre-vote summariser modal, rises on interrupt).

## Red lines — do not violate

- **Calendar data safety (the core invariant):** WeekForge has **no write access to any calendar**. It only ever emits a standalone `.ics` file the user chooses to import. Every generated event is stamped `X-WEEKFORGE:1` so a future import path can skip WeekForge's own output (no double-counting busy). Never remove the marker.
- **Debate must terminate:** the `arbitrate↔validate` loop is bounded by `max_validation_attempts` (default 3). On exhaustion, `finalize` delivers the last parseable **best-effort** schedule flagged `degraded` (+ `validation_warnings`). Don't remove the cap or the best-effort path — unbounded retries hit LangGraph's `recursion_limit` and crash.
- **Semantic guardrail (`classify_blocks` in `validation.py`):** blocks must be inside the work window, not overlap busy blocks, stay under the daily focus cap, **not cross midnight**, and fall **inside the now-aware schedulable week window** (never the past; `compute_week_window`). Two deterministic invariants killed prior dead-loops — do not revert them: (1) the Arbiter emits **local wall-clock with NO UTC offset**; `_localize` attaches the DST-correct `ZoneInfo` offset (asking the model for offsets reintroduced a DST shift that made validation unsatisfiable). (2) On a scoped retry the model re-places **only the broken blocks**; `validate` merges the authoritative frozen blocks back in code (trusting the model to reproduce them oscillated). Keep `make_arbitrate_node` consistent (wall-clock; end at 23:59, not 00:00).
- **TDD:** this project is built test-first via plans under `docs/superpowers/plans/`. Write the failing test before the implementation.
- **Frontend Next.js is NOT the version you know** — see `frontend/AGENTS.md`: read `node_modules/next/dist/docs/` before writing frontend code.

## Conventions

- Tests inject `MockCouncil` through the protocol seams; never call real Anthropic in unit tests (mock `weekforge.debate.nodes.Anthropic`).
- Anthropic/Claude calls: when touching them, consult the `claude-api` skill for current model IDs (don't hardcode from memory).
- Secrets (`*.db`) are git-ignored — never commit them. Config is all via env vars.

## Environment variables

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API (debate convergence + validate parsing) |
| `WEEKFORGE_MODEL` | Council/Arbiter model (defaults to Haiku) |
| `WEEKFORGE_ARBITER_MODEL` | Arbiter-only model; falls back to `WEEKFORGE_MODEL` when unset (recommend a stronger model, e.g. Sonnet, to reduce validation retries) |
| `WEEKFORGE_DB_PATH` | SQLite checkpointer / session DB path |
| `WEEKFORGE_FRONTEND_URL` | Frontend origin for CORS (default `http://localhost:3000`) |
| `WEEKFORGE_HOST` / `WEEKFORGE_PORT` | API bind (default `127.0.0.1` / `8001`) |
