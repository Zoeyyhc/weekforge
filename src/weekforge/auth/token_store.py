"""OAuth credential persistence behind the OAuthTokenStore protocol."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol, runtime_checkable


@runtime_checkable
class OAuthTokenStore(Protocol):
    """Save, load, and clear serialised OAuth credentials."""

    def save(self, credentials: dict) -> None: ...
    def load(self) -> dict | None: ...
    def clear(self) -> None: ...


class JsonFileTokenStore:
    """Persists credentials as a JSON file on a local (or mounted) path."""

    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)

    def save(self, credentials: dict) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps(credentials))

    def load(self) -> dict | None:
        if not self._path.exists():
            return None
        return json.loads(self._path.read_text())

    def clear(self) -> None:
        if self._path.exists():
            self._path.unlink()
