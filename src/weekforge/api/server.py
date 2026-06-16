"""Uvicorn entrypoint for the WeekForge API.

Run with the real Claude-backed council and Google Calendar:

    ANTHROPIC_API_KEY=sk-...
    GOOGLE_OAUTH_CLIENT_ID=...
    GOOGLE_OAUTH_CLIENT_SECRET=...
    GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8000/auth/google/callback
    GOOGLE_TOKEN_PATH=./weekforge_tokens.json
    WEEKFORGE_FRONTEND_URL=http://localhost:3000
    uv run weekforge-api
"""

from __future__ import annotations

import os

from fastapi import FastAPI

from weekforge.api.app import create_app
from weekforge.debate.debaters import build_council


def _build_google_integration():
    """Return a configured GoogleIntegration, or UnconfiguredGoogleIntegration if env absent."""
    client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET")
    if not client_id or not client_secret:
        from weekforge.integration import UnconfiguredGoogleIntegration
        return UnconfiguredGoogleIntegration()

    from weekforge.auth.token_store import JsonFileTokenStore
    from weekforge.integration import GoogleIntegration

    token_path = os.environ.get("GOOGLE_TOKEN_PATH", "weekforge_tokens.json")
    frontend_url = os.environ.get("WEEKFORGE_FRONTEND_URL", "http://localhost:3000")

    return GoogleIntegration(
        token_store=JsonFileTokenStore(token_path),
        frontend_url=frontend_url,
    )


def build_app() -> FastAPI:
    """Construct the production app from environment configuration."""
    api_key = os.environ["ANTHROPIC_API_KEY"]
    db_path = os.environ.get("WEEKFORGE_DB_PATH", "weekforge_api.db")
    from weekforge.debate.debaters import DEFAULT_MODEL
    model = os.environ.get("WEEKFORGE_MODEL", DEFAULT_MODEL)
    arbiter_model = os.environ.get("WEEKFORGE_ARBITER_MODEL")
    council = build_council(api_key, model=model, arbiter_model=arbiter_model)
    google = _build_google_integration()
    return create_app(council=council, api_key=api_key, db_path=db_path, google=google)


def main() -> None:
    import uvicorn

    host = os.environ.get("WEEKFORGE_HOST", "127.0.0.1")
    port = int(os.environ.get("WEEKFORGE_PORT", "8000"))
    uvicorn.run(build_app(), host=host, port=port)


if __name__ == "__main__":
    main()
