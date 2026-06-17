"""FastAPI application factory for the WeekForge API."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from weekforge.api.routes import create_router
from weekforge.api.ics_routes import create_ics_router
from weekforge.api.sessions import SessionManager
from weekforge.debate.debaters import Council


def create_app(
    council: Council,
    api_key: str,
    db_path: str = "weekforge_api.db",
    allow_origins: list[str] | None = None,
) -> FastAPI:
    """Build the WeekForge FastAPI app.

    Args:
        council: CrewAI Council (or a mock in tests).
        api_key: Anthropic API key passed to the convergence-check and validate nodes.
        db_path: SQLite file backing the LangGraph checkpointer. Must be a real file
            (not ":memory:") so resume-across-requests works.
        allow_origins: CORS origins for the frontend. Defaults to the Next.js dev server.
    """
    app = FastAPI(title="WeekForge API", description="A transparent multi-agent decision council.")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins or ["http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    sessions = SessionManager()
    app.state.sessions = sessions
    app.include_router(create_router(council=council, api_key=api_key, db_path=db_path, sessions=sessions))
    app.include_router(create_ics_router())

    return app
