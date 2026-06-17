"""API-free calendar export: download a generated .ics of the forged week."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel

from weekforge.models import TimeBlock
from weekforge.providers.ics_writer import ICSCalendarWriter


class ExportRequest(BaseModel):
    week_start: datetime
    blocks: list[TimeBlock]
    time_zone: str | None = None  # browser IANA zone for naive (wall-clock) blocks


def create_ics_router() -> APIRouter:
    router = APIRouter()

    @router.post("/calendar/ics/export")
    def ics_export(request: ExportRequest):
        data = ICSCalendarWriter().to_ics(request.blocks, time_zone=request.time_zone)
        return Response(
            content=data,
            media_type="text/calendar",
            headers={"Content-Disposition": 'attachment; filename="weekforge.ics"'},
        )

    return router
