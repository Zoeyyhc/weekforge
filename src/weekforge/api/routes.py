"""HTTP routes for the WeekForge API.

Routes are built by `create_router`, which closes over the injected council, API key,
SQLite db_path, and SessionManager — no module-level globals, so tests can inject a
MockCouncil and a temp DB.
"""

from __future__ import annotations

from typing import Callable

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from weekforge.api.schemas import (
    InterventionRequest,
    StartDebateRequest,
    StartDebateResponse,
)
from weekforge.api.sessions import SessionManager
from weekforge.api.sse import format_sse
from weekforge.auth.store import User
from weekforge.debate.debaters import Council
from weekforge.debate.runner import run_debate


def create_router(
    council: Council,
    api_key: str,
    db_path: str,
    sessions: SessionManager,
    current_user: Callable[..., User],
    secret: str,
) -> APIRouter:
    router = APIRouter()
    bearer = HTTPBearer(auto_error=False)

    @router.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    @router.post("/debate", response_model=StartDebateResponse)
    def start_debate(
        request: StartDebateRequest,
        user: User = Depends(current_user),
    ) -> StartDebateResponse:
        thread_id = sessions.create(request, user.id)
        return StartDebateResponse(thread_id=thread_id)

    @router.get("/debate/{thread_id}/stream")
    def stream_debate(
        thread_id: str,
        token: str | None = Query(default=None),
        creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    ) -> StreamingResponse:
        if token is not None:
            creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        if creds is None:
            raise HTTPException(status_code=401, detail="Not authenticated")
        user = current_user(creds)

        session = sessions.get(thread_id)
        if session is None or session.user_id != user.id:
            raise HTTPException(status_code=404, detail="Unknown thread_id")

        resume_value = sessions.pop_intervention(thread_id)

        def event_stream():
            try:
                for event in run_debate(
                    tasks=session.request.tasks,
                    busy_blocks=session.request.busy_blocks,
                    preferences=session.request.preferences,
                    thread_id=thread_id,
                    api_key=api_key,
                    council=council,
                    max_rounds=session.request.max_rounds,
                    db_path=db_path,
                    resume_value=resume_value,
                    require_human_on_stall=session.request.require_human_on_stall,
                    week_start=session.request.week_start,
                ):
                    yield format_sse(event)
            except Exception as exc:  # surface engine errors to the client as an SSE frame
                yield format_sse({"type": "error", "message": str(exc)})

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    @router.post("/debate/{thread_id}/intervene")
    def intervene(
        thread_id: str,
        request: InterventionRequest,
        user: User = Depends(current_user),
    ) -> dict:
        session = sessions.get(thread_id)
        if session is None or session.user_id != user.id:
            raise HTTPException(status_code=404, detail="Unknown thread_id")
        sessions.set_intervention(thread_id, request.input)
        return {"status": "accepted"}

    return router
