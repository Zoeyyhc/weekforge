"""Six Google Calendar routes mounted on the existing FastAPI app."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from weekforge.models import TimeBlock


class ExportRequest(BaseModel):
    week_start: datetime
    blocks: list[TimeBlock]


def create_google_router(google) -> APIRouter:
    """Build the Google routes, closing over the injected GoogleIntegration."""
    router = APIRouter()

    @router.get("/auth/google/status")
    def auth_status():
        return {"connected": google.is_connected()}

    @router.get("/auth/google/login")
    def auth_login():
        url = google.login_url()
        return RedirectResponse(url=url, status_code=307)

    @router.get("/auth/google/callback")
    def auth_callback(code: str, state: str = ""):
        google.complete_login(code)
        frontend = google.frontend_url()
        return RedirectResponse(url=f"{frontend}?google=connected", status_code=307)

    @router.post("/auth/google/disconnect")
    def auth_disconnect():
        google.disconnect()
        return {"status": "disconnected"}

    @router.get("/calendar/google/busy")
    def calendar_busy(week_start: str):
        if not google.is_connected():
            raise HTTPException(status_code=403, detail="Not connected to Google Calendar")
        dt = datetime.fromisoformat(week_start).replace(tzinfo=timezone.utc)
        blocks = google.import_busy(dt)
        return {"busy_blocks": [b.model_dump(mode="json") for b in blocks]}

    @router.post("/calendar/google/export")
    def calendar_export(request: ExportRequest):
        if not google.is_connected():
            raise HTTPException(status_code=403, detail="Not connected to Google Calendar")
        count, url = google.export_schedule(request.blocks, request.week_start)
        return {"written": count, "calendar_url": url}

    return router
