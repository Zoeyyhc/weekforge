# CLAUDE.md — WeekForge

Transparent multi-agent decision council that plans the user's week. CrewAI debaters + LangGraph debate loop, FastAPI/SSE backend, Next.js frontend. Human-facing intro: `README.md`. Debate-graph architecture: `docs/langgraph-workflow.md`.

## Commands

```bash
# Backend (Python 3.12+, uv-managed)
uv run weekforge-api          # serve FastAPI on $WEEKFORGE_HOST:$WEEKFORGE_PORT (default 127.0.0.1:8000)
uv run pytest                 # run the test suite (pythonpath=src, testpaths=tests)
uv run pytest tests/debate    # a subset

# Frontend (Next.js 16, in frontend/)
cd frontend && npm run dev    # dev server (default :3000)
cd frontend && npm test       # vitest run
```

## Architecture map

- `src/weekforge/debate/` — the engine. `graph.py` (LangGraph StateGraph + SQLite checkpointer), `nodes.py` (gather/critique/converge/arbitrate/validate/finalize + the `validate_blocks` guardrail), `state.py` (`DebateState`), `runner.py` (`run_debate` streaming generator), `debaters.py` (CrewAI council).
- `src/weekforge/providers/google_calendar.py` — `GoogleCalendarClient` protocol (testability seam), `RealGoogleCalendarClient`, `GoogleCalendarProvider` (read busy), `GoogleCalendarWriter` (export).
- `src/weekforge/integration.py` — `GoogleIntegration` facade (auth + provider + writer).
- `src/weekforge/auth/` — Google OAuth (`calendar` scope) + token store.
- `src/weekforge/api/` — FastAPI app (`app.py`/`server.py`), routes (`routes.py` debate, `google_routes.py` calendar), `sse.py`, `sessions.py`.
- `src/weekforge/models.py` — Pydantic `Task` / `TimeBlock` / `Schedule` / `Preferences`.
- `frontend/` — Next.js app; debate timeline UX, `ExportButton`, `CalendarPicker`, `ForgedModal`, `ScheduleView`.

## Red lines — do not violate

- **Calendar data safety (the core invariant):** WeekForge writes to the user's **primary** calendar and tags every event with a private marker `extendedProperties.private.weekforge="1"`. It must **only ever delete or ignore its own marked events — never the user's real events.** `delete_events_in_range` enforces this with two layers: server-side `privateExtendedProperty` filter **and** a client-side `_is_weekforge_event` guard. Never weaken either layer; never delete on `primary` without the marker filter.
- **Import skips marked events** (`GoogleCalendarProvider.get_busy_blocks`) so WeekForge never re-imports its own output as busy. Don't reintroduce self-pollution.
- **Debate must terminate:** the `arbitrate↔validate` loop is bounded by `max_validation_attempts` (default 3). On exhaustion, `finalize` delivers the last parseable **best-effort** schedule flagged `degraded` (+ `validation_warnings`). Don't remove the cap or the best-effort path — unbounded retries hit LangGraph's `recursion_limit` and crash.
- **`validate_blocks` semantic rules:** blocks must be inside the work window, not overlap busy blocks, stay under the daily focus cap, and **not cross midnight**. Keep the arbiter prompt (`make_arbitrate_node`) consistent with these (it injects prefs/busy + hard constraints, incl. "end at 23:59, not 00:00").
- **TDD:** this project is built test-first via plans under `docs/superpowers/plans/`. Write the failing test before the implementation.
- **Frontend Next.js is NOT the version you know** — see `frontend/AGENTS.md`: read `node_modules/next/dist/docs/` before writing frontend code.

## Conventions

- Tests inject `FakeGoogleCalendarClient` / `MockCouncil` through the protocol seams; never call real Google/Anthropic in unit tests (mock `weekforge.debate.nodes.Anthropic`).
- Anthropic/Claude calls: when touching them, consult the `claude-api` skill for current model IDs (don't hardcode from memory).
- Secrets (`weekforge_tokens.json`, `*.db`) are git-ignored — never commit them. Config is all via env vars.

## Environment variables

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API (debate convergence + validate parsing) |
| `WEEKFORGE_MODEL` | Council/Arbiter model (defaults to Haiku) |
| `WEEKFORGE_ARBITER_MODEL` | Arbiter-only model; falls back to `WEEKFORGE_MODEL` when unset (recommend a stronger model, e.g. Sonnet, to reduce validation retries) |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | Google OAuth web flow |
| `GOOGLE_TOKEN_PATH` | OAuth token store path (default `weekforge_tokens.json`) |
| `WEEKFORGE_DB_PATH` | SQLite checkpointer / session DB path |
| `WEEKFORGE_FRONTEND_URL` | Frontend origin for OAuth redirect (default `http://localhost:3000`) |
| `WEEKFORGE_HOST` / `WEEKFORGE_PORT` | API bind (default `127.0.0.1` / `8000`) |
