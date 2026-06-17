"""Uvicorn entrypoint for the WeekForge API.

Run with:

    ANTHROPIC_API_KEY=sk-...
    WEEKFORGE_FRONTEND_URL=http://localhost:3000
    uv run weekforge-api
"""

from __future__ import annotations

import os

from fastapi import FastAPI

from weekforge.api.app import create_app
from weekforge.debate.debaters import build_council


def build_app() -> FastAPI:
    """Construct the production app from environment configuration."""
    api_key = os.environ["ANTHROPIC_API_KEY"]
    db_path = os.environ.get("WEEKFORGE_DB_PATH", "weekforge_api.db")
    frontend_url = os.environ.get("WEEKFORGE_FRONTEND_URL", "http://localhost:3000")
    from weekforge.debate.debaters import DEFAULT_MODEL
    model = os.environ.get("WEEKFORGE_MODEL", DEFAULT_MODEL)
    arbiter_model = os.environ.get("WEEKFORGE_ARBITER_MODEL")
    council = build_council(api_key, model=model, arbiter_model=arbiter_model)
    return create_app(
        council=council, api_key=api_key, db_path=db_path,
        allow_origins=[frontend_url],
    )


def main() -> None:
    import uvicorn

    host = os.environ.get("WEEKFORGE_HOST", "127.0.0.1")
    port = int(os.environ.get("WEEKFORGE_PORT") or os.environ.get("PORT", "8000"))
    uvicorn.run(build_app(), host=host, port=port)


if __name__ == "__main__":
    main()
