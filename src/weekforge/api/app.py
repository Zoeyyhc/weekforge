"""FastAPI application factory for the WeekForge API."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from weekforge.api.auth_routes import create_auth_router, make_get_current_user
from weekforge.api.routes import create_router
from weekforge.api.ics_routes import create_ics_router
from weekforge.api.sessions import SessionManager
from weekforge.auth.store import UserStore
from weekforge.debate.debaters import Council


def create_app(
    council: Council,
    api_key: str,
    db_path: str = "weekforge_api.db",
    allow_origins: list[str] | None = None,
    auth_secret: str = "dev-insecure-secret",
) -> FastAPI:
    """Build the WeekForge FastAPI app.

    Args:
        council: CrewAI Council (or a mock in tests).
        api_key: Anthropic API key passed to the convergence-check and validate nodes.
        db_path: SQLite file backing the LangGraph checkpointer. Must be a real file
            (not ":memory:") so resume-across-requests works.
        allow_origins: CORS origins for the frontend. Defaults to the Next.js dev server.
        auth_secret: Secret used to sign local account JWTs.
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
    user_store = UserStore(db_path)
    app.state.user_store = user_store
    get_current_user = make_get_current_user(user_store, auth_secret)
    app.include_router(create_auth_router(user_store, auth_secret, get_current_user))
    app.include_router(
        create_router(
            council=council,
            api_key=api_key,
            db_path=db_path,
            sessions=sessions,
            current_user=get_current_user,
            secret=auth_secret,
        )
    )
    app.include_router(create_ics_router())

    return app
