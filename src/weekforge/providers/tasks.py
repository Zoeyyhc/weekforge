"""Task providers. Return the list of tasks the council must schedule."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol, runtime_checkable

from weekforge.models import Task


@runtime_checkable
class TaskProvider(Protocol):
    """A source of tasks to schedule."""

    def get_tasks(self) -> list[Task]:
        ...


class JSONTaskProvider:
    """Loads tasks from a JSON file containing a list of task objects."""

    def __init__(self, json_path: str | Path) -> None:
        self._path = Path(json_path)
        if not self._path.exists():
            raise FileNotFoundError(f"Tasks file not found: {self._path}")

    def get_tasks(self) -> list[Task]:
        raw = json.loads(self._path.read_text())
        return [Task(**item) for item in raw]
