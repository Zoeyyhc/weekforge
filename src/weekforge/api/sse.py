"""Server-Sent Events frame formatting.

An SSE frame looks like:

    event: debate_event
    data: {"type": "debate_event", ...}
    <blank line>

The frontend's EventSource can subscribe per event type (debate_event, interrupt,
done, error) via addEventListener.
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel


def _default(obj: Any) -> Any:
    if isinstance(obj, BaseModel):
        return obj.model_dump(mode="json")
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def format_sse(event: dict[str, Any]) -> str:
    """Render an event dict as a single SSE frame string."""
    event_type = event.get("type", "message")
    payload = json.dumps(event, default=_default)
    return f"event: {event_type}\ndata: {payload}\n\n"
