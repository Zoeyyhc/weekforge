from fastapi import FastAPI
from fastapi.testclient import TestClient

from weekforge.api.ics_routes import create_ics_router


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(create_ics_router())
    return TestClient(app)


def test_export_returns_downloadable_calendar():
    body = {
        "week_start": "2026-06-15T00:00:00",
        "time_zone": "Australia/Sydney",
        "blocks": [
            {
                "start": "2026-06-15T09:00:00+10:00",
                "end": "2026-06-15T11:00:00+10:00",
                "label": "Deep work",
                "task_id": "t1",
            }
        ],
    }
    res = _client().post("/calendar/ics/export", json=body)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/calendar")
    assert "attachment" in res.headers["content-disposition"]
    assert "X-WEEKFORGE:1" in res.text


def test_export_accepts_empty_blocks():
    res = _client().post(
        "/calendar/ics/export",
        json={"week_start": "2026-06-15T00:00:00", "blocks": []},
    )
    assert res.status_code == 200
    assert "BEGIN:VCALENDAR" in res.text
