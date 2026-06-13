import json

import pytest

SAMPLE_BODY = {
    "tasks": [{"id": "t1", "title": "Write report", "estimated_minutes": 120, "priority": 1}],
    "busy_blocks": [
        {"start": "2026-06-15T10:00:00+00:00", "end": "2026-06-15T11:00:00+00:00", "label": "Standup"}
    ],
    "preferences": {"workday_start_hour": 9, "workday_end_hour": 18, "max_focus_minutes_per_day": 360},
    "max_rounds": 3,
}


def _parse_sse(text: str) -> list[dict]:
    events = []
    for block in text.strip().split("\n\n"):
        if not block.strip():
            continue
        data_lines = [l for l in block.splitlines() if l.startswith("data:")]
        if not data_lines:
            continue
        events.append(json.loads(data_lines[0][len("data:"):].strip()))
    return events


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_start_returns_thread_id(client):
    resp = client.post("/debate", json=SAMPLE_BODY)
    assert resp.status_code == 200
    assert "thread_id" in resp.json()
    assert len(resp.json()["thread_id"]) > 0


def test_start_rejects_missing_tasks(client):
    resp = client.post("/debate", json={})
    assert resp.status_code == 422


def test_stream_unknown_thread_returns_404(client):
    resp = client.get("/debate/does-not-exist/stream")
    assert resp.status_code == 404


def test_stream_emits_debate_events_and_done(client, anthropic_patch):
    thread_id = client.post("/debate", json=SAMPLE_BODY).json()["thread_id"]
    with anthropic_patch(converge=True):
        resp = client.get(f"/debate/{thread_id}/stream")
        events = _parse_sse(resp.text)

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")

    debate_events = [e for e in events if e["type"] == "debate_event"]
    assert len(debate_events) >= 3  # at least one proposal per debater

    done = [e for e in events if e["type"] == "done"]
    assert len(done) == 1
    assert done[0]["schedule"]["blocks"][0]["label"] == "Write report"


def test_intervene_unknown_thread_returns_404(client):
    resp = client.post("/debate/nope/intervene", json={"input": "x"})
    assert resp.status_code == 404


def test_intervene_accepts_input(client):
    thread_id = client.post("/debate", json=SAMPLE_BODY).json()["thread_id"]
    resp = client.post(f"/debate/{thread_id}/intervene", json={"input": "Prioritise the report"})
    assert resp.status_code == 200
    assert resp.json() == {"status": "accepted"}


def test_full_hitl_cycle(client, anthropic_patch):
    """Stall the council → it interrupts → human intervenes → resume → done."""
    thread_id = client.post("/debate", json=SAMPLE_BODY).json()["thread_id"]

    # Phase 1: council never converges → graph pauses at human_interrupt.
    with anthropic_patch(converge=False):
        resp1 = client.get(f"/debate/{thread_id}/stream")
        events1 = _parse_sse(resp1.text)

    assert any(e["type"] == "interrupt" for e in events1)
    assert not any(e["type"] == "done" for e in events1)

    # Human arbitrates.
    intervene = client.post(f"/debate/{thread_id}/intervene", json={"input": "Prioritise the report"})
    assert intervene.status_code == 200

    # Phase 2: resume; this time it converges → finishes.
    with anthropic_patch(converge=True):
        resp2 = client.get(f"/debate/{thread_id}/stream")
        events2 = _parse_sse(resp2.text)

    assert any(e["type"] == "done" for e in events2)
    done = [e for e in events2 if e["type"] == "done"][0]
    assert done["schedule"] is not None
