import json

from weekforge.api.sse import format_sse
from weekforge.models import Schedule, TimeBlock
from datetime import datetime, timezone


def _utc(y, m, d, h):
    return datetime(y, m, d, h, tzinfo=timezone.utc)


def test_format_sse_includes_event_and_data_lines():
    frame = format_sse({"type": "debate_event", "speaker": "DeadlineHawk", "content": "Pack it!"})
    assert frame.startswith("event: debate_event\n")
    assert "\ndata: " in frame
    assert frame.endswith("\n\n")


def test_format_sse_data_is_valid_json():
    frame = format_sse({"type": "debate_event", "round": 1, "speaker": "A", "content": "hi"})
    data_line = [l for l in frame.splitlines() if l.startswith("data:")][0]
    payload = json.loads(data_line[len("data:"):].strip())
    assert payload["round"] == 1
    assert payload["speaker"] == "A"


def test_format_sse_serializes_schedule_pydantic_model():
    block = TimeBlock(start=_utc(2026, 6, 15, 9), end=_utc(2026, 6, 15, 10), label="Write report", task_id="t1")
    schedule = Schedule(blocks=[block])
    frame = format_sse({"type": "done", "schedule": schedule, "thread_id": "x"})
    data_line = [l for l in frame.splitlines() if l.startswith("data:")][0]
    payload = json.loads(data_line[len("data:"):].strip())
    assert payload["schedule"]["blocks"][0]["label"] == "Write report"
    assert payload["schedule"]["blocks"][0]["task_id"] == "t1"


def test_format_sse_handles_none_schedule():
    frame = format_sse({"type": "done", "schedule": None, "thread_id": "x"})
    data_line = [l for l in frame.splitlines() if l.startswith("data:")][0]
    payload = json.loads(data_line[len("data:"):].strip())
    assert payload["schedule"] is None
