"""Helpers for the Google OAuth 2.0 authorization-code flow.

Config comes entirely from environment variables so local and deployed
environments differ only by .env values, not code.
"""

from __future__ import annotations

import os

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow

SCOPES = ["https://www.googleapis.com/auth/calendar"]


def _client_config() -> dict:
    return {
        "web": {
            "client_id": os.environ["GOOGLE_OAUTH_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_OAUTH_CLIENT_SECRET"],
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [os.environ["GOOGLE_OAUTH_REDIRECT_URI"]],
        }
    }


def build_authorization_url() -> tuple[str, str]:
    """Return (authorization_url, state) for the OAuth consent redirect."""
    flow = Flow.from_client_config(
        _client_config(),
        scopes=SCOPES,
        redirect_uri=os.environ["GOOGLE_OAUTH_REDIRECT_URI"],
    )
    url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    return url, state


def exchange_code(code: str) -> dict:
    """Exchange the callback auth code for credentials dict (access + refresh token)."""
    flow = Flow.from_client_config(
        _client_config(),
        scopes=SCOPES,
        redirect_uri=os.environ["GOOGLE_OAUTH_REDIRECT_URI"],
    )
    flow.fetch_token(code=code)
    creds: Credentials = flow.credentials
    return {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes or SCOPES),
    }


def credentials_from_dict(data: dict) -> Credentials:
    """Rebuild a Credentials object from a stored dict (handles refresh automatically)."""
    return Credentials(
        token=data["token"],
        refresh_token=data.get("refresh_token"),
        token_uri=data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=data.get("client_id"),
        client_secret=data.get("client_secret"),
        scopes=data.get("scopes", SCOPES),
    )
