# WeekForge — Frontend

The frontend for **WeekForge (Crucible)**: a transparent multi-agent decision council that debates how to plan your week, live, in front of you.

## Architecture

```
SSE stream (FastAPI backend)
       │
       ▼
useDebateStream (hook)
  ├── startDebate()   → POST /debate → thread_id
  ├── EventSource     → GET /debate/{id}/stream
  │     └── frames dispatched to debateReducer (pure)
  ├── intervene()     → POST /debate/{id}/intervene → fresh EventSource
  └── reset()         → closes stream, resets state

debateReducer (pure)
  └── SSE frame → DebateState { status, events, interrupt, schedule, error }

app/page.tsx
  ├── idle      → TaskForm (JSON input, sample pre-filled)
  ├── streaming → DebateTimeline (live round-by-round messages)
  ├── interrupted → InterventionPanel (quick-actions + free text → resume)
  └── done      → ScheduleView (blocks grouped by day) + timeline transcript
```

Three agents debate (DeadlineHawk, EnergyGuardian, FocusBatcher), an Arbiter synthesises, and the user can step in as final arbiter at any stall point.

## Running locally

```bash
# 1. Start the FastAPI backend (from the repo root)
ANTHROPIC_API_KEY=sk-... uv run weekforge-api

# 2. Configure the frontend
cp .env.local.example .env.local   # points at http://127.0.0.1:8000

# 3. Start the dev server
npm run dev
```

Open http://localhost:3000. Click **Convene the council** to start a live debate.

## Tests

```bash
npm test          # 33 tests, all unit/integration (no network)
npm run test:watch
```

Test stack: Vitest + React Testing Library + jsdom. The EventSource is stubbed with a `MockEventSource` class that exposes an `emit()` method to drive the stream in tests without a live backend.

## Tech stack

Next.js (App Router) · TypeScript · Tailwind CSS · Vitest · React Testing Library
